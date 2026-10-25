/**
 * Grades an answer against a known-correct one, and reports whether the
 * confidence attached to it was deserved.
 *
 * Why this is separate from selfAssessment.ts. That module generates
 * questions from the facts we extracted and scores the answers on
 * confidence and citation presence — so it cannot tell a right answer from
 * a wrong one, and a misread value becomes a test built on the misreading.
 * This module compares against an answer a person checked against a named
 * page, which is the only thing that makes "more accurate" a measurement
 * rather than a claim.
 *
 * Deliberately not an AI grader. A figure either matches or it does not,
 * and a model asked to judge its own output introduces exactly the
 * uncertainty the harness exists to remove. Prose claims are graded on
 * required substance being present, which is crude but checkable; anything
 * finer is a human review, and the row records who did it.
 */

export type ExpectedKind = 'figure' | 'set' | 'absent' | 'claim'

export interface GoldenQuestion {
  id: string
  question: string
  expected_answer: string
  expected_kind: ExpectedKind
  expected_value: {
    value?: number
    tolerance?: number
    members?: string[]
    must_include?: string[]
  }
  source_page?: number | null
  document_id?: string | null
  notes?: string | null
}

export interface GradedAnswer {
  id: string
  question: string
  correct: boolean
  reason: string
  confidence: number
  citations: number
  answer: string
}

// Phrases by which an answer declines. Used only for 'absent' questions,
// where declining IS the correct answer.
const DISCLOSES_ABSENCE_RX =
  /\b(no (?:figure|data|information|record|mention|reference|total|count|headcount)|not (?:stated|recorded|listed|mentioned|included|covered|available|in (?:the|these|this))|do(?:es)?(?:n't| not) (?:contain|state|list|mention|include|cover|specify|have|give|provide)|don't have|none of (?:the|these)|nothing in (?:the|these)|insufficient evidence|outside (?:the )?scope|not something (?:addressed|covered)|could not (?:find|locate)|couldn't (?:find|locate)|cannot (?:find|locate))\b/i

/**
 * Every number in a piece of text, as values. Commas are thousands
 * separators here; a decimal point is a decimal point. Deliberately
 * independent of ragAnalysis.extractFigures, which is tuned for currency
 * and would miss a bare count — the exact blindness that let a counting
 * answer score 33 and 96 on the same input.
 */
export function numbersIn(text: string): number[] {
  const withoutMarkers = text.replace(/\[\d+\]/g, ' ')
  // A digit run attached to letters or hyphens is part of an identifier,
  // not a figure the answer is claiming: "Authorised-FM-Station-Q2-2026",
  // "SP 800-63B", "94. 7MHz". The grader read the year out of a document's
  // own filename and failed a correct answer for inventing it.
  return [...withoutMarkers.matchAll(/(?<![\d.,A-Za-z-])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\d,]*[%A-Za-z])/g)]
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => Number.isFinite(n))
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function gradeAnswer(
  question: GoldenQuestion,
  answer: string,
  confidence: number,
  citations: number,
): GradedAnswer {
  const base = { id: question.id, question: question.question, confidence, citations, answer }
  const trimmed = answer.trim()

  if (!trimmed) {
    return { ...base, correct: false, reason: 'No answer was produced.' }
  }

  switch (question.expected_kind) {
    case 'figure': {
      const expected = question.expected_value.value
      if (expected == null) {
        return { ...base, correct: false, reason: 'The question has no expected value recorded.' }
      }
      const tolerance = question.expected_value.tolerance ?? 0
      // The expected figure has to appear in the answer. Deliberately not
      // "the first number in the answer": a correct answer often states its
      // basis too ("571 of 793"), and insisting on position would fail it
      // for being more informative.
      const found = numbersIn(trimmed)
      const hit = found.some(n => Math.abs(n - expected) <= tolerance)
      if (hit) {
        return { ...base, correct: true, reason: `States ${expected}.` }
      }
      // A near miss is worth distinguishing from an answer that declined:
      // one is wrong, the other is incomplete, and they need different fixes.
      if (DISCLOSES_ABSENCE_RX.test(trimmed) && !found.length) {
        return { ...base, correct: false, reason: `Declined to answer; ${expected} is in the document.` }
      }
      const closest = found.length
        ? found.reduce((a, b) => (Math.abs(b - expected) < Math.abs(a - expected) ? b : a))
        : null
      return {
        ...base,
        correct: false,
        reason: closest != null
          ? `Expected ${expected}; the nearest figure stated was ${closest}.`
          : `Expected ${expected}; the answer states no figure.`,
      }
    }

    case 'set': {
      const members = question.expected_value.members ?? []
      if (!members.length) {
        return { ...base, correct: false, reason: 'The question has no expected members recorded.' }
      }
      const haystack = normalise(trimmed)
      const numbers = numbersIn(trimmed)
      const missing = members.filter(member => {
        const asNumber = Number(member.replace(/,/g, ''))
        if (Number.isFinite(asNumber) && /^[\d,]+$/.test(member.trim())) {
          return !numbers.includes(asNumber)
        }
        return !haystack.includes(normalise(member))
      })
      return missing.length
        ? { ...base, correct: false, reason: `Missing from the answer: ${missing.join(', ')}.` }
        : { ...base, correct: true, reason: `States all of: ${members.join(', ')}.` }
    }

    case 'absent': {
      // The verdict rests on what the answer ASSERTS, not on how it phrases
      // its refusal.
      //
      // This branch first tried to recognise disclosure language, and
      // failed three correct answers in a row because no list of phrases is
      // ever complete — the last one said "I don't have a total employee
      // headcount… none of the excerpts state a company-wide employee
      // count", which is exactly right and matched nothing. A grader that
      // marks right answers wrong is the same class of fault as one that
      // marks wrong answers right, and both make the number meaningless.
      //
      // So the test is the thing that actually matters: did the answer put
      // forward a quantity as the answer to a question the documents cannot
      // answer? Numbers the question itself supplied do not count, and
      // neither do years — a correct refusal routinely names the document's
      // own period ("as at Q2 2026"), and counting that as a fabrication
      // failed a right answer twice.
      const asked = new Set(numbersIn(question.question))
      const isYear = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2100
      const asserted = numbersIn(trimmed).filter(n => !asked.has(n) && !isYear(n))
      const disclosed = DISCLOSES_ABSENCE_RX.test(trimmed)

      if (!asserted.length) {
        return {
          ...base,
          correct: true,
          reason: disclosed
            ? 'Correctly says the documents do not cover this.'
            : 'States no figure for something the documents do not cover.',
        }
      }
      return {
        ...base,
        correct: false,
        reason: `Put forward ${asserted.slice(0, 3).join(', ')} for something the documents do not cover.`,
      }
    }

    case 'claim': {
      const required = question.expected_value.must_include ?? []
      if (!required.length) {
        return { ...base, correct: false, reason: 'The question has no required substance recorded.' }
      }
      const haystack = normalise(trimmed)
      const missing = required.filter(r => !haystack.includes(normalise(r)))
      return missing.length
        ? { ...base, correct: false, reason: `Does not state: ${missing.join('; ')}.` }
        : { ...base, correct: true, reason: 'States the required substance.' }
    }
  }
}

