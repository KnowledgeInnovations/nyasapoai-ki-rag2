/**
 * Deterministic numerical reasoning + answer verification for the RAG
 * pipeline. Nothing in this file calls an LLM — it extracts figures with
 * plain regexes so the chat route can (a) hand the model pre-computed,
 * citation-linked numbers instead of asking it to do arithmetic, and
 * (b) check after generation that the model's numbers and growth claims
 * actually match the source chunks.
 */

export type QueryType = 'fact_lookup' | 'trend' | 'comparison' | 'forecast' | 'evidence' | 'anomaly_detection' | 'general'

const FORECAST_RX  = /\b(predict|forecast|projection|project(ed)?|next year|upcoming year|estimate for \d{4})\b/i
const TREND_RX     = /\b(trend|over (the|\d+) (years?|decades?)|year[\s-]?(on|over)[\s-]?year|growth|increase|decrease|change (over|from)|since \d{4}|\d{4}\s*(to|-|–|—)\s*\d{4})\b/i
const COMPARISON_RX = /\b(compare|comparison|versus|\bvs\.?\b|difference between|relative to|against)\b/i
const EVIDENCE_RX  = /\b(evidence|prove|support(ing)?\s+(this|that|the)\s+claim|cite|source(s)?\s+for|justify)\b/i
const ANOMALY_RX   = /\b(anomal(y|ies)|suspicious|outlier|inconsistent|inconsistenc(y|ies)|irregular(it(y|ies))?|deviation(s)?|deviat(e|es|ed|ing))\b/i

// Classifies a user query so the chat route can pick the right pipeline:
//   fact lookup    -> Retrieve -> Verify -> Answer
//   trend          -> Retrieve -> Extract -> Calculate -> Analyze
//   comparison     -> Retrieve -> Aggregate -> Compare
//   forecast       -> Retrieve -> Build series -> Project (linear trend)
//   evidence       -> Retrieve -> Quote -> Cite
//   anomaly_detection -> Retrieve -> Check VALIDATED FACTS flags -> Report
export function classifyQuery(query: string): QueryType {
  if (ANOMALY_RX.test(query)) return 'anomaly_detection'
  if (FORECAST_RX.test(query)) return 'forecast'
  if (COMPARISON_RX.test(query)) return 'comparison'
  if (TREND_RX.test(query)) return 'trend'
  if (EVIDENCE_RX.test(query)) return 'evidence'
  return 'fact_lookup'
}

export interface Figure {
  raw: string
  value: number
  unit: string | null   // 'million' | 'billion' | '%' | 'cedis' | null
  year: number | null
  index: number          // character offset in the source text
  label: string          // text immediately preceding the figure on its line
                          // (e.g. "Total Expenditure", "Net Domestic Financing")
                          // — used to avoid mixing different metrics together
}

