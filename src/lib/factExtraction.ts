/**
 * Deterministic extraction of structured financial facts from document
 * chunks at ingestion time, plus query-side filter helpers used by the
 * chat route to build a "VALIDATED FACTS" block. Also exports
 * aiEnhanceTableFacts which uses Claude to capture facts that the
 * regex pipeline misses (sector breakdowns, footnote figures, etc.).
 */

import { extractFigures, type Figure } from './ragAnalysis'
import { claudeComplete, extractJSON } from './claude'
import type { ProcessedChunk } from './documentProcess'

export interface FinancialFact {
  tenant_id: string
  document_id: string
  chunk_id: string | null
  fiscal_year: string | null
  entity: string
  entity_type: 'national' | 'ministry' | 'sector'
  metric: string
  value: number
  unit: string
  value_millions: number | null
  page_number: number | null
  section_title: string | null
  is_table: boolean
  confidence: number
  flags: string[]
  extraction_method: 'regex' | 'table' | 'prose' | 'ai'
}

// One row from extract_tables.py's per-document JSON output.
export interface TableFactRecord {
  document_id: string
  page_number: number | null
  entity: string
  entity_type: 'national' | 'ministry' | 'sector'
  metric: string
  fiscal_year: string | null
  value: number
  unit: string
  table_caption: string | null
}

export interface FactSourceChunk {
  id: string
  document_id: string
  tenant_id: string
  chunk_text: string
  metadata: Record<string, unknown>
}

