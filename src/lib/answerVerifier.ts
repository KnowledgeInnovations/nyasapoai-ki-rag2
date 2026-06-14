/**
 * Phase 3 second-pass AI verifier. A small, deterministic-temperature
 * gpt-4o-mini call that checks the model's own answer against the
 * VALIDATED FACTS block and the retrieved document excerpts, looking for
 * numeric or factual claims that contradict the evidence or aren't
 * supported by it. Complements the regex-based verifyAnswer() in
 * ragAnalysis.ts, which only checks that numbers literally appear
 * somewhere in the chunks (not whether they're attributed correctly).
 *
 * Kept on OpenAI (not Claude) to stay under the Claude org's 10k
 * input-tokens/min rate limit, which the main chat answer call already
 * consumes heavily.
 */

// A function, not a module-level constant — see getAnthropicHeaders() in
// claude.ts for why: Next.js dev-server env reloads can bake a stale/undefined
// key into a constant captured at import time.
function getOpenAIHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  }
}

export interface AnswerVerificationResult {
  issues: string[]
}

interface VerifyAnswerWithAIArgs {
  query: string
  answer: string
  factsBlock: string
  context: string
  signal?: AbortSignal
}

const SYSTEM_PROMPT = `You are a fact-checker. You will be given a QUESTION, an ANSWER produced by another assistant, a VALIDATED FACTS table, and DOCUMENT EXCERPTS.

Check every numeric or factual claim in the ANSWER:
- If it contradicts a value in VALIDATED FACTS, that's an issue.
- If it asserts something not supported by VALIDATED FACTS or the DOCUMENT EXCERPTS, that's an issue.
- If the ANSWER's premise itself is false relative to the evidence (e.g. claims one figure exceeds another when it doesn't), that's an issue.

Currency/unit notation is NOT an issue. "GHS", "GH¢", "¢", "cedis", "GH₵" all refer to the Ghanaian cedi — if the ANSWER writes "GHS 110 million" and the source says "110 million" (or vice versa), that is the SAME figure with an added/omitted currency label, not a discrepancy. Do not flag differences that are purely about whether a currency symbol/code is present, spelled out, or abbreviated. This applies even when the VALIDATED FACTS table includes a "GH¢ million" unit column and the ANSWER's prose simply writes "million" without repeating the currency — that is NEVER an issue.

Numeric formatting is NOT an issue. Two numbers that are mathematically equal — e.g. "27,000" vs "27,000.00", "1.2 billion" vs "1,200 million", "5,100,000,000" vs "5.1bn" — are the SAME value. NEVER flag a difference in trailing zeros, decimal places, thousands separators, or unit-scale notation (million/billion/etc.) when the underlying numeric value is identical. Only flag a number if its actual magnitude is different from the source.

Do NOT report general disclaimers, confidence/reliability assessments, or other meta-commentary about the ANSWER as an "issue" — issues must be concrete factual or numeric contradictions, each naming a specific figure or claim from the ANSWER and the conflicting source value.

If the ANSWER includes a "DEVIATION DETECTION"-style statement comparing a year's value to a "neighboring median" or similar computed baseline (e.g. "3,841 ... vs. neighboring median 7,810.12 ... (-50.8%)"), that is a deliberate, intentional anomaly comparison the ANSWER is reporting — NOT a contradiction between two competing source figures for the same year/entity. Do not flag such comparisons as issues.

Before flagging anything, find the EXACT sentence in the ANSWER containing the claim and re-read it carefully — many candidate issues turn out not to actually be present in the ANSWER text (e.g. the ANSWER already states the correct total/percentage). Only flag a claim if you can quote the specific wrong number or statement that literally appears in the ANSWER. If you are not at least 80% confident an issue is real, do not include it.

When checking a per-year (or per-entity) figure in the ANSWER against the VALIDATED FACTS table, you MUST compare it against the VALIDATED FACTS row for that SAME year/entity — never flag a mismatch against a different year's or entity's row. A figure that correctly matches its own year's row in VALIDATED FACTS is NOT an issue, even if it differs from another year's value.

Respond ONLY with JSON: {"issues": ["short description of issue, including the exact wrong figure quoted from the ANSWER", ...]}. If there are no issues, return {"issues": []}. Keep each issue under 20 words. Do not invent issues — if the ANSWER is well-supported, return an empty array.`