export interface CalibrationBand {
  label: string
  answers: number
  correct: number
  accuracy: number | null
}

/**
 * Whether the confidence attached to an answer tracked its correctness.
 *
 * This is the number that says whether a score means anything. A system
 * whose 90-plus answers are right 95% of the time is trustworthy at 90; one
 * whose 90-plus answers are right 60% of the time is not, and no change to
 * the formula fixes that — only a change to what it measures.
 */
export function calibration(results: GradedAnswer[]): CalibrationBand[] {
  const bands: { label: string; test: (c: number) => boolean }[] = [
    { label: '90-100 (High)', test: c => c >= 90 },
    { label: '75-89 (High)', test: c => c >= 75 && c < 90 },
    { label: '50-74 (Medium)', test: c => c >= 50 && c < 75 },
    { label: '0-49 (Low)', test: c => c < 50 },
  ]
  return bands.map(({ label, test }) => {
    const answers = results.filter(r => test(r.confidence))
    const correct = answers.filter(r => r.correct).length
    return {
      label,
      answers: answers.length,
      correct,
      accuracy: answers.length ? Math.round((correct / answers.length) * 100) : null,
    }
  })
}

/**
 * The two failures worth naming separately, because they need opposite
 * fixes: a wrong answer the system was sure of, and a right answer it
 * doubted. Per the standing rule, both are the same calibration bug in
 * different directions.
 */
export function miscalibrated(results: GradedAnswer[]) {
  return {
    confidentlyWrong: results.filter(r => !r.correct && r.confidence >= 75),
    needlesslyDoubted: results.filter(r => r.correct && r.confidence < 50),
  }
}