const METRIC_PATTERNS: { metric: string; rx: RegExp }[] = [
  // "Govt"/"Gov't" is the common abbreviation for "Government" in older
  // (pre-2007) MTEF appendix tables, e.g. "Total Govt Expenditure". "Total
  // Payments" is the headline aggregate label used throughout pre-2007
  // budget narratives (e.g. "Total payments for 2002 amounted to ...").
  { metric: 'total_budget', rx: /total\s+(national\s+)?budget|total\s+(gov(?:ernmen)?t'?\.?\s+)?expenditure|total\s+payments/i },
  { metric: 'capital_expenditure', rx: /capital\s+expenditure/i },
  { metric: 'recurrent_expenditure', rx: /recurrent\s+expenditure/i },
  { metric: 'revenue', rx: /(total\s+)?revenue/i },
  { metric: 'debt', rx: /\bdebt\b/i },
  { metric: 'allocation', rx: /allocation/i },
]

const NATIONAL_RX = /national\s+budget|total\s+budget\s+(of\s+)?(the\s+)?(government|ghana)/i

// Metrics that describe macro/national-level fiscal aggregates — when a
// figure classifies as one of these and the chunk has no ministry/sector/
// explicit-national context, it almost always refers to the national total
// (these summary figures rarely appear inside a ministry/sector section).
const NATIONAL_AGGREGATE_METRICS = new Set([
  'total_budget', 'revenue', 'debt', 'recurrent_expenditure', 'capital_expenditure',
])

// Picks the pattern whose match sits CLOSEST to the figure, rather than the
// first pattern (in METRIC_PATTERNS order) that matches anywhere in the
// window. Otherwise a sentence like "Capital expenditure was GHC 12,000
// million, against total expenditure of GHC 80,000 million" would classify
// the GHC 12,000 million figure as 'total_budget' purely because
// 'total_budget' is checked before 'capital_expenditure', even though
// "Capital expenditure" is the nearer (and correct) label for that figure.
// 160 was tried (to recover far-but-real "total expenditure ... is estimated
// at GH¢X million" labels separated by a long intervening clause) but
// reverted: it also pulls in prior-year figures restated in narrative
// (e.g. "Total expenditure for the 2009 fiscal year amounted to GH¢9,074.4
// million" appearing in the 2011 budget, stored under fiscal_year=2011 from
// doc metadata) and sub-component amounts (e.g. "Expenditure on Wages and
// Salaries ... totaled GH¢5,883.9 million") as spurious total_budget
// candidates, which pollute runSanityChecks' per-document national-group
// medians and flip previously-clean table facts to alternate_estimate.
function classifyMetric(text: string, index: number, window = 80): string {
  const start = Math.max(0, index - window)
  const end = Math.min(text.length, index + window)
  const around = text.slice(start, end)
  const localIndex = index - start

  let best: { metric: string; distance: number; order: number } | null = null
  for (let order = 0; order < METRIC_PATTERNS.length; order++) {
    const { metric, rx } = METRIC_PATTERNS[order]
    const re = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(around))) {
      const matchCenter = m.index + m[0].length / 2
      const distance = Math.abs(matchCenter - localIndex)
      if (!best || distance < best.distance || (distance === best.distance && order < best.order)) {
        best = { metric, distance, order }
      }
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return best ? best.metric : 'other'
}

function classifyEntity(
  chunkText: string,
  metadata: Record<string, unknown>,
): { entity: string; entity_type: FinancialFact['entity_type'] } | null {
  const ministry = metadata.ministry as string | null
  if (ministry) return { entity: ministry, entity_type: 'ministry' }

  const sectionTitle = (metadata.section_title as string | null) ?? ''
  if (NATIONAL_RX.test(chunkText) || NATIONAL_RX.test(sectionTitle)) {
    return { entity: 'National', entity_type: 'national' }
  }

  const sector = metadata.sector as string | null
  if (sector) return { entity: sector, entity_type: 'sector' }

  return null
}

// Ghana budget statements routinely describe a sub-component figure right
// after stating the real total, e.g. "...is estimated at GH¢30,544.3
// million... Of this amount, GH¢2,070.2 million, equivalent to 2.3 per cent
// of GDP and 6.8 per cent of total expenditure will be used for the
// clearance of arrears...". The widened classifyMetric window (160) picks up
// "total expenditure" from the earlier sentence and misclassifies 2070.2 as
// total_budget too. "<N> per cent of total expenditure/revenue/budget"
// immediately following a figure is a reliable signal that the figure is a
// FRACTION of the aggregate, not the aggregate itself.
const SUB_COMPONENT_RX = /(per\s*cent|percent|%)\s+of\s+total\s+(expenditure|revenue|budget|spending)\b/i

function isSubComponentFraction(text: string, index: number, lookahead = 150): boolean {
  return SUB_COMPONENT_RX.test(text.slice(index, index + lookahead))
}

function valueToMillions(f: Figure): number | null {
  if (f.unit === 'million') return f.value
  if (f.unit === 'billion') return f.value * 1000
  return null
}

// Extracts financial facts from a single chunk. Facts whose metric can't be
// classified (metric === 'other') or whose entity can't be attributed are
// dropped — Phase 1 only stores facts it can confidently classify and tie
// to an entity.
export function extractFactsFromChunk(chunk: FactSourceChunk): FinancialFact[] {
  const meta = chunk.metadata ?? {}
  const isTable = !!meta.is_table
  const metaFiscalYear = (meta.fiscal_year as string | null) ?? null
  const pageNumber = (meta.page_number as number | null) ?? null
  const sectionTitle = (meta.section_title as string | null) ?? null

  // Entity attribution from chunk metadata/section (ministry, explicit
  // "national budget" mention, or sector keyword). May be null — in that
  // case, individual figures can still be attributed to "National" below if
  // their metric is a national-aggregate one.
  const chunkEntity = classifyEntity(chunk.chunk_text, meta)

  const figures = extractFigures(chunk.chunk_text).filter(
    f => f.unit && f.unit !== '%' && f.unit !== 'percent',
  )

  const facts: FinancialFact[] = []
  for (const f of figures) {
    if (f.value < 0) continue

    let metric = classifyMetric(chunk.chunk_text, f.index)
    if (NATIONAL_AGGREGATE_METRICS.has(metric) && isSubComponentFraction(chunk.chunk_text, f.index)) {
      metric = 'other'
    }
    if (metric === 'other') continue

    let entity: string
    let entityType: FinancialFact['entity_type']
    if (chunkEntity) {
      entity = chunkEntity.entity
      entityType = chunkEntity.entity_type
    } else if (NATIONAL_AGGREGATE_METRICS.has(metric)) {
      entity = 'National'
      entityType = 'national'
    } else {
      continue
    }

    // Prefer the year stated NEXT TO the figure itself (e.g. "Total payments
    // for 2002 amounted to ..." or "Total expenditure for the 2009 fiscal
    // year amounted to ...") over the document's nominal fiscal_year (from
    // its title). Budget narratives routinely restate a PRIOR year's actuals
    // — without this, such a figure would be stored under the document's
    // year and pollute that year's national-aggregate group with a
    // mismatched value (e.g. a 2009 actual showing up as a 2011 candidate).
    const fiscalYear = (f.year != null ? String(f.year) : null) ?? metaFiscalYear

    // Same plausibility floor/ceiling applied to table records (see
    // PLAUSIBLE_VALUE_MILLIONS below) — a regex match like "...expenditure
    // ... 4" is almost always a footnote/section number caught by the 80-char
    // window, not a real fiscal aggregate, and would otherwise pollute
    // runSanityChecks' national-group/growth comparisons for the real value.
    let valueMillions = valueToMillions(f)
    // Pre-2007 budget narratives state figures in OLD cedis (redenominated
    // 10,000:1 to the Ghana Cedi in July 2007) — "X billion"/"X million" old
    // cedis = X/10 / X/10000 million new GHS respectively. tableExtraction.ts
    // already applies this for table records; regex facts need it too, or a
    // genuinely-plausible figure like "total payments for 2002 amounted to
    // ¢15,447.0 billion" (= GH¢1,544.7 million) is read as 15,447,000
    // "million" and dropped by the plausibility filter below.
    if (valueMillions != null && fiscalYear && Number(fiscalYear) < 2007 && (f.unit === 'million' || f.unit === 'billion')) {
      valueMillions = f.unit === 'billion' ? f.value / 10 : f.value / 10000
    }
    if (valueMillions != null) {
      const [min, max] = PLAUSIBLE_VALUE_MILLIONS[entityType]
      if (valueMillions < min || valueMillions > max) continue
    }

    let confidence = 30
    if (isTable) confidence += 20
    if (!(entityType === 'national' && !isTable)) confidence += 15 // entity attributed
    confidence += 15 // metric classified (metric !== 'other')
    if (fiscalYear) confidence += 10
    if (f.unit === 'million' || f.unit === 'billion') confidence += 10
    // Regex extraction picks "the nearest figure within an 80-char window of
    // a metric keyword" — for table-derived chunks especially, pdfplumber
    // flattens every column/year of a row into one run of numbers, so this
    // heuristic frequently grabs a figure from the wrong column. A wrong
    // value here is worse than no value: it gets presented to the model (and
    // the AI verifier) as "VALIDATED — do not alter", so it can override or
    // contradict an otherwise-correct, directly-cited excerpt. Cap all
    // regex-derived facts below the confidence>=70 VALIDATED FACTS gate;
    // only extraction_method='table' facts (read from real table structure
    // via tableRecordToFact, base confidence 70+) should reach it.
    confidence = Math.min(60, confidence)
    // A figure with an explicit year stated right next to it (e.g. "Total
    // payments for 2002 amounted to ¢15,447.0 billion", "Total expenditure
    // for the 2009 fiscal year amounted to GH¢9,074.4 million") carries the
    // same year-attribution confidence as a table cell — the ambiguity that
    // justifies the 60 cap (regex grabbing the wrong column/value near a
    // metric keyword) doesn't apply when the year came from beside the
    // figure itself rather than the document's nominal fiscal_year. Let these
    // reach the validated-facts (>=70) gate; runSanityChecks still flags them
    // as alternate_estimate if they conflict with another candidate.
    if (metric === 'total_budget' && f.year != null) {
      confidence = Math.min(75, confidence + 15)
    }

    facts.push({
      tenant_id: chunk.tenant_id,
      document_id: chunk.document_id,
      chunk_id: chunk.id,
      fiscal_year: fiscalYear,
      entity,
      entity_type: entityType,
      metric,
      value: f.value,
      unit: f.unit!,
      value_millions: valueMillions,
      page_number: pageNumber,
      section_title: sectionTitle,
      is_table: isTable,
      confidence,
      flags: [],
      extraction_method: 'regex',
    })
  }
  return facts
}

// Plausible range for a single fact's value, expressed in GHS millions.
// Government budget tables sometimes report raw cedi amounts in a column
// whose header/caption was misread as "million" (off by ~10^3-10^6) — those
// produce values far outside any real fiscal aggregate or ministry
// allocation and would otherwise show up as confidently "VALIDATED" figures
// that are billions of times too large. Records outside these bounds are
// dropped rather than stored at low confidence, since they're parsing
// artifacts rather than genuine (if anomalous) figures.
const PLAUSIBLE_VALUE_MILLIONS: Record<'national' | 'ministry' | 'sector', [number, number]> = {
  national: [500, 500_000],
  ministry: [0.01, 100_000],
  sector: [0.01, 100_000],
}

// Some table columns report raw cedi amounts (e.g. 58,904,864,627) under a
// header/caption that says "GH¢ million", off by a factor of ~10^6 from the
// figure's true value in millions. If the raw value is implausible but
// dividing by 1e6 lands it back in range, prefer that reading.
function tableValueToMillions(value: number, unit: string, entityType: TableFactRecord['entity_type']): number | null {
  let base: number | null = null
  if (unit === 'million') base = value
  else if (unit === 'billion') base = value * 1000
  else if (unit === 'thousand') base = value / 1000
  if (base == null) return null

  const [min, max] = PLAUSIBLE_VALUE_MILLIONS[entityType]
  if (base >= min && base <= max) return base
  // Raw cedi amount mislabeled as million/billion/thousand — the true value
  // in millions is always value / 1e6 regardless of the (incorrect) unit
  // label, since the label only affects how `base` above was derived.
  const salvaged = value / 1e6
  if (salvaged >= min && salvaged <= max) return salvaged
  return null
}

// Converts a row from extract_tables.py's JSON output into a FinancialFact,
// or null if the record should be dropped (percentage columns, which aren't
// absolute monetary figures, or values outside any plausible range — see
// PLAUSIBLE_VALUE_MILLIONS). Entity/metric/fiscal_year come directly from
// table headers (no 80-char-window guessing), so surviving records start at
// a higher base confidence than regex facts and aren't subject to the
// national-aggregate prose cap.
export function tableRecordToFact(
  record: TableFactRecord,
  tenantId: string,
  documentId: string,
): FinancialFact | null {
  if (record.unit === '%' || record.value <= 0) return null

  const valueMillions = tableValueToMillions(record.value, record.unit, record.entity_type)
  if (valueMillions == null) return null

  let confidence = 70
  if (record.fiscal_year) confidence += 10
  if (record.unit) confidence += 10
  confidence = Math.min(99, confidence)

  return {
    tenant_id: tenantId,
    document_id: documentId,
    chunk_id: null,
    fiscal_year: record.fiscal_year,
    entity: record.entity,
    entity_type: record.entity_type,
    metric: record.metric,
    value: record.value,
    unit: record.unit,
    value_millions: valueMillions,
    page_number: record.page_number,
    section_title: record.table_caption,
    is_table: true,
    confidence,
    flags: [],
    extraction_method: 'table',
  }
}

// Post-extraction sanity checks across all facts for a document (or a
// backfill batch). Mutates and returns the same array — flags anomalies and
// demotes their confidence rather than deleting them, so they remain
// auditable but won't surface in the chat route's VALIDATED FACTS block
// (which filters on confidence >= 70).
export function runSanityChecks(facts: FinancialFact[]): FinancialFact[] {
  for (const f of facts) {
    if (f.value < 0) {
      f.flags.push('negative_value')
      f.confidence = 0
    }
  }

  // National total_budget per year, for ministry/sector comparison.
  const nationalBudgetByYear = new Map<string, number>()
  for (const f of facts) {
    if (f.entity_type === 'national' && f.metric === 'total_budget' && f.fiscal_year && f.value_millions != null) {
      const existing = nationalBudgetByYear.get(f.fiscal_year)
      if (existing == null || f.value_millions > existing) {
        nationalBudgetByYear.set(f.fiscal_year, f.value_millions)
      }
    }
  }

  for (const f of facts) {
    if (
      (f.entity_type === 'ministry' || f.entity_type === 'sector') &&
      f.fiscal_year &&
      f.value_millions != null
    ) {
      const national = nationalBudgetByYear.get(f.fiscal_year)
      if (national != null && f.value_millions > national) {
        f.flags.push('exceeds_national_budget')
        f.confidence = Math.max(0, f.confidence - 40)
      }
    }
  }

  // Year-over-year growth anomalies per (entity, metric).
  const groups = new Map<string, FinancialFact[]>()
  for (const f of facts) {
    if (!f.fiscal_year || f.value_millions == null) continue
    const key = `${f.entity_type}|${f.entity}|${f.metric}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  for (const group of groups.values()) {
    const byYear = group
      .filter(f => /^\d{4}/.test(f.fiscal_year!))
      .sort((a, b) => parseInt(a.fiscal_year!, 10) - parseInt(b.fiscal_year!, 10))

    for (let i = 0; i < byYear.length - 1; i++) {
      const from = byYear[i]
      const to = byYear[i + 1]
      if (from.value_millions === 0) continue
      const growthPct = ((to.value_millions! - from.value_millions!) / from.value_millions!) * 100
      // A single backfill batch may only cover a sparse subset of years for a
      // given (entity, metric) — e.g. table-extraction years with a gap where
      // intervening years' figures come from a separate prose-extraction
      // batch. A multi-year gap's cumulative growth should be compared
      // against a proportionally larger threshold, not the same 500% used for
      // adjacent years, otherwise normal high-inflation compounding across a
      // gap (e.g. ~37%/yr over 9 years) is mistaken for a single bad value.
      const gapYears = Math.max(1, parseInt(to.fiscal_year!, 10) - parseInt(from.fiscal_year!, 10))
      if (Math.abs(growthPct) > 500 * gapYears) {
        from.flags.push('anomalous_growth')
        from.confidence = Math.max(0, from.confidence - 30)
        to.flags.push('anomalous_growth')
        to.confidence = Math.max(0, to.confidence - 30)
      }
    }
  }

  // National aggregates (total_budget, revenue, debt, etc.) ideally have one
  // value per (metric, fiscal_year), but budget documents legitimately report
  // several figures for the same year — different documents' "Budget" vs
  // "Revised Budget" vs "Provisional Outturn" vs forecast/indicative figures
  // for a future year, which can vary more across the whole group than a
  // single global max/min ratio can tolerate even though most of them agree.
  // So compare each value to the group's MEDIAN individually: values within
  // ~3x of the median are 'alternate_estimate' (still excluded from the
  // VALIDATED FACTS gate, but not presented as outright noise), while values
  // more than ~3x from the median (e.g. a misread page number) are flagged
  // 'conflicting_national_value' as genuine outliers.
  const nationalGroups = new Map<string, FinancialFact[]>()
  for (const f of facts) {
    // Non-positive values (e.g. a misread "0") can never be legitimate
    // national totals — leave them out of the conflict comparison entirely
    // so they don't distort the median for an otherwise-consistent group of
    // real estimates.
    if (f.entity_type !== 'national' || !f.fiscal_year || f.value_millions == null || f.value_millions <= 0) continue
    const key = `${f.metric}|${f.fiscal_year}`
    if (!nationalGroups.has(key)) nationalGroups.set(key, [])
    nationalGroups.get(key)!.push(f)
  }
  for (const group of nationalGroups.values()) {
    const distinctValues = [...new Set(group.map(f => f.value_millions!))].sort((a, b) => a - b)
    if (distinctValues.length <= 1) continue

    // Two values within ~1% of each other (e.g. 3580.13 vs 3567.25) are
    // almost certainly the SAME underlying figure restated with minor
    // OCR/decimal noise, not two genuinely different budget-cycle estimates
    // (real "budget vs revised vs outturn" figures in this corpus differ by
    // several percent or more). Treat the lower-confidence one as a
    // duplicate instead of flagging both as alternate_estimate.
    if (distinctValues.length === 2 && distinctValues[1] / distinctValues[0] <= 1.01) {
      const maxConf = (v: number) => Math.max(...group.filter(f => f.value_millions === v).map(f => f.confidence))
      const primary = maxConf(distinctValues[1]) >= maxConf(distinctValues[0]) ? distinctValues[1] : distinctValues[0]
      for (const f of group) {
        if (f.value_millions !== primary) {
          f.flags.push('duplicate_extraction')
          f.confidence = Math.min(f.confidence, 50)
        }
      }
      continue
    }

    // True median (average of the two middle values for an even-length
    // array) — for exactly 2 distinct values this is their midpoint, so
    // BOTH are compared against it symmetrically rather than the larger
    // one always being picked as "median" and never flagged.
    const mid = distinctValues.length / 2
    const median = distinctValues.length % 2 === 0
      ? (distinctValues[mid - 1] + distinctValues[mid]) / 2
      : distinctValues[Math.floor(mid)]

    for (const f of group) {
      const v = f.value_millions!
      if (v === median) continue
      const ratio = Math.max(v, median) / Math.min(v, median)
      if (ratio <= 3) {
        f.flags.push('alternate_estimate')
        f.confidence = Math.min(f.confidence, 65)
      } else {
        f.flags.push('conflicting_national_value')
        f.confidence = Math.min(f.confidence, 60)
      }
    }
  }

  // NOTE: a check that summed all ministry/sector `allocation` facts per
  // year and flagged the group when the total was an implausible multiple of
  // the national budget was tried here and removed. MDA annex tables encode
  // a multi-level hierarchy (ministry totals, sub-agency lines, and
  // GoG/IGF/ABFA/Donor/recurrent/capex sub-components all extracted as
  // separate `entity_type: 'ministry', metric: 'allocation'` facts), so the
  // raw per-year sum across all of them is many times the national total
  // even for a single, correct extraction pass — the check flagged the vast
  // majority of valid ministry facts. Catching genuinely duplicated table
  // extractions is instead handled by the `duplicate_extraction` check below.

  // Within a (entity, metric) series across years, every value should be on
  // the same scale — a single year whose figure is >10x the series median
  // AND was recorded in a different unit than the rest of the series usually
  // means the unit (thousand vs million vs billion) was misread for that one
  // cell.
  for (const group of groups.values()) {
    const withValues = group.filter(f => f.value_millions != null)
    if (withValues.length < 3) continue
    const sortedValues = withValues.map(f => f.value_millions!).sort((a, b) => a - b)
    const median = sortedValues[Math.floor(sortedValues.length / 2)]
    if (median <= 0) continue

    const unitCounts = new Map<string, number>()
    for (const f of withValues) unitCounts.set(f.unit, (unitCounts.get(f.unit) ?? 0) + 1)
    let modalUnit = withValues[0].unit
    let modalCount = 0
    for (const [u, c] of unitCounts) {
      if (c > modalCount) {
        modalUnit = u
        modalCount = c
      }
    }

    for (const f of withValues) {
      const ratio = Math.max(f.value_millions!, median) / Math.min(f.value_millions!, median)
      if (ratio > 10 && f.unit !== modalUnit) {
        f.flags.push('unit_outlier_in_series')
        f.confidence = Math.min(f.confidence, 50)
      }
    }
  }

  // extractFactsFromChunk's regex pass and tableRecordToFact's table pass can
  // independently produce a fact for the same (entity, metric, fiscal_year,
  // value) — e.g. a figure that appears both in prose and in a table on the
  // same page. Keep the highest-confidence copy and flag the rest so
  // aggregate sums (computeAggregate) don't double-count them.
  const dupGroups = new Map<string, FinancialFact[]>()
  for (const f of facts) {
    if (!f.fiscal_year || f.value_millions == null) continue
    const key = `${f.entity_type}|${f.entity}|${f.metric}|${f.fiscal_year}|${f.value_millions.toFixed(2)}`
    if (!dupGroups.has(key)) dupGroups.set(key, [])
    dupGroups.get(key)!.push(f)
  }
  for (const group of dupGroups.values()) {
    if (group.length <= 1) continue
    const sorted = [...group].sort((a, b) => b.confidence - a.confidence)
    for (const f of sorted.slice(1)) {
      f.flags.push('duplicate_extraction')
      f.confidence = Math.min(f.confidence, 50)
    }
  }

  return facts
}

// runSanityChecks operates per-document, so it can't see that a figure it
// flagged as alternate_estimate (conflicting with another candidate in the
// SAME document) is independently corroborated by a DIFFERENT document. An
// EXACT value match (to the stored precision) across two distinct
// document_ids for the same national total_budget/fiscal_year is strong,
// genuine evidence — e.g. a budget statement and the FOLLOWING year's budget
// statement both reporting GH¢226,680.9 million for the same year's outturn.
// This is deliberately stricter than "numerically close" (which could
// coincidentally bracket genuinely-different revision figures): an exact
// multi-decimal match across independent documents is essentially never a
// coincidence. Only facts whose ONLY flag is alternate_estimate are
// promoted — anything also flagged duplicate_extraction/conflicting_national_value/
// unit_outlier_in_series etc. is left alone.
export function runCrossDocumentCorroboration<T extends FinancialFact & { id: string }>(facts: T[]): T[] {
  const changed: T[] = []
  const byYear = new Map<string, T[]>()
  for (const f of facts) {
    if (f.entity_type !== 'national' || f.metric !== 'total_budget' || !f.fiscal_year || f.value_millions == null) continue
    if (!byYear.has(f.fiscal_year)) byYear.set(f.fiscal_year, [])
    byYear.get(f.fiscal_year)!.push(f)
  }
  for (const group of byYear.values()) {
    const byValue = new Map<number, T[]>()
    for (const f of group) {
      if (!byValue.has(f.value_millions!)) byValue.set(f.value_millions!, [])
      byValue.get(f.value_millions!)!.push(f)
    }
    for (const sameValue of byValue.values()) {
      if (new Set(sameValue.map(f => f.document_id)).size < 2) continue
      for (const f of sameValue) {
        if (f.flags.length === 1 && f.flags[0] === 'alternate_estimate') {
          f.flags = []
          f.confidence = Math.max(f.confidence, 85)
          changed.push(f)
        }
      }
    }
  }
  return changed
}

// ── Query-side filter helpers ───────────────────────────────────────

const QUERY_YEAR_RX = /\b(19|20)\d{2}\b/g
const YEAR_RANGE_RX = /\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2})\b/i
const MINISTRY_RX = /ministry\s+of\s+[a-z][a-z,&'\-\s]{2,60}?(?=[.,;:?]|\s{2,}|$)/i

// Expands a "1999-2026"/"1999 to 2026" style range in the query to every year
// in between (inclusive), so a "for each year from X to Y" question matches
// facts for every intervening year, not just the two range endpoints that
// QUERY_YEAR_RX would otherwise pick up.
export function expandYearRange(query: string, years: string[]): string[] {
  const m = query.match(YEAR_RANGE_RX)
  if (!m) return years
  const from = parseInt(m[1], 10)
  const to = parseInt(m[2], 10)
  if (to < from || to - from > 60) return years
  const expanded: string[] = []
  for (let y = from; y <= to; y++) expanded.push(String(y))
  return expanded
}

const SECTOR_KEYWORDS = [
  'Education', 'Health', 'Agriculture', 'Infrastructure', 'Energy', 'Water',
  'Social Protection', 'Security', 'Defence', 'Justice', 'Trade', 'Industry',
  'Tourism', 'Environment', 'Local Government', 'Finance', 'Communications',
  'ICT', 'Transport', 'Housing', 'Youth', 'Sports', 'Roads', 'Sanitation',
]

// Custom match patterns for keywords whose plain word-boundary regex is too narrow.
// 'Health' needs to match "healthcare" (no word boundary between health/care).
const SECTOR_KEYWORD_RX: Partial<Record<string, RegExp>> = {
  'Health': /\bhealth(?:care|sector)?\b/i,
}

export interface QueryFilters {
  years: string[]
  entityHint: string | null
  secondEntityHint: string | null
}

// Determines which (year, entity) facts are relevant to a query — used to
// scope the VALIDATED FACTS lookup. Falls back to the fiscal years present
// across the retrieved chunks when the query itself names no year, mirroring
// the existing "broad query" per-document merge behavior.
export function extractQueryFilters(
  query: string,
  chunks: { metadata: Record<string, unknown> }[],
): QueryFilters {
  let years = [...new Set(query.match(QUERY_YEAR_RX) ?? [])]
  years = expandYearRange(query, years)

  if (!years.length) {
    const chunkYears = new Set<string>()
    for (const c of chunks) {
      const fy = c.metadata?.fiscal_year as string | undefined
      if (fy) chunkYears.add(fy)
    }
    years.push(...chunkYears)
  }

  let entityHint: string | null = null
  const ministryMatch = query.match(MINISTRY_RX)
  if (ministryMatch) {
    entityHint = ministryMatch[0].trim()
  } else {
    for (const sector of SECTOR_KEYWORDS) {
      const rx = SECTOR_KEYWORD_RX[sector] ?? new RegExp(`\\b${sector}\\b`, 'i')
      if (rx.test(query)) {
        entityHint = sector
        break
      }
    }
  }

  // Queries about the national/aggregate level (no specific ministry or
  // sector named) should only match entity_type='national' facts — without
  // this, an unfiltered facts query for the year returns every sector's
  // figures, none of which answer "what was the national total".
  if (!entityHint && NATIONAL_RX.test(query)) {
    entityHint = 'National'
  }

  // For comparison queries mentioning two sectors (e.g. "compare infrastructure
  // and education"), extract a second entity so the chat route can run
  // summarizeTrend for both and present a side-by-side analysis.
  let secondEntityHint: string | null = null
  if (entityHint && entityHint !== 'National') {
    for (const sector of SECTOR_KEYWORDS) {
      if (sector === entityHint) continue
      const rx = SECTOR_KEYWORD_RX[sector] ?? new RegExp(`\\b${sector}\\b`, 'i')
      if (rx.test(query)) {
        secondEntityHint = sector
        break
      }
    }
  }

  return { years, entityHint, secondEntityHint }
}

// ── AI-enhanced table fact extraction ──────────────────────────────────────
// After the deterministic table extraction pass, send the is_table chunks
// to Claude to extract additional structured facts it can see but the regex
// pipeline misses: sector breakdowns, footnote totals, partial-year figures,
// and ministry rows not matched by MINISTRY_COL_RX. Returns FinancialFact[]
// with extraction_method: 'ai'. Fails gracefully — returns [] on any error.
const AI_TABLE_BATCH_CHARS = 6000

interface AiFact {
  entity: string
  entity_type: 'national' | 'ministry' | 'sector'
  metric: string
  fiscal_year: string | null
  value: number
  unit: string
}

export async function aiEnhanceTableFacts(
  chunks: ProcessedChunk[],
  tenantId: string,
  documentId: string,
): Promise<FinancialFact[]> {
  const tableChunks = chunks.filter(c => c.is_table && c.text.trim().length > 30)
  if (!tableChunks.length) return []

  const facts: FinancialFact[] = []
  let batch: ProcessedChunk[] = []
  let batchChars = 0

  async function processBatch(b: ProcessedChunk[]) {
    const combined = b.map((c, i) => `[Table ${i + 1}${c.page_number ? ` (page ${c.page_number})` : ''}]\n${c.text}`).join('\n\n')
    try {
      const raw = await claudeComplete({
        maxTokens: 2048,
        messages: [{
          role: 'user',
          content: `Extract financial facts from these budget document table excerpts. Return a JSON array (empty array if nothing found):

[
  {
    "entity": "entity name (e.g. Ministry of Health, National, Education sector)",
    "entity_type": "national|ministry|sector",
    "metric": "allocation|total_budget|revenue|capital_expenditure|recurrent_expenditure|debt",
    "fiscal_year": "YYYY or null",
    "value": 1234.56,
    "unit": "million|billion|thousand|%"
  }
]

Rules:
- Only include facts with a clear numeric value AND year
- Do not invent or guess values
- Skip percentage columns and deviation/variance columns
- "National" entity means the whole-of-government figure

Tables:
${combined}`,
        }],
      })
      const parsed: AiFact[] = JSON.parse(extractJSON(raw))
      if (!Array.isArray(parsed)) return
      for (const f of parsed) {
        if (!f.entity || !f.metric || f.value == null || !Number.isFinite(f.value)) continue
        const valueMil = toMillions(f.value, f.unit ?? 'million')
        facts.push({
          tenant_id: tenantId,
          document_id: documentId,
          chunk_id: null,
          fiscal_year: f.fiscal_year ?? null,
          entity: f.entity,
          entity_type: f.entity_type ?? 'ministry',
          metric: f.metric,
          value: f.value,
          unit: f.unit ?? 'million',
          value_millions: valueMil,
          page_number: null,
          section_title: null,
          is_table: true,
          confidence: 0.75,
          flags: [],
          extraction_method: 'ai',
        })
      }
    } catch (e) {
      console.error('[aiEnhanceTableFacts] batch failed:', e)
    }
  }

  for (const chunk of tableChunks) {
    if (batchChars + chunk.text.length > AI_TABLE_BATCH_CHARS && batch.length) {
      await processBatch(batch)
      batch = []
      batchChars = 0
    }
    batch.push(chunk)
    batchChars += chunk.text.length
  }
  if (batch.length) await processBatch(batch)

  return facts
}

function toMillions(value: number, unit: string): number | null {
  if (unit === 'million') return value
  if (unit === 'billion') return value * 1000
  if (unit === 'thousand') return value / 1000
  return null
}
