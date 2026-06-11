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
const TREND_RX     = /\b(trend|over (the|\d+) (years?|decades?)|year[\s-]?on[\s-]?year|growth|increase|decrease|change (over|from)|since \d{4}|\d{4}\s*(to|-|–|—)\s*\d{4})\b/i
const COMPARISON_RX = /\b(compare|comparison|versus|\bvs\.?\b|difference between|relative to|against)\b/i
const EVIDENCE_RX  = /\b(evidence|prove|support(ing)?\s+(this|that|the)\s+claim|cite|source(s)?\s+for|justify)\b/i
const ANOMALY_RX   = /\b(anomal(y|ies)|suspicious|outlier|inconsistent|inconsistenc(y|ies)|irregular(it(y|ies))?)\b/i

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
}

const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+`
const FIGURE_RX = new RegExp(
  String.raw`(GH¢|GHS|US\$|\$|₵)\s?(${NUM})(?:\s?(billion|bn|million|m|%|percent|cedis))?` +
  String.raw`|(${NUM})\s?(billion|bn|million|m|%|percent|cedis)\b`,
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
// within `text`, searching up to `window` chars on either side.
function nearestYear(text: string, offset: number, window = 120): number | null {
  let best: { year: number; dist: number } | null = null
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

// Extracts every currency/percentage/scaled figure from `text`, each tagged
// with the nearest fiscal year mentioned nearby (if any).
export function extractFigures(text: string): Figure[] {
  const figures: Figure[] = []
  FIGURE_RX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FIGURE_RX.exec(text))) {
    const numStr = m[2] ?? m[4]
    const unit = normalizeUnit(m[3] ?? m[5])
    const value = parseFloat(numStr.replace(/,/g, ''))
    if (Number.isNaN(value)) continue
    figures.push({
      raw: m[0].trim(),
      value,
      unit,
      year: nearestYear(text, m.index),
      index: m.index,
    })
  }
  return figures
}

// Converts a figure to a common "millions" scale, or null if its unit
// can't be compared on that scale (percentages, plain cedis amounts, etc).
export function toMillions(f: Figure): number | null {
  if (f.unit === 'million') return f.value
  if (f.unit === 'billion') return f.value * 1000
  return null
}

export interface ExtractedFigureRef extends Figure {
  citationIndex: number  // 1-based [n] this figure was drawn from
}

// Pulls scale-comparable figures (millions/billions) out of the retrieved
// chunks, tagged with their [n] citation index — handed to the model as
// "EXTRACTED FIGURES" so it grounds its analysis in real numbers instead of
// re-deriving (and potentially misreading) them from prose.
export function extractFiguresFromChunks(chunks: { chunk_text: string }[], maxPerChunk = 6): ExtractedFigureRef[] {
  const out: ExtractedFigureRef[] = []
  chunks.forEach((c, i) => {
    const figs = extractFigures(c.chunk_text).filter(f => f.unit && f.unit !== '%')
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
    const fromFig = byYear.get(fromYear)![0]
    const toFig = byYear.get(toYear)![0]
    if (!fromFig || !toFig || fromFig.value === 0) continue
    const growthPct = ((toFig.value - fromFig.value) / fromFig.value) * 100
    results.push({
      fromYear, toYear,
      fromValue: fromFig.value, toValue: toFig.value,
      unit: 'million',
      growthPct: Math.round(growthPct * 10) / 10,
      citations: [...new Set([fromFig.citationIndex, toFig.citationIndex])],
    })
    if (results.length >= maxResults) break
  }
  return results
}

export interface VerificationResult {
  totalNumbers: number
  supportedNumbers: number
  growthChecks: { claimedPct: number; actualPct: number; ok: boolean; sentence: string }[]
  unsupported: string[]
  confidenceScore: number   // 0-100
  confidenceLevel: 'High' | 'Medium' | 'Low'
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
): VerificationResult {
  const sourceText = chunks.map(c => c.chunk_text).join('\n')
  const sourceNorm = normNum(sourceText)

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
      if (sourceNorm.includes(normNum(f.raw)) || sourceText.includes(f.value.toFixed(1))) {
        supportedNumbers++
      } else {
        unsupported.push(f.raw)
      }
    }

    if (percents.length === 1 && amounts.length === 2) {
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
  }

  const avgRetrieval = retrievalScores.length
    ? retrievalScores.reduce((s, v) => s + v, 0) / retrievalScores.length
    : 0
  const retrievalComponent = Math.max(0, Math.min(1, avgRetrieval)) * 100

  const verificationRatio = totalNumbers === 0 ? 1 : supportedNumbers / totalNumbers
  const growthAccuracy = growthChecks.length === 0
    ? 1
    : growthChecks.filter(g => g.ok).length / growthChecks.length

  let confidenceScore = Math.round(
    0.4 * retrievalComponent + 0.4 * verificationRatio * 100 + 0.2 * growthAccuracy * 100,
  )
  confidenceScore = Math.max(1, Math.min(99, confidenceScore))

  const confidenceLevel: VerificationResult['confidenceLevel'] =
    confidenceScore >= 75 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low'

  return { totalNumbers, supportedNumbers, growthChecks, unsupported, confidenceScore, confidenceLevel }
}