// PDF text extraction frequently inserts a stray space between the decimal
// point and the following digit(s) — e.g. "GH¢46,445. 7 million" for
// 46,445.7 — a kerning artifact, not a real space in the source document.
// Tolerate an optional space there so the decimal portion (and the unit word
// that follows it) aren't lost.
const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\s?\d+)?|\d+\.\s?\d+`
// Unit words (million/billion/etc.) are often wrapped onto the next line by
// PDF text extraction, e.g. "GH¢46,445. 7\n million" — `\s*` tolerates the
// newline+indentation gap between the number and its unit.
const FIGURE_RX = new RegExp(
  String.raw`(GH¢|GHS|US\$|\$|₵)\s?(${NUM})(?:\s*(billion|bn|million|m|%|percent|cedis))?` +
  String.raw`|(${NUM})\s*(billion|bn|million|m|%|percent|cedis)\b`,
  'gi',
)
const YEAR_RX = /\b(19|20)\d{2}\b/g

function normalizeUnit(u: string | undefined | null): string | null {
  if (!u) return null
  const lc = u.toLowerCase()
  if (lc === 'bn') return 'billion'
  if (lc === 'm') return 'million'
  if (lc === 'percent') return '%'
  return lc
}

// Finds the nearest 4-digit year (1900-2099) to a given character offset
// within `text`, searching up to `window` chars on either side. Budget
// tables typically put the year as the first token on a row (e.g.
// "1999  Total Expenditure  6,744.0 million"), so a year on the SAME LINE
// as the figure is always preferred — otherwise a long row label can put
// the figure's offset closer (by raw character distance) to the year on an
// adjacent row than to its own row's year.
function nearestYear(text: string, offset: number, window = 120): number | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  let lineEnd = text.indexOf('\n', offset)
  if (lineEnd === -1) lineEnd = text.length
  const line = text.slice(lineStart, lineEnd)

  let best: { year: number; dist: number } | null = null
  for (const m of line.matchAll(/\b(19|20)\d{2}\b/g)) {
    const dist = Math.abs((m.index ?? 0) - (offset - lineStart))
    if (!best || dist < best.dist) best = { year: parseInt(m[0], 10), dist }
  }
  if (best) return best.year

  // Fall back to the nearest year anywhere within `window` chars (figure
  // and its year label are on different lines).
  YEAR_RX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = YEAR_RX.exec(text))) {
    const dist = Math.abs(m.index - offset)
    if (dist <= window && (!best || dist < best.dist)) {
      best = { year: parseInt(m[0], 10), dist }
    }
  }
  return best?.year ?? null
}

// Grabs the text immediately preceding a figure on its own line (e.g. the
// row label in a budget table: "Total Expenditure ... 6,744.0") so callers
// can tell whether two figures represent the same kind of quantity before
// comparing/combining them across years.
function extractLabel(text: string, index: number, window = 60): string {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const start = Math.max(lineStart, index - window)
  return text.slice(start, index).replace(/[|:\-–—.\s]+$/, ' ').trim()
}

// Extracts every currency/percentage/scaled figure from `text`, each tagged
// with the nearest fiscal year mentioned nearby (if any).
export function extractFigures(text: string): Figure[] {
  const figures: Figure[] = []
  FIGURE_RX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FIGURE_RX.exec(text))) {
    const numStr = m[2] ?? m[4]
    const unit = normalizeUnit(m[3] ?? m[5])
    const value = parseFloat(numStr.replace(/[,\s]/g, ''))
    if (Number.isNaN(value)) continue
    figures.push({
      raw: m[0].trim(),
      value,
      unit,
      year: nearestYear(text, m.index),
      index: m.index,
      label: extractLabel(text, m.index),
    })
  }
  return figures
}

// Converts a figure to a common "millions" scale, or null if its unit can't
// be compared on that scale (percentages). Ghana's budget appendix tables
// report figures as plain absolute cedi amounts (e.g. "GHS 1,107,132,235",
// unit null/'cedis') rather than "X million" — without this branch those
// figures were excluded from sourceMillions entirely, so verifyAnswer's
// derived-sum/difference/ratio checks could never recognize a correct
// calculation built from them (e.g. "GHS 1,287,609,665" = the sum of two
// cited GHS figures), flagging genuinely correct arithmetic as unsupported.
export function toMillions(f: Figure): number | null {
  if (f.unit === 'million') return f.value
  if (f.unit === 'billion') return f.value * 1000
  if (f.unit === null || f.unit === 'cedis') return f.value / 1e6
  return null
}

export interface ExtractedFigureRef extends Figure {
  citationIndex: number  // 1-based [n] this figure was drawn from
}

// Matches row labels for headline expenditure/budget figures (totals,
// appropriations, overall budgets) as opposed to sub-components or unrelated
// series (net domestic financing, GDP, debt service, revenue, grants, etc.).
// Used to avoid picking/comparing a sub-component figure as if it were the
// total budget figure.
const TOTALISH_RX = /\b(total|aggregate|overall|grand[\s-]?total|sum|expenditure|appropriation|allocation|budget|payments?|spending|outturn)\b/i

// Labels matching this are excluded from "totalish" even if they also match
// TOTALISH_RX — e.g. "Total Revenue and Grants" contains "total" but is a
// revenue-side figure, not a total expenditure/budget figure, and shouldn't
// be treated as the same kind of quantity as "Total Expenditure".
const NON_EXPENDITURE_RX = /\b(revenue|receipts?|grants?|financing|loans?|borrowing|gdp|debt)\b/i

function isHeadlineExpenditure(f: ExtractedFigureRef): boolean {
  return TOTALISH_RX.test(f.label) && !NON_EXPENDITURE_RX.test(f.label)
}

// From a set of figures for the same year, picks the one most likely to be
// the headline total-expenditure/budget figure: prefer figures whose row
// label looks like a total/aggregate (and not a revenue/financing/GDP
// figure), falling back to the largest value if none do.
function pickBestFigure(figs: ExtractedFigureRef[]): ExtractedFigureRef {
  const totalish = figs.filter(isHeadlineExpenditure)
  const pool = totalish.length ? totalish : figs
  return pool.reduce((a, b) => (b.value > a.value ? b : a))
}

// True if two figures appear to represent the same kind of quantity (both
// look like headline total-expenditure/budget figures, or neither does) —
// used to avoid computing growth/CAGR between e.g. a "Total Expenditure"
// figure and a "Net Domestic Financing" or "Total Revenue and Grants" figure
// just because they were each the best match per year.
function sameMetricKind(a: ExtractedFigureRef, b: ExtractedFigureRef): boolean {
  return isHeadlineExpenditure(a) === isHeadlineExpenditure(b)
}

// Ghana redenominated its currency in 2007 (10,000 old cedis = 1 new cedi).
// Pre-2007 source documents state figures in old cedis, post-2007 documents
// in new cedis (GH¢) — but extractFigures has no currency-symbol
// information, so a figure's scale alone can't reliably distinguish them
// (the 10,000x denomination shift is partially offset by genuine nominal
// growth, landing anywhere from ~-90% to ~-99.99% "change" depending on the
// pair). Rather than guess via a ratio threshold, treat 2007 as a hard
// discontinuity: any pair straddling it is a unit mismatch, not a real
// year-over-year change, regardless of magnitude.
export function isRedenominationArtifact(fromYear: number, toYear: number): boolean {
  return fromYear < 2007 && toYear >= 2007
}

// Pulls scale-comparable figures (millions/billions) out of the retrieved
// chunks, tagged with their [n] citation index — handed to the model as
// "EXTRACTED FIGURES" so it grounds its analysis in real numbers instead of
// re-deriving (and potentially misreading) them from prose.
export function extractFiguresFromChunks(chunks: { chunk_text: string }[], maxPerChunk = 6): ExtractedFigureRef[] {
  const out: ExtractedFigureRef[] = []
  chunks.forEach((c, i) => {
    // Includes unit === null (raw cedi amounts with a currency symbol but no
    // "million"/"billion" suffix, e.g. "GH¢357,105,639,079.87") — toMillions
    // converts these. Without this, headline totals stated as raw cedi
    // figures were excluded here, leaving only smaller sub-line figures with
    // explicit scale suffixes as candidates for pickBestFigure/computeForecast/
    // computeCAGR/computeAggregate.
    const figs = extractFigures(c.chunk_text).filter(f => f.unit !== '%')
    for (const f of figs.slice(0, maxPerChunk)) {
      out.push({ ...f, citationIndex: i + 1 })
    }
  })
  return out
}

export interface GrowthCalculation {
  fromYear: number
  toYear: number
  fromValue: number
  toValue: number
  unit: string
  growthPct: number
  citations: number[]
  label: string  // row label the figures were drawn from, e.g. "Total Expenditure"
}

// Deterministically computes year-over-year growth for every pair of
// scale-comparable figures (same unit class, different years) found across
// the retrieved chunks. The model is told to use these numbers verbatim
// rather than computing growth itself.
export function computeGrowthCalculations(chunks: { chunk_text: string }[], maxResults = 12): GrowthCalculation[] {
  const refs = extractFiguresFromChunks(chunks)
  const byYear = new Map<number, ExtractedFigureRef[]>()
  for (const f of refs) {
    if (f.year == null) continue
    const ms = toMillions(f)
    if (ms == null) continue
    if (!byYear.has(f.year)) byYear.set(f.year, [])
    byYear.get(f.year)!.push({ ...f, value: ms, unit: 'million' })
  }

  const years = [...byYear.keys()].sort((a, b) => a - b)
  const results: GrowthCalculation[] = []
  for (let i = 0; i < years.length - 1; i++) {
    const fromYear = years[i]
    const toYear = years[i + 1]
    // Prefer the figure whose row label looks like a total/aggregate —
    // picking "largest figure" alone can pick a sub-component or unrelated
    // series (e.g. net domestic financing) over the true total.
    const fromFig = pickBestFigure(byYear.get(fromYear)!)
    const toFig = pickBestFigure(byYear.get(toYear)!)
    if (!fromFig || !toFig || fromFig.value === 0) continue
    // Don't compute "growth" between two figures that don't look like the
    // same kind of quantity (e.g. one is a "Total Expenditure" line and the
    // other is "Net Domestic Financing") — that's a metric mismatch, not a
    // real year-over-year change.
    if (!sameMetricKind(fromFig, toFig)) continue
    // Skip pairs that straddle the 2007 cedi redenomination with an
    // implausible >99% drop — almost certainly an old-cedi/new-cedi
    // denomination mismatch, not a real collapse in spending.
    if (isRedenominationArtifact(fromYear, toYear)) continue
    const growthPct = ((toFig.value - fromFig.value) / fromFig.value) * 100
    results.push({
      fromYear, toYear,
      fromValue: fromFig.value, toValue: toFig.value,
      unit: 'million',
      growthPct: Math.round(growthPct * 10) / 10,
      citations: [...new Set([fromFig.citationIndex, toFig.citationIndex])],
      label: fromFig.label || toFig.label,
    })
    if (results.length >= maxResults) break
  }
  return results
}

export interface CAGRCalculation {
  fromYear: number
  toYear: number
  fromValue: number
  toValue: number
  unit: string
  cagrPct: number
  citations: number[]
  label: string  // row label the figures were drawn from, e.g. "Total Expenditure"
}

// Builds a year -> first-figure-of-that-year map from the retrieved chunks,
// shared by computeGrowthCalculations/computeCAGR/computeForecast so they
// all see the same (year, value, citation) series.
function figuresByYear(chunks: { chunk_text: string }[]): Map<number, ExtractedFigureRef> {
  const refs = extractFiguresFromChunks(chunks)
  const byYearAll = new Map<number, ExtractedFigureRef[]>()
  for (const f of refs) {
    if (f.year == null) continue
    const ms = toMillions(f)
    if (ms == null) continue
    const arr = byYearAll.get(f.year) ?? []
    arr.push({ ...f, value: ms, unit: 'million' })
    byYearAll.set(f.year, arr)
  }
  // Prefer the figure whose row label looks like a total/aggregate for each
  // year (see pickBestFigure) — avoids picking a sub-component or unrelated
  // series just because it happens to be the largest value found.
  const byYear = new Map<number, ExtractedFigureRef>()
  for (const [year, figs] of byYearAll) byYear.set(year, pickBestFigure(figs))
  return byYear
}

// Deterministically computes the compound annual growth rate between the
// earliest and latest scale-comparable figures found across the retrieved
// chunks. The model is told to use this number verbatim rather than
// computing a CAGR itself (a common source of arithmetic errors).
export function computeCAGR(chunks: { chunk_text: string }[]): CAGRCalculation | null {
  const byYear = figuresByYear(chunks)
  const years = [...byYear.keys()].sort((a, b) => a - b)
  if (years.length < 2) return null

  const fromYear = years[0]
  const toYear = years[years.length - 1]
  const fromFig = byYear.get(fromYear)!
  const toFig = byYear.get(toYear)!
  const periods = toYear - fromYear
  if (fromFig.value <= 0 || toFig.value <= 0 || periods <= 0) return null
  // Same metric-mismatch guard as computeGrowthCalculations — don't compute
  // a CAGR between e.g. a "Total Expenditure" figure and a "Net Domestic
  // Financing" figure just because they were each the best match per year.
  if (!sameMetricKind(fromFig, toFig)) return null
  // Same 2007 redenomination guard as computeGrowthCalculations.
  if (isRedenominationArtifact(fromYear, toYear)) return null

  const cagrPct = (Math.pow(toFig.value / fromFig.value, 1 / periods) - 1) * 100
  return {
    fromYear, toYear,
    fromValue: fromFig.value, toValue: toFig.value,
    unit: 'million',
    cagrPct: Math.round(cagrPct * 10) / 10,
    citations: [...new Set([fromFig.citationIndex, toFig.citationIndex])],
    label: fromFig.label || toFig.label,
  }
}

export interface AggregateCalculation {
  year: number | null
  unit: string
  total: number
  count: number
  citations: number[]
}

// Sums every scale-comparable figure found across the retrieved chunks
// (optionally restricted to one fiscal year) — handed to the model as a
// pre-computed total for "what is the combined/total X" questions instead
// of asking it to add up several figures from prose itself.
export function computeAggregate(chunks: { chunk_text: string }[], targetYear?: number): AggregateCalculation | null {
  const refs = extractFiguresFromChunks(chunks).filter(f => f.unit !== '%' && f.unit !== 'percent')
  const candidates = refs.filter(f => {
    const ms = toMillions(f)
    if (ms == null) return false
    if (targetYear != null) return f.year === targetYear
    return true
  })
  if (candidates.length < 2) return null

  const total = candidates.reduce((s, f) => s + (toMillions(f) ?? 0), 0)
  return {
    year: targetYear ?? candidates[0].year ?? null,
    unit: 'million',
    total: Math.round(total * 100) / 100,
    count: candidates.length,
    citations: [...new Set(candidates.map(f => f.citationIndex))],
  }
}

export interface ForecastCalculation {
  baseYears: number[]
  baseValues: number[]
  forecastYears: number[]
  forecastValues: number[]
  unit: string
  method: 'linear_trend'
  citations: number[]
}

// Projects future values via simple linear regression over every
// (year, value) point found across the retrieved chunks — handed to the
// model as a pre-computed forecast so "what might next year's X be" answers
// don't rely on the model eyeballing a trend. Projects up to `periods` years
// past the last base year, stopping early if a projected value would be <= 0.
export function computeForecast(chunks: { chunk_text: string }[], periods = 5): ForecastCalculation | null {
  const byYear = figuresByYear(chunks)
  let years = [...byYear.keys()].sort((a, b) => a - b)
  if (years.length < 2) return null

  // 2007 redenomination guard (see isRedenominationArtifact): pre-2007
  // figures are in old cedis and would corrupt a linear trend mixed with
  // post-2007 (new cedi) figures. If both exist, forecast from 2007 onward
  // (recent data is more relevant to a forecast anyway).
  const pre = years.filter(y => y < 2007)
  const post = years.filter(y => y >= 2007)
  if (pre.length && post.length) years = post
  if (years.length < 2) return null

  const points = years.map(y => byYear.get(y)!)
  const n = points.length
  const sumX = years.reduce((s, y) => s + y, 0)
  const sumY = points.reduce((s, p) => s + p.value, 0)
  const sumXY = points.reduce((s, p, i) => s + years[i] * p.value, 0)
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
    baseValues: points.map(p => Math.round(p.value * 100) / 100),
    forecastYears,
    forecastValues,
    unit: 'million',
    method: 'linear_trend',
    citations: [...new Set(points.map(p => p.citationIndex))],
  }
}

export interface VerificationResult {
  totalNumbers: number
  supportedNumbers: number
  growthChecks: { claimedPct: number; actualPct: number; ok: boolean; sentence: string }[]
  unsupported: string[]
  confidenceScore: number   // 0-100
  confidenceLevel: 'High' | 'Medium' | 'Low'
}

// A minimal view of a financial_facts row, used by verifyAnswer to
// cross-check numbers in the answer against ground-truth values that may not
// be repeated verbatim (or at all) in the retrieved chunk text.
export interface FactForVerification {
  value_millions: number | null
}

// Normalizes a numeric string for loose containment matching against source
// text (strips commas/currency symbols/whitespace).
function normNum(raw: string): string {
  return raw.replace(/[,\s]/g, '').replace(/^(GH¢|GHS|US\$|\$|₵)/i, '')
}

// Second-pass validation: every non-percentage number in the answer should
// appear (in some form) in the retrieved chunks, and any "X% increase/rise"
// claim should match the actual growth between the two figures cited in the
// same sentence. Produces a real confidence score instead of a hardcoded
// constant.
export function verifyAnswer(
  answerText: string,
  chunks: { chunk_text: string }[],
  retrievalScores: number[],
  validatedFacts: FactForVerification[] = [],
): VerificationResult {
  const sourceText = chunks.map(c => c.chunk_text).join('\n')
  const sourceNorm = normNum(sourceText)

  // Scale-comparable figures appearing anywhere in the source chunks,
  // converted to millions, so an answer that rounds/reformats a source
  // figure (e.g. source says "61,151.8" but the model writes "GHS 61,152
  // million") can still be matched numerically rather than only by exact
  // substring.
  const sourceMillions = extractFigures(sourceText)
    .map(toMillions)
    .filter((v): v is number => v != null)

  const sentences = answerText.split(/(?<=[.!?])\s+/)
  let totalNumbers = 0
  let supportedNumbers = 0
  const growthChecks: VerificationResult['growthChecks'] = []
  const unsupported: string[] = []

  for (const sentence of sentences) {
    const figs = extractFigures(sentence)
    const amounts = figs.filter(f => f.unit !== '%' && f.unit !== 'percent')
    const percents = figs.filter(f => f.unit === '%' || f.unit === 'percent')

    for (const f of amounts) {
      totalNumbers++
      const exactMatch = sourceNorm.includes(normNum(f.raw)) || sourceText.includes(f.value.toFixed(1))

      const fMs = toMillions(f)
      // Within ~0.5% of any source figure on the same (millions) scale —
      // covers rounding/formatting differences for the same underlying value.
      const roundedMatch = !exactMatch && fMs != null &&
        sourceMillions.some(s => s !== 0 && Math.abs(s - fMs) / Math.abs(s) <= 0.005)

      // Cross-check against ground-truth financial_facts rows (e.g. a table
      // row the model paraphrased rather than quoted) — within ~1%.
      const factMatch = !exactMatch && !roundedMatch && fMs != null &&
        validatedFacts.some(vf => vf.value_millions != null && vf.value_millions !== 0 &&
          Math.abs(vf.value_millions - fMs) / Math.abs(vf.value_millions) <= 0.01)

      // A figure equal to the sum or difference of two figures that ARE in
      // the source (e.g. "revenue grew by ~GHS 1.17bn" derived from two
      // cited revenue figures) is a correct calculation, not a hallucinated
      // number — don't penalize the answer for showing its work.
      const derivedMatch = !exactMatch && !roundedMatch && !factMatch && fMs != null &&
        sourceMillions.some((a, i) => sourceMillions.some((b, j) => {
          if (i === j) return false
          const tol = Math.max(Math.abs(fMs) * 0.005, 0.01)
          return Math.abs(a + b - fMs) <= tol || Math.abs(Math.abs(a - b) - fMs) <= tol
        }))

      if (exactMatch || roundedMatch || factMatch || derivedMatch) {
        supportedNumbers++
      } else {
        unsupported.push(f.raw)
      }
    }

    // Only attempt the growth check when both figures have a detected year —
    // otherwise the sort below is a no-op and "from"/"to" order is ambiguous,
    // which can produce a false-positive "issue" against a correct answer.
    const isGrowthSentence = percents.length === 1 && amounts.length === 2
      && amounts[0].year != null && amounts[1].year != null
    if (isGrowthSentence) {
      const [a, b] = amounts.sort((x, y) => (x.year ?? 0) - (y.year ?? 0))
      const aMs = toMillions(a)
      const bMs = toMillions(b)
      if (aMs != null && bMs != null && aMs !== 0) {
        const actualPct = Math.round(((bMs - aMs) / aMs) * 1000) / 10
        const claimedPct = percents[0].value
        const ok = Math.abs(actualPct - claimedPct) <= Math.max(1, claimedPct * 0.05)
        growthChecks.push({ claimedPct, actualPct, ok, sentence: sentence.trim() })
      }
    }

    // Verify percentage figures too (e.g. sectoral GDP growth rates quoted
    // from a table) — except ones already covered by the growth-rate check
    // above, which are computed values not expected to appear verbatim.
    if (!isGrowthSentence) {
      for (const f of percents) {
        totalNumbers++
        const match = sourceNorm.includes(normNum(f.raw))
          || sourceText.includes(f.raw)
          || sourceText.includes(f.value.toFixed(1))
          || sourceText.includes(Math.abs(f.value).toFixed(1))

        // A percentage equal to the growth rate between two figures that ARE
        // in the source (e.g. "+9.9%" computed from two cited totals) is a
        // correct calculation, not a hallucinated figure.
        const derivedPctMatch = !match && sourceMillions.some((a, i) => sourceMillions.some((b, j) => {
          if (i === j || a === 0) return false
          const pct = ((b - a) / a) * 100
          return Math.abs(pct - f.value) <= Math.max(Math.abs(f.value) * 0.05, 0.5)
        }))

        // A percentage equal to one source figure expressed as a share of
        // another (e.g. "-4.0% of GDP" = fiscal balance / GDP * 100) is also
        // a correct calculation, not a hallucinated figure.
        const derivedRatioMatch = !match && !derivedPctMatch && sourceMillions.some((a, i) => sourceMillions.some((b, j) => {
          if (i === j || b === 0) return false
          const pct = (a / b) * 100
          return Math.abs(pct - f.value) <= Math.max(Math.abs(f.value) * 0.05, 0.5)
        }))

        if (match || derivedPctMatch || derivedRatioMatch) {
          supportedNumbers++
        } else {
          unsupported.push(f.raw)
        }
      }
    }
  }

  const avgRetrieval = retrievalScores.length
    ? retrievalScores.reduce((s, v) => s + v, 0) / retrievalScores.length
    : 0
  const retrievalComponent = Math.max(0, Math.min(1, avgRetrieval)) * 100

  const verificationRatio = totalNumbers === 0 ? 1 : supportedNumbers / totalNumbers
  const growthAccuracy = growthChecks.length === 0
    ? 1
    : growthChecks.filter(g => g.ok).length / growthChecks.length

  // Verification (whether the model's own numbers actually appear in the
  // sources/facts) now dominates the score — a well-retrieved chunk set
  // doesn't matter if the model fabricated the numbers it quoted from it.
  let confidenceScore: number
  if (totalNumbers === 0) {
    // No numeric claims to check — confidence reflects retrieval quality
    // directly (the AI verifier's issue penalty, applied by the caller,
    // covers factual/quote accuracy for these answers).
    confidenceScore = Math.round(retrievalComponent)
  } else {
    confidenceScore = Math.round(
      0.25 * retrievalComponent + 0.55 * verificationRatio * 100 + 0.2 * growthAccuracy * 100,
    )
  }
  // Any unsupported number is a hallucination risk regardless of how well
  // everything else scores — cap the score so it can't read as "High".
  if (unsupported.length > 0) confidenceScore = Math.min(confidenceScore, 60)
  confidenceScore = Math.max(1, Math.min(99, confidenceScore))

  const confidenceLevel: VerificationResult['confidenceLevel'] =
    confidenceScore >= 75 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low'

  return { totalNumbers, supportedNumbers, growthChecks, unsupported, confidenceScore, confidenceLevel }
}
