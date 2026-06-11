/**
 * Deterministic extraction of structured financial facts from document
 * chunks at ingestion time, plus query-side filter helpers used by the
 * chat route to build a "VALIDATED FACTS" block. Nothing here calls an
 * LLM — it builds on the figure-extraction regexes in ragAnalysis.ts.
 */

import { extractFigures, type Figure } from './ragAnalysis'

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
  extraction_method: 'regex' | 'table'
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
  { metric: 'total_budget', rx: /total\s+(national\s+)?budget|total\s+(government\s+)?expenditure/i },
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

function classifyMetric(text: string, index: number, window = 80): string {
  const start = Math.max(0, index - window)
  const end = Math.min(text.length, index + window)
  const around = text.slice(start, end)
  for (const { metric, rx } of METRIC_PATTERNS) {
    if (rx.test(around)) return metric
  }
  return 'other'
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

    const metric = classifyMetric(chunk.chunk_text, f.index)
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

    const fiscalYear = metaFiscalYear ?? (f.year != null ? String(f.year) : null)

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
      value_millions: valueToMillions(f),
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
  national: [1_000, 500_000],
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
  if (unit === 'million' && base / 1e6 >= min && base / 1e6 <= max) return base / 1e6
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
      if (Math.abs(growthPct) > 500) {
        from.flags.push('anomalous_growth')
        from.confidence = Math.max(0, from.confidence - 30)
        to.flags.push('anomalous_growth')
        to.confidence = Math.max(0, to.confidence - 30)
      }
    }
  }

  // National aggregates (total_budget, revenue, debt, etc.) should have one
  // value per (metric, fiscal_year) — they describe a single economy-wide
  // figure. When prose-derived extraction produces multiple distinct values
  // for the same national metric/year, at least one is noise (e.g. a page
  // number or unrelated figure picked up near the keyword). Flag all of them
  // rather than presenting a confident-but-contradictory pick as fact.
  const nationalGroups = new Map<string, FinancialFact[]>()
  for (const f of facts) {
    if (f.entity_type !== 'national' || !f.fiscal_year || f.value_millions == null) continue
    const key = `${f.metric}|${f.fiscal_year}`
    if (!nationalGroups.has(key)) nationalGroups.set(key, [])
    nationalGroups.get(key)!.push(f)
  }
  for (const group of nationalGroups.values()) {
    const distinctValues = new Set(group.map(f => f.value_millions))
    if (distinctValues.size > 1) {
      for (const f of group) {
        f.flags.push('conflicting_national_value')
        f.confidence = Math.min(f.confidence, 60)
      }
    }
  }

  return facts
}

// ── Query-side filter helpers ───────────────────────────────────────

const QUERY_YEAR_RX = /\b(19|20)\d{2}\b/g
const MINISTRY_RX = /ministry\s+of\s+[a-z][a-z,&'\-\s]{2,60}?(?=[.,;:?]|\s{2,}|$)/i

const SECTOR_KEYWORDS = [
  'Education', 'Health', 'Agriculture', 'Infrastructure', 'Energy', 'Water',
  'Social Protection', 'Security', 'Defence', 'Justice', 'Trade', 'Industry',
  'Tourism', 'Environment', 'Local Government', 'Finance', 'Communications',
  'ICT', 'Transport', 'Housing', 'Youth', 'Sports', 'Roads', 'Sanitation',
]

export interface QueryFilters {
  years: string[]
  entityHint: string | null
}

// Determines which (year, entity) facts are relevant to a query — used to
// scope the VALIDATED FACTS lookup. Falls back to the fiscal years present
// across the retrieved chunks when the query itself names no year, mirroring
// the existing "broad query" per-document merge behavior.
export function extractQueryFilters(
  query: string,
  chunks: { metadata: Record<string, unknown> }[],
): QueryFilters {
  const years = [...new Set(query.match(QUERY_YEAR_RX) ?? [])]

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
      if (new RegExp(`\\b${sector}\\b`, 'i').test(query)) {
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

  return { years, entityHint }
}