// Extracts numeric tokens from issue text, excluding bare years (1900-2100).
// Must start with a digit — `[\d,]+` alone also matches a lone trailing
// comma (e.g. "...million, should be...") as a spurious NaN "number".
function extractNonYearNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*\.?\d*/g) ?? [])
    .map(s => parseFloat(s.replace(/,/g, '')))
    .filter(n => !(n >= 1900 && n <= 2100 && Number.isInteger(n)))
}

// Two figures count as "the same value" if they're equal after rounding to
// 2 decimals (catches "357,105.64" vs "357,105.639079" — the ANSWER simply
// rounded), or if scaling one by 1e3/1e6/1e9 brings it within rounding
// tolerance of the other (catches a "million" figure vs the equivalent raw
// value, e.g. "31,772.46" vs "31,772,464,382").
function numbersEffectivelyEqual(a: number, b: number): boolean {
  const round2 = (n: number) => Math.round(n * 100) / 100
  if (round2(a) === round2(b)) return true
  for (const scale of [1e3, 1e6, 1e9]) {
    if (round2(a) === round2(b / scale) || round2(a) === round2(b * scale)) return true
  }
  return false
}

// gpt-4o-mini occasionally flags an "issue" like "stated as 2,134.76
// million, should be 2,134.76 million" — same figure on both sides, despite
// the SYSTEM_PROMPT saying not to. Also catches multi-figure phrasings like
// "stated as A/B, should be C/D" — split the non-year numbers into two equal
// halves (stated values, then "should be" values) and check each pair.
function isDegenerateIssue(issue: string): boolean {
  const nums = extractNonYearNumbers(issue)
  if (nums.length < 2 || nums.length % 2 !== 0) return false
  const half = nums.length / 2
  for (let i = 0; i < half; i++) {
    if (!numbersEffectivelyEqual(nums[i], nums[i + half])) return false
  }
  return true
}

interface FactTableRow {
  year: number
  value: number
}

// Parses "| Year | Entity | Metric | Value | Unit | Confidence | Source |"
// rows out of the VALIDATED FACTS markdown table.
function parseFactsTable(factsBlock: string): FactTableRow[] {
  const rows: FactTableRow[] = []
  for (const line of factsBlock.split('\n')) {
    const m = line.match(/^\|\s*(\d{4})\s*\|[^|]*\|[^|]*\|\s*([\d,]+\.?\d*)\s*\|/)
    if (m) rows.push({ year: parseInt(m[1], 10), value: parseFloat(m[2].replace(/,/g, '')) })
  }
  return rows
}

// gpt-4o-mini occasionally flags "<year> X stated as A, should be B" where A
// is actually the correct VALIDATED FACTS value for <year> but B is the
// correct value for a DIFFERENT year — i.e. the verifier compared the
// ANSWER's figure against the wrong row. If the "stated" figure matches its
// own year's row and the "should be" figure matches some other year's row,
// there's no real discrepancy.
function isCrossYearFactMismatch(issue: string, factsBlock: string): boolean {
  const yearMatch = issue.match(/\b(19|20)\d{2}\b/)
  if (!yearMatch) return false
  const year = parseInt(yearMatch[0], 10)
  const nums = extractNonYearNumbers(issue)
  if (nums.length !== 2) return false
  const [stated, claimed] = nums
  const rows = parseFactsTable(factsBlock)
  const statedMatchesOwnYear = rows.some(r => r.year === year && Math.abs(r.value - stated) < 0.01)
  const claimedMatchesOtherYear = rows.some(r => r.year !== year && Math.abs(r.value - claimed) < 0.01)
  return statedMatchesOwnYear && claimedMatchesOtherYear
}

// gpt-4o-mini occasionally flags an "issue" like "No validated healthcare
// allocation figure for 2020 mentioned in the answer" — this is just the
// verifier restating the ANSWER's own disclaimer about missing data, not a
// factual contradiction, despite the SYSTEM_PROMPT saying not to report
// general disclaimers as issues. Detected as: an absence/no-data phrase with
// no "stated as"/"should be"/"contradicts"/numeric-mismatch language.
function isAbsenceMetaIssue(issue: string): boolean {
  const hasContradiction = /\b(stated as|should be|contradicts|instead of|incorrect(ly)?)\b/i.test(issue)
  if (hasContradiction) return false
  return /\bno\b[^.]*\b(figure|data|value|allocation|amount)s?\b[^.]*\b(mentioned|found|available|provided|reported|stated)\b/i.test(issue)
}

