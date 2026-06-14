// Analytical computations over `financial_facts` rows, used to answer
// questions that go beyond a direct (year, entity) lookup — cumulative
// totals, year-over-year series, top-N growth rankings, proportions of the
// national total, deviation detection, trend summaries, and simple
// forecasts. Every function operates on already-VALIDATED rows
// (confidence >= 70, no flags — the caller filters before calling these) and
// returns null/[] when there isn't enough data, rather than guessing.

import { isRedenominationArtifact } from './ragAnalysis'

export interface FactRow {
  fiscal_year: string | null
  entity: string
  entity_type: string
  metric: string
  value: number
  unit: string
  value_millions: number | null
  page_number: number | null
  section_title: string | null
  document_id: string
  confidence: number
  flags: string[] | null
}

// ── Intent-detection regexes ────────────────────────────────────────
// Independent boolean checks — a query can match more than one of these.
// They decide which computations below are *attempted*; they don't replace
// classifyQuery()'s single QueryType.

export const CUMULATIVE_RX = /\bcumulative\b|highest .*(allocation|funding|spending|received)|received the (most|highest)|which (ministry|sector|entity) .*(most|highest|largest)/i
export const RANKING_RX = /\btop\s+(five|5|three|3|ten|10|\d+)\b/i
export const PROPORTION_RX = /\bproportion\b|\bshare of\b|percentage of (the )?(total|budget)|what (percent|%|portion)/i
export const SUMMARY_RX = /summari[sz]e|\boverview\b|major (budget )?trend/i

// ── Entity canonicalization & dedup ─────────────────────────────────

// Maps known historical name variants to a single canonical entity name, so
// a multi-decade series for "Education" or "Health" groups correctly despite
// renames/sub-total rows across different years' documents. Anything not
// listed is returned unchanged (after trimming).
const ENTITY_ALIASES: [RegExp, string][] = [
  [/^ministry of education,?\s*science(?:\s*and\s*sports)?$/i, 'Ministry of Education'],
  [/^sub[- ]?total\s+(ministry of\s+)?education$/i, 'Ministry of Education'],
  [/^sub[- ]?total\s+(ministry of\s+)?health$/i, 'Ministry of Health'],
  [/^ministry of health \(hq\)$/i, 'Ministry of Health'],
  [/^ministry of roads(?:\s*and\s*highways)?$/i, 'Ministry of Roads and Highways'],
  [/^ministry of (food\s*&|food and)\s*agriculture$/i, 'Ministry of Food and Agriculture'],
  [/^ministry of (communication|communications)$/i, 'Ministry of Communications and Digitalisation'],
  [/^ministry of communications and digitalisation$/i, 'Ministry of Communications and Digitalisation'],
  [/^ministry of fisheries(\s*&|\s+and)?\s*aquaculture\s*dev(elopment|evelopment)?$/i, 'Ministry of Fisheries and Aquaculture Development'],
  [/^ministry of fisheries$/i, 'Ministry of Fisheries and Aquaculture Development'],
  [/^ministry of foreign affairs.*$/i, 'Ministry of Foreign Affairs and Regional Integration'],
  [/^ministry of justice.*attorney general.*$/i, "Ministry of Justice and Attorney General's Department"],
  [/^ministry of (env\.?|environment)[,.]?\s*science[,.]?\s*tech(\.|nology)?\s*(and|&)?\s*innovation$/i, 'Ministry of Environment, Science, Technology and Innovation'],
  [/^ministry of environment, science and technology$/i, 'Ministry of Environment, Science, Technology and Innovation'],
  [/^ministry of chieftaincy and (culture|religious affairs)$/i, 'Ministry of Chieftaincy and Religious Affairs'],
  [/^ministry of lands and natural resources$/i, 'Ministry of Lands and Natural Resources'],
  [/^ministry of energy(\s+and\s+green\s+transition)?$/i, 'Ministry of Energy'],
]

// Strips a trailing comma-formatted number that table extraction sometimes
// appends to an entity name (e.g. "Ministry of Justice ... 59,019,015"),
// which would otherwise create a spurious distinct "entity" per year.
const TRAILING_NUMBER_RX = /\s+[\d,]{4,}\s*$/

