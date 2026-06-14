/**
 * Regression suite for the RAG pipeline — a small, fixed set of
 * representative questions replayed through /api/chat after each reliability
 * iteration. Each question carries a lightweight pass/fail rubric based on
 * confidence score, citation presence, and (for known-insufficient
 * questions) whether the answer honestly disclosed the gap rather than
 * overclaiming.
 *
 * This intentionally does NOT assert exact figures — source documents change
 * as the knowledge base grows, and hard-coded expected numbers would make the
 * suite brittle. Instead it checks the SHAPE of a good answer: is it
 * confident and cited when evidence exists, and honestly hedged (not a
 * fabricated table) when it doesn't.
 */

export interface RegressionQuestion {
  id: string
  category:
    | 'fact_lookup'
    | 'trend'
    | 'forecast'
    | 'comparison'
    | 'multi_year'
    | 'calculation'
    | 'currency_boundary'
    | 'insufficiency'
    | 'anomaly'
  query: string
  // If true, an honest "insufficient evidence / cannot be reliably
  // constructed" style answer is the CORRECT outcome — passing means the
  // model did NOT fabricate a confident answer.
  expectInsufficiency?: boolean
  // If true (and expectInsufficiency is not set), the answer must cite at
  // least one [n] marker.
  expectCitation?: boolean
  // Minimum acceptable confidence score (0-100) when expectInsufficiency is
  // not set.
  minConfidence?: number
}

export const REGRESSION_QUESTIONS: RegressionQuestion[] = [
  {
    id: 'fact-2026-total-budget',
    category: 'fact_lookup',
    query: 'What was the total national budget appropriation for 2026?',
    expectCitation: true,
    minConfidence: 50,
  },
  {
    id: 'fact-education-2009',
    category: 'fact_lookup',
    query: "What was the Ministry of Education's total allocation for 2009?",
    expectCitation: true,
    minConfidence: 40,
  },
  {
    id: 'trend-education-2008-2009',
    category: 'trend',
    query: 'How did total education sector expenditure change between 2008 and 2009?',
    expectCitation: true,
    minConfidence: 30,
  },
  {
    id: 'forecast-national-budget',
    category: 'forecast',
    query: 'Based on recent trends, what is the projected total national budget allocation for next year?',
    expectCitation: true,
    minConfidence: 25,
  },
  {
    id: 'comparison-education-health-2009',
    category: 'comparison',
    query: 'Compare the Ministry of Education and Ministry of Health allocations for 2009.',
    expectCitation: true,
    minConfidence: 30,
  },
  {
    id: 'multi-year-education-2008-2010',
    category: 'multi_year',
    query: 'What was the Ministry of Education allocation for 2008, 2009, and 2010?',
    expectCitation: true,
    minConfidence: 30,
  },
  {
    id: 'cagr-national-budget-2008-2010',
    category: 'calculation',
    query: 'What is the compound annual growth rate (CAGR) of the total national budget from 2008 to 2010?',
    expectCitation: true,
    minConfidence: 25,
  },
  {
    id: 'currency-boundary-1999-2026',
    category: 'currency_boundary',
    query: 'What was the percentage change in the total national budget allocation from 1999 to 2026?',
    expectInsufficiency: true,
  },
  {
    id: 'insufficiency-1999-2026-series',
    category: 'insufficiency',
    query: 'What was the total national budget allocation for each year from 1999 to 2026?',
    expectInsufficiency: true,
  },
  {
    id: 'anomaly-detection-budget-figures',
    category: 'anomaly',
    query: 'Are there any anomalies or inconsistencies in the validated budget figures?',
    minConfidence: 25,
  },
]

export interface RegressionResult {
  id: string
  category: string
  query: string
  answer: string
  confidenceScore: number
  confidenceLevel: string
  citationCount: number
  passed: boolean
  reason: string
}

// Same broadened pattern as isHonestInsufficiency in chat/route.ts — kept in
// sync manually since the two live in different request lifecycles.
const HONEST_INSUFFICIENCY_RX = /\b(insufficient evidence|cannot (?:be )?(?:reliably |responsibly )?(?:computed|produced|determined|calculated|constructed|derived|established|summarized|compute|produce|determine|calculate|construct|derive|establish|summarize)|no validated [\w\s/-]{0,40}?(?:facts|figures|allocations?|data)|does not contain (?:a )?(?:consolidated|sufficient)|not (?:enough|sufficient) (?:data|information|evidence))\b/i

export function scoreRegressionAnswer(
  question: RegressionQuestion,
  answer: string,
  confidenceScore: number,
  confidenceLevel: string,
  citationCount: number,
): { passed: boolean; reason: string } {
  if (question.expectInsufficiency) {
    if (HONEST_INSUFFICIENCY_RX.test(answer)) {
      return { passed: true, reason: 'Answer honestly disclosed insufficient evidence, as expected.' }
    }
    if (confidenceLevel !== 'High') {
      return { passed: true, reason: 'Answer hedged with non-High confidence rather than overclaiming.' }
    }
    return { passed: false, reason: 'Expected an honest insufficiency disclosure, but got a confident, unhedged answer.' }
  }

  const minConfidence = question.minConfidence ?? 0
  if (confidenceScore < minConfidence) {
    return { passed: false, reason: `Confidence ${confidenceScore} below minimum ${minConfidence}.` }
  }
  if (question.expectCitation && citationCount === 0) {
    return { passed: false, reason: 'Expected at least one citation, but none were returned.' }
  }
  if (/^insufficient evidence found in the available documents\.?$/i.test(answer.trim())) {
    return { passed: false, reason: 'Expected a substantive answer, but got the standard no-answer message.' }
  }
  return { passed: true, reason: `Confidence ${confidenceScore} >= ${minConfidence}${question.expectCitation ? `, ${citationCount} citation(s)` : ''}.` }
}