// Pulls out the number the verifier claims the ANSWER actually contains —
// from phrasings like "stated as 65.6%" or "65.6% as stated in the answer".
function extractStatedNumber(issue: string): number | null {
  let m = issue.match(/stated\s+as\s+([\d,]+\.?\d*)/i)
  if (!m) m = issue.match(/([\d,]+\.?\d*)\s*%?\s*as\s+stated/i)
  return m ? parseFloat(m[1].replace(/,/g, '')) : null
}

// Checks whether a number appears (in some reasonable formatting) in text.
function numberAppearsIn(num: number, text: string): boolean {
  const variants = [String(num), num.toFixed(1), num.toFixed(2), Math.abs(num).toFixed(1), Math.abs(num).toFixed(2)]
  const normText = text.replace(/[,\s]/g, '')
  return variants.some(v => normText.includes(v))
}

// gpt-4o-mini occasionally claims the ANSWER "stated" a figure it never
// actually wrote — e.g. "Finance sector index rose 65.7% in 2008, not 65.6%
// as stated in the answer" when the ANSWER itself says 65.7%. If the number
// the verifier attributes to the ANSWER doesn't appear anywhere in it, the
// verifier mixed up the figures — the premise of the "issue" is false.
function isFalseStatedValue(issue: string, answer: string): boolean {
  const stated = extractStatedNumber(issue)
  if (stated == null) return false
  return !numberAppearsIn(stated, answer)
}

// gpt-4o-mini sometimes flags the DEVIATION DETECTION block's own "<value>
// vs. neighboring median <baseline>" comparison as a contradiction between
// two source figures for the same year — e.g. "2017 capital expenditure
// reported as 3,841 million contradicts 7,810.12 million median from
// sources". The median is a computed baseline across surrounding years, not
// a competing reported figure for that year, and the comparison is the
// INTENDED anomaly being reported. If the issue mentions "median" and both
// numbers it cites appear together in the ANSWER, it's restating the
// ANSWER's own deliberate comparison — not a real contradiction.
function isDeviationMedianIssue(issue: string, answer: string): boolean {
  if (!/median/i.test(issue)) return false
  const nums = extractNonYearNumbers(issue)
  return nums.length >= 2 && nums.every(n => numberAppearsIn(n, answer))
}

// gpt-4o-mini sometimes calls a claim "misleading" or "incorrect" on purely
// subjective/interpretive grounds (e.g. "Claim of a 1,027% increase is
// misleading", "N/A for Roads and Highways is incorrect") without naming a
// specific conflicting source figure — violating the SYSTEM_PROMPT's own
// requirement that issues name "a specific figure or claim ... and the
// conflicting source value". Without "stated as X" / "should be Y" /
// "contradicts" / "instead of" language, there's nothing actionable to act
// on — filter these out as unsupported subjective commentary.
function isUnsupportedSubjectiveCritique(issue: string): boolean {
  const hasContradictionLanguage = /\b(stated as|should be|contradicts|instead of)\b/i.test(issue)
  if (hasContradictionLanguage) return false
  return /\b(misleading|incorrect|inaccurate|wrong)\b/i.test(issue)
}

export async function verifyAnswerWithAI(
  { query, answer, factsBlock, context, signal }: VerifyAnswerWithAIArgs,
): Promise<AnswerVerificationResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: getOpenAIHeaders(),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `QUESTION:\n${query}\n\nVALIDATED FACTS:${factsBlock || ' (none)'}\n\nDOCUMENT EXCERPTS:\n${context}\n\nANSWER:\n${answer}`,
          },
        ],
      }),
      signal,
    })
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content ?? ''
    if (!raw) return { issues: [] }

    const parsed = JSON.parse(raw)
    const issues: string[] = (Array.isArray(parsed.issues) ? parsed.issues : [])
      .filter((i: unknown): i is string => typeof i === 'string')
      .filter((i: string) => !isDegenerateIssue(i))
      .filter((i: string) => !isCrossYearFactMismatch(i, factsBlock))
      .filter((i: string) => !isAbsenceMetaIssue(i))
      .filter((i: string) => !isFalseStatedValue(i, answer))
      .filter((i: string) => !isDeviationMedianIssue(i, answer))
      .filter((i: string) => !isUnsupportedSubjectiveCritique(i))
    return { issues }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    console.error('[RAG] AI verifier failed:', e)
    return { issues: [] }
  }
}