export function canonicalizeEntity(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ').replace(TRAILING_NUMBER_RX, '')
  for (const [rx, canonical] of ENTITY_ALIASES) {
    if (rx.test(trimmed)) return canonical
  }
  return trimmed
}

// When multiple facts exist for the same (entity_type, canonical entity,
// metric, fiscal_year) — e.g. GoG/IGF/Donor/Total columns from one table row
// all tagged with the same year — keep the largest value_millions. Heuristic:
// the "Total" column of a row is typically the largest of its value columns,
// so this favours headline totals over component breakdowns. Not claimed as
// ground truth — callers should treat results as best-effort for sparse
// ministry/sector data.
export function dedupeFacts(facts: FactRow[]): FactRow[] {
  const groups = new Map<string, FactRow[]>()
  for (const f of facts) {
    if (!f.fiscal_year || f.value_millions == null) continue
    const key = `${f.entity_type}|${canonicalizeEntity(f.entity)}|${f.metric}|${f.fiscal_year}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  const out: FactRow[] = []
  for (const group of groups.values()) {
    out.push(group.reduce((best, f) => (f.value_millions! > best.value_millions! ? f : best)))
  }
  return out
}

// ── Relative year-range parsing ─────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
}

// Parses "five", "twenty", "twenty one", "27" etc. into a number, or null.
function parseNumberWord(text: string): number | null {
  const trimmed = text.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  const parts = trimmed.split(/[\s-]+/)
  if (parts.length === 1) return WORD_NUMBERS[parts[0]] ?? null
  if (parts.length === 2) {
    const tens = WORD_NUMBERS[parts[0]]
    const ones = WORD_NUMBERS[parts[1]]
    if (tens != null && tens % 10 === 0 && ones != null && ones < 10) return tens + ones
  }
  return null
}

const NUMBER_WORD = '(?:\\d+|[a-z]+(?:[\\s-][a-z]+)?)'
const QUERY_YEAR_RX = /\b(19|20)\d{2}\b/g

// Extends factExtraction's expandYearRange for phrasing it doesn't catch:
// "the past decade", "the last/past N years", "over/across/during the
// N-year period", and "the previous N years" (relative to an explicit year
// elsewhere in the query, if any, otherwise relative to `latestYear`).
// Returns null if nothing matches.
export function parseRelativeYearRange(query: string, latestYear: number): { from: number; to: number } | null {
  if (/\b(the\s+)?(past|last)\s+decade\b/i.test(query)) {
    return { from: latestYear - 9, to: latestYear }
  }

  const explicitYears = (query.match(QUERY_YEAR_RX) ?? []).map(y => parseInt(y, 10))
  const anchorYear = explicitYears.length ? Math.max(...explicitYears) : null

  const previousMatch = query.match(new RegExp(`\\bprevious\\s+(${NUMBER_WORD})\\s+years\\b`, 'i'))
  if (previousMatch) {
    const n = parseNumberWord(previousMatch[1])
    if (n != null && n > 0) {
      const anchor = anchorYear ?? latestYear
      return { from: anchor - n, to: anchor - 1 }
    }
  }

  const lastPastMatch = query.match(new RegExp(`\\b(?:the\\s+)?(?:last|past)\\s+(${NUMBER_WORD})\\s+years\\b`, 'i'))
  if (lastPastMatch) {
    const n = parseNumberWord(lastPastMatch[1])
    if (n != null && n > 0) return { from: latestYear - n + 1, to: latestYear }
  }

  const periodMatch = query.match(new RegExp(`(${NUMBER_WORD})[\\s-]year\\s+period`, 'i'))
  if (periodMatch) {
    const n = parseNumberWord(periodMatch[1])
    if (n != null && n > 0) return { from: latestYear - n + 1, to: latestYear }
  }

  return null
}

function yearsCoveredLabel(years: number[], from: number, to: number): string {
  const rangeSize = to - from + 1
  if (years.length === rangeSize) return `${years.length} of ${rangeSize} years (${from}-${to})`
  // Collapse consecutive years into ranges for a compact label.
  const sorted = [...years].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) { prev = cur; continue }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (i < sorted.length) { start = cur; prev = cur }
  }
  return `${years.length} of ${rangeSize} years (${ranges.join(',')})`
}

// ── Entity plausibility filtering ───────────────────────────────────
// Ministry/sector table extraction occasionally tags a budget-classification
// LINE ITEM (a sub-total, transfer category, or financing line) as the
// "entity" for that row, rather than an actual ministry/sector — these
// produce nonsensical "top ministry" results (e.g. "Sub-Total MDA's",
// "GRAND TOTAL", "VAT Refunds"). Filtered out by name; not claimed to be
// exhaustive.
const ENTITY_BLOCKLIST_RX = /^(sub[- ]?totals?\b|grand\s+total|total\b|interest\s+payments?|vat\s+refunds?|arrears|contingenc|statutory|domestic\s+(financing|debt)|foreign\s+(financing|debt)|compensation\s+of\s+employees?|goods\s+and\s+services|other\s+transfers?|reallocation|amorti[sz]ation|debt\s+servic|exceptional\s+financing|capital\s+expenditure|recurrent\s+expenditure|net\s+lending|discrepanc|financing\b|^revenue$|^expenditure$)/i

// A single ministry/sector receiving more than this share of the national
// total in a given year is almost certainly a misread row (e.g. a
// near-total figure mis-tagged with an unrelated entity name), not a real
// allocation. Even Ghana's largest single votes (Education, Interior) rarely
// exceed ~25% of the national total, so 0.35 catches misreads while leaving
// headroom for legitimately large ministries.
const MAX_ENTITY_SHARE_OF_NATIONAL = 0.35

function buildNationalTotals(facts: FactRow[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (const f of facts) {
    if (f.entity_type === 'national' && f.metric === 'total_budget' && f.fiscal_year && f.value_millions != null) {
      totals.set(Number(f.fiscal_year), f.value_millions)
    }
  }
  return totals
}

// "ministry"-typed rows whose entity isn't actually a ministry (an agency,
// department, programme, or budget sub-line tagged with the wrong entity_type
// during extraction) — restricting cumulative/ranking computations to actual
// "Ministry of ..." votes avoids comparing a full ministry's multi-year
// budget against a single department's allocation.
const MINISTRY_NAME_RX = /^ministry of /i

// Drops ministry/sector facts whose entity name is a budget-classification
// line item rather than an entity, isn't a recognizable ministry, or whose
// value implausibly exceeds a large share of that year's national total.
// National facts pass through unchanged.
function filterPlausibleEntities(facts: FactRow[]): FactRow[] {
  const nationalTotals = buildNationalTotals(facts)
  return facts.filter(f => {
    if (f.entity_type === 'national') return true
    if (f.value_millions == null || f.value_millions <= 0) return false
    if (ENTITY_BLOCKLIST_RX.test(f.entity.trim())) return false
    if (f.entity_type === 'ministry' && !MINISTRY_NAME_RX.test(canonicalizeEntity(f.entity))) return false
    const national = f.fiscal_year ? nationalTotals.get(Number(f.fiscal_year)) : undefined
    if (national != null && f.value_millions > national * MAX_ENTITY_SHARE_OF_NATIONAL) return false
    return true
  })
}

// ── Computations ─────────────────────────────────────────────────────

export interface CumulativeEntry {
  entity: string
  total: number
  coverage: string
  facts: FactRow[]
}

// Sums value_millions per canonical entity over [from, to], sorted desc.
// "received the highest cumulative allocation" type questions.
export function cumulativeByEntity(
  facts: FactRow[],
  opts: { entityType: string; metric: string; from: number; to: number },
  topN = 5,
): CumulativeEntry[] {
  // Filter implausible rows BEFORE dedup, so a misread outlier value can't
  // win the per-(entity,year) "largest value" tiebreak in dedupeFacts.
  const deduped = dedupeFacts(filterPlausibleEntities(facts))
  const inRange = deduped.filter(f =>
    f.entity_type === opts.entityType && f.metric === opts.metric &&
    f.fiscal_year && /^\d{4}$/.test(f.fiscal_year) &&
    Number(f.fiscal_year) >= opts.from && Number(f.fiscal_year) <= opts.to,
  )
  if (!inRange.length) return []

  const groups = new Map<string, FactRow[]>()
  for (const f of inRange) {
    const key = canonicalizeEntity(f.entity)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const entries: CumulativeEntry[] = []
  for (const [entity, group] of groups) {
    const total = group.reduce((s, f) => s + f.value_millions!, 0)
    const years = group.map(f => Number(f.fiscal_year))
    entries.push({
      entity,
      total: Math.round(total * 100) / 100,
      coverage: yearsCoveredLabel(years, opts.from, opts.to),
      facts: group,
    })
  }
  return entries.sort((a, b) => b.total - a.total).slice(0, topN)
}

export interface YoyPoint {
  year: number
  value: number
  pctChangeFromPrev: number | null
  fact: FactRow
}

// Year-over-year series for a single entity — pctChangeFromPrev is null
// where the prior year isn't present (no fabricated step across a gap).
export function yoySeries(
  facts: FactRow[],
  opts: { entityType: string; entity: string; metric: string },
): YoyPoint[] {
  const deduped = dedupeFacts(facts)
  const target = canonicalizeEntity(opts.entity)
  const series = deduped
    .filter(f => f.entity_type === opts.entityType && f.metric === opts.metric &&
      canonicalizeEntity(f.entity) === target && f.fiscal_year && /^\d{4}$/.test(f.fiscal_year))
    .sort((a, b) => Number(a.fiscal_year) - Number(b.fiscal_year))
  if (!series.length) return []

  const byYear = new Map(series.map(f => [Number(f.fiscal_year), f]))
  return series.map(f => {
    const year = Number(f.fiscal_year)
    const prev = byYear.get(year - 1)
    // Skip the 2007 cedi-redenomination boundary — an old-cedi/new-cedi
    // unit mismatch, not a real year-over-year change.
    const pctChangeFromPrev = prev && prev.value_millions! !== 0 &&
      !isRedenominationArtifact(year - 1, year)
      ? Math.round(((f.value_millions! - prev.value_millions!) / prev.value_millions!) * 1000) / 10
      : null
    return { year, value: f.value_millions!, pctChangeFromPrev, fact: f }
  })
}

export interface TopGrowthEntry {
  entity: string
  fromYear: number
  toYear: number
  fromValue: number
  toValue: number
  growthPct: number
  fromFact: FactRow
  toFact: FactRow
}

// % change from `from` to `to` per canonical entity, for entities that have
// a validated value at both endpoints (or, failing that, the nearest
// available years within the range) — sorted desc, top N.
export function topNGrowth(
  facts: FactRow[],
  opts: { entityType: string; metric: string; from: number; to: number },
  n = 5,
): TopGrowthEntry[] {
  // Filter implausible rows BEFORE dedup, so a misread outlier value can't
  // win the per-(entity,year) "largest value" tiebreak in dedupeFacts.
  const deduped = dedupeFacts(filterPlausibleEntities(facts))
  const inRange = deduped.filter(f =>
    f.entity_type === opts.entityType && f.metric === opts.metric &&
    f.fiscal_year && /^\d{4}$/.test(f.fiscal_year) &&
    Number(f.fiscal_year) >= opts.from && Number(f.fiscal_year) <= opts.to,
  )
  if (!inRange.length) return []

  const groups = new Map<string, FactRow[]>()
  for (const f of inRange) {
    const key = canonicalizeEntity(f.entity)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const entries: TopGrowthEntry[] = []
  for (const [entity, group] of groups) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => Number(a.fiscal_year) - Number(b.fiscal_year))
    const fromFact = sorted[0]
    const toFact = sorted[sorted.length - 1]
    if (fromFact === toFact || fromFact.value_millions === 0) continue
    // Skip the 2007 cedi-redenomination boundary (see yoySeries).
    if (isRedenominationArtifact(Number(fromFact.fiscal_year), Number(toFact.fiscal_year))) continue
    const growthPct = ((toFact.value_millions! - fromFact.value_millions!) / fromFact.value_millions!) * 100
    entries.push({
      entity,
      fromYear: Number(fromFact.fiscal_year), toYear: Number(toFact.fiscal_year),
      fromValue: fromFact.value_millions!, toValue: toFact.value_millions!,
      growthPct: Math.round(growthPct * 10) / 10,
      fromFact, toFact,
    })
  }
  return entries.sort((a, b) => b.growthPct - a.growthPct).slice(0, n)
}

export interface ProportionPoint {
  year: number
  proportionPct: number
  entityFact: FactRow
  nationalFact: FactRow
}

export interface ProportionResult {
  current: ProportionPoint
  history: ProportionPoint[]
}

// entity value / national total_budget for `year` (and every other year in
// `range` that has both values) — "what proportion of the budget went to X".
export function proportionOfTotal(
  facts: FactRow[],
  opts: { entity: string; entityType: string; metric: string; year: number; range: { from: number; to: number } },
): ProportionResult | null {
  const deduped = dedupeFacts(facts)
  const target = canonicalizeEntity(opts.entity)
  const entityFacts = new Map<number, FactRow>()
  for (const f of deduped) {
    if (f.entity_type === opts.entityType && f.metric === opts.metric &&
        canonicalizeEntity(f.entity) === target && f.fiscal_year && /^\d{4}$/.test(f.fiscal_year)) {
      entityFacts.set(Number(f.fiscal_year), f)
    }
  }
  const nationalFacts = new Map<number, FactRow>()
  for (const f of deduped) {
    if (f.entity_type === 'national' && f.metric === 'total_budget' && f.fiscal_year && /^\d{4}$/.test(f.fiscal_year)) {
      nationalFacts.set(Number(f.fiscal_year), f)
    }
  }

  const point = (year: number): ProportionPoint | null => {
    const e = entityFacts.get(year)
    const nat = nationalFacts.get(year)
    if (!e || !nat || nat.value_millions === 0) return null
    return {
      year,
      proportionPct: Math.round((e.value_millions! / nat.value_millions!) * 1000) / 10,
      entityFact: e, nationalFact: nat,
    }
  }

  const current = point(opts.year)
  if (!current) return null

  const history: ProportionPoint[] = []
  for (let y = opts.range.from; y <= opts.range.to; y++) {
    if (y === opts.year) continue
    const p = point(y)
    if (p) history.push(p)
  }
  return { current, history }
}

export interface DeviationEntry {
  year: number
  value: number
  medianBaseline: number
  deviationPct: number
  fact: FactRow
}

// Flags years whose value is >2x or <0.5x the median of the surrounding
// (up to 3 prior + 3 following) years — "significant deviations" detection,
// reusing the median-ratio approach from runSanityChecks.
export function detectDeviations(
  facts: FactRow[],
  opts: { entityType: string; entity?: string; metric: string },
): DeviationEntry[] {
  const deduped = dedupeFacts(facts)
  const target = opts.entity ? canonicalizeEntity(opts.entity) : null
  const series = deduped
    .filter(f => f.entity_type === opts.entityType && f.metric === opts.metric &&
      (!target || canonicalizeEntity(f.entity) === target) &&
      f.fiscal_year && /^\d{4}$/.test(f.fiscal_year))
    .sort((a, b) => Number(a.fiscal_year) - Number(b.fiscal_year))
  if (series.length < 3) return []

  const out: DeviationEntry[] = []
  for (let i = 0; i < series.length; i++) {
    const year = Number(series[i].fiscal_year)
    const neighbors = series
      .filter((_, j) => j !== i && Math.abs(j - i) <= 3)
      // Exclude neighbors on the other side of the 2007 cedi redenomination
      // — comparing old-cedi and new-cedi values would flag every year near
      // 2007 as a false "deviation" purely due to the unit mismatch.
      .filter(f => {
        const ny = Number(f.fiscal_year)
        return !isRedenominationArtifact(Math.min(year, ny), Math.max(year, ny))
      })
      .map(f => f.value_millions!)
      .sort((a, b) => a - b)
    if (neighbors.length < 2) continue
    const mid = neighbors.length / 2
    const median = neighbors.length % 2 === 0
      ? (neighbors[mid - 1] + neighbors[mid]) / 2
      : neighbors[Math.floor(mid)]
    if (median <= 0) continue
    const value = series[i].value_millions!
    const ratio = value / median
    if (ratio > 2 || ratio < 0.5) {
      out.push({
        year: Number(series[i].fiscal_year),
        value,
        medianBaseline: median,
        deviationPct: Math.round((ratio - 1) * 1000) / 10,
        fact: series[i],
      })
    }
  }
  return out
}

export interface TrendSummary {
  entity: string
  entityType: string
  metric: string
  from: number
  to: number
  yearsCovered: number
  rangeSize: number
  totalChangePct: number | null
  avgYoYPct: number | null
  minChange: { year: number; pct: number } | null
  maxChange: { year: number; pct: number } | null
  firstFact: FactRow
  lastFact: FactRow
}

// Overall trend stats for an (entityType, entity, metric) series over
// [from, to] — total % change start->end, average YoY %, and the single
// largest/smallest YoY moves (with years).
export function summarizeTrend(
  facts: FactRow[],
  opts: { entityType: string; entity: string; metric: string; from: number; to: number },
): TrendSummary | null {
  const points = yoySeries(facts, { entityType: opts.entityType, entity: opts.entity, metric: opts.metric })
    .filter(p => p.year >= opts.from && p.year <= opts.to)
  if (points.length < 2) return null

  const first = points[0]
  const last = points[points.length - 1]
  // Skip the 2007 cedi-redenomination boundary (see yoySeries) — a unit
  // mismatch across it, not a real total change.
  const totalChangePct = first.value !== 0 && !isRedenominationArtifact(first.year, last.year)
    ? Math.round(((last.value - first.value) / first.value) * 1000) / 10
    : null

  const changes = points.filter(p => p.pctChangeFromPrev != null) as (YoyPoint & { pctChangeFromPrev: number })[]
  const avgYoYPct = changes.length
    ? Math.round((changes.reduce((s, p) => s + p.pctChangeFromPrev, 0) / changes.length) * 10) / 10
    : null
  const minChange = changes.length
    ? changes.reduce((min, p) => (p.pctChangeFromPrev < min.pctChangeFromPrev ? p : min))
    : null
  const maxChange = changes.length
    ? changes.reduce((max, p) => (p.pctChangeFromPrev > max.pctChangeFromPrev ? p : max))
    : null

  return {
    entity: canonicalizeEntity(opts.entity),
    entityType: opts.entityType,
    metric: opts.metric,
    from: opts.from, to: opts.to,
    yearsCovered: points.length,
    rangeSize: opts.to - opts.from + 1,
    totalChangePct,
    avgYoYPct,
    minChange: minChange ? { year: minChange.year, pct: minChange.pctChangeFromPrev } : null,
    maxChange: maxChange ? { year: maxChange.year, pct: maxChange.pctChangeFromPrev } : null,
    firstFact: first.fact,
    lastFact: last.fact,
  }
}

export interface FactsForecast {
  baseYears: number[]
  baseValues: number[]
  forecastYears: number[]
  forecastValues: number[]
  facts: FactRow[]
}

// Linear-regression projection for future years, over (year, value_millions)
// pairs from financial_facts — same method as ragAnalysis's computeForecast,
// reimplemented against validated structured facts instead of chunk-derived
// figures. Projects up to `periods` years past the last base year, stopping
// early if a projected value would be <= 0.
export function forecastNextYear(
  facts: FactRow[],
  opts: { entityType: string; entity: string; metric: string },
  periods = 5,
): FactsForecast | null {
  let points = yoySeries(facts, opts)
  if (points.length < 2) return null

  // 2007 redenomination guard (see isRedenominationArtifact / yoySeries):
  // pre-2007 values are in old cedis and would corrupt a linear trend mixed
  // with post-2007 (new cedi) values. If both exist, forecast from 2007
  // onward (recent data is more relevant to a forecast anyway).
  const pre = points.filter(p => p.year < 2007)
  const post = points.filter(p => p.year >= 2007)
  if (pre.length && post.length) points = post
  if (points.length < 2) return null

  const years = points.map(p => p.year)
  const values = points.map(p => p.value)
  const n = years.length
  const sumX = years.reduce((s, y) => s + y, 0)
  const sumY = values.reduce((s, v) => s + v, 0)
  const sumXY = years.reduce((s, y, i) => s + y * values[i], 0)
  const sumXX = years.reduce((s, y) => s + y * y, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const lastYear = years[years.length - 1]

  const forecastYears: number[] = []
  const forecastValues: number[] = []
  for (let i = 1; i <= periods; i++) {
    const year = lastYear + i
    const value = slope * year + intercept
    if (value <= 0) break
    forecastYears.push(year)
    forecastValues.push(Math.round(value * 100) / 100)
  }
  if (!forecastYears.length) return null

  return {
    baseYears: years,
    baseValues: values.map(v => Math.round(v * 100) / 100),
    forecastYears,
    forecastValues,
    facts: points.map(p => p.fact),
  }
}
