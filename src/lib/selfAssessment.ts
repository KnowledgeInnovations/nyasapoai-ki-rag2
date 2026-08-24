/**
 * Regression suite for the RAG pipeline — representative questions replayed
 * through /api/chat after each reliability iteration. Each question carries
 * a lightweight pass/fail rubric based on confidence score, citation
 * presence, and (for known-insufficient questions) whether the answer
 * honestly disclosed the gap rather than overclaiming.
 *
 * This intentionally does NOT assert exact figures — source documents change
 * as the knowledge base grows, and hard-coded expected numbers would make the
 * suite brittle. Instead it checks the SHAPE of a good answer: is it
 * confident and cited when evidence exists, and honestly hedged (not a
 * fabricated table) when it doesn't.
 *
 * REGRESSION_QUESTIONS below is a fixed, Ghana-budget-document-shaped set —
 * it was the only tenant this suite was ever built against. Confirmed live
 * on a real non-budget tenant (a property/real-estate business): 7 of 10
 * questions failed at 20-26% confidence with zero citations, not because
 * the RAG pipeline was actually broken, but because the suite was asking
 * about Ministry of Education allocations and 2008-2010 CAGR figures that
 * tenant's documents never claimed to have. Worse, this feeds
 * computeRecurringGaps/runAutoReprocess/runAutoPromptFix (extractionGaps.ts,
 * autoReprocess.ts, answerHeuristics.ts) — a tenant-mismatched suite doesn't
 * just misreport health, it can trigger auto-reprocessing and
 * auto-generated prompt "fixes" chasing gaps that were never real.
 *
 * getRegressionQuestions() is the real entry point now: it generates a
 * tenant-grounded suite from that tenant's OWN document inventory and a
 * sample of its OWN extracted facts, keeping the same category labels (so
 * every downstream consumer that groups/matches by `category` keeps working
 * unchanged) and falling back to REGRESSION_QUESTIONS on any failure — a
 * tenant with genuinely no data yet, or a synthesis call that errors, still
 * gets a working (if generic) suite rather than no suite at all.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { claudeComplete } from './claude'

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
  // Distinct document_ids cited by the answer — lets a failing result be
  // traced back to specific documents (e.g. for an auto-reprocess trigger)
  // instead of only a category label with no actionable target.
  documentIds: string[]
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

const REGRESSION_CATEGORIES = [
  'fact_lookup', 'trend', 'forecast', 'comparison', 'multi_year',
  'calculation', 'currency_boundary', 'insufficiency', 'anomaly',
] as const

const GEN_SYSTEM_PROMPT = `You design a regression test suite for a document-QA/RAG system. Given a real tenant's document inventory and a sample of facts already extracted from their documents, write exactly 10 test questions covering the 9 categories listed below — TWO different fact_lookup questions (grounded in two different entities/subjects), and exactly ONE question each for every other category — that this SPECIFIC tenant's system should be tested against. Never double up on any category other than fact_lookup.

Categories (use these exact strings):
- fact_lookup (TWO questions, each grounded in a DIFFERENT entity/subject): a single, specific, answerable fact question grounded in ONE real entity/subject/value from the sample data.
- trend: a question about DIRECTION OR PATTERN across a sequence of 3+ related points — over time if the sample data shows the same metric at different dates/years, otherwise across a natural sequence (e.g. floor-by-floor, phase-by-phase). Must be about a sequence, not just two items — that's what "comparison" below is for, so these two categories don't end up asking near-duplicate questions.
- forecast: a question asking for a projection/prediction. If the sample data contains NO historical series to extrapolate from, this should be a question the system genuinely cannot forecast (mark expectInsufficiency true) — do not invent a time series that isn't there.
- comparison: a single, clean two-way comparison between exactly two real, named entities/subjects from the sample data — distinct from "trend" above, which covers a longer sequence, not a pair.
- multi_year: a multi-part factual question asking for 2-3 real, related data points about the same subject in one question (e.g. several attributes of the same entity, or the same metric across multiple named items) — does not require actual "years" if the tenant has no time-series data, just multiple genuine sub-facts.
- calculation: a question requiring a derived computation (sum, average, difference, ratio) from 2+ REAL figures in the sample data.
- currency_boundary: a plausible-sounding question that assumes a comparison the data does NOT actually support (e.g. spans a gap, mixes incompatible units, or references a period/entity outside what's covered) — this should be one of the two questions with expectInsufficiency true.
- insufficiency: a second, different plausible-sounding question about a topic clearly adjacent to the tenant's real business but NOT covered by anything in the sample data — expectInsufficiency true.
- anomaly: ask whether there are any anomalies/inconsistencies in the tenant's documented figures — this one is domain-agnostic, keep it close to: "Are there any anomalies or inconsistencies in our documented figures?"

Every question except the two expectInsufficiency ones MUST be answerable using ONLY the real entities, subjects, and values shown in the sample data below — never invent a figure, entity, or fact that isn't in the sample. Use the tenant's own terminology (property names, department names, document titles) exactly as given.

Respond ONLY with a JSON array of exactly 10 objects, each shaped:
{"category": "<one of the 9 category strings above>", "query": "<the question text>", "expectInsufficiency": <true only for the currency_boundary and insufficiency questions, false/omitted otherwise>, "expectCitation": <true for every question except the two expectInsufficiency ones>, "minConfidence": <a reasonable integer 25-60 for non-insufficiency questions, omit for insufficiency ones>}`

interface GeneratedQuestion {
  category?: string
  query?: string
  expectInsufficiency?: boolean
  expectCitation?: boolean
  minConfidence?: number
}

function isValidGenerated(q: GeneratedQuestion): q is Required<Pick<GeneratedQuestion, 'category' | 'query'>> & GeneratedQuestion {
  return typeof q.query === 'string' && q.query.trim().length > 0
    && typeof q.category === 'string' && (REGRESSION_CATEGORIES as readonly string[]).includes(q.category)
}

// Generates a tenant-grounded regression suite from that tenant's own
// document inventory + a sample of its own extracted facts (financial_facts
// if this is a budget-shaped tenant, document_facts otherwise). Falls back
// to the static, generic REGRESSION_QUESTIONS on any failure — a tenant
// with no documents yet, a malformed/unparseable model response, or an API
// error all still leave the suite runnable rather than throwing.
export async function getRegressionQuestions(
  svc: SupabaseClient, tenantId: string, orgName: string, orgDescription: string,
): Promise<RegressionQuestion[]> {
  try {
    const { data: docs } = await svc
      .from('documents')
      .select('title, department')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .limit(50)
    if (!docs?.length) return REGRESSION_QUESTIONS

    const [{ data: financialSample }, { data: docFactSample }] = await Promise.all([
      svc.from('financial_facts')
        .select('fiscal_year, entity, entity_type, metric, value, unit')
        .eq('tenant_id', tenantId)
        .gte('confidence', 70)
        .order('fiscal_year', { ascending: false })
        .limit(25),
      svc.from('document_facts')
        .select('subject, attribute, value_text, unit, category')
        .eq('tenant_id', tenantId)
        .gte('confidence', 70)
        .limit(40),
    ])

    const inventoryText = docs.map(d => `- ${d.title}${d.department ? ` [${d.department}]` : ''}`).join('\n')
    const factsText = financialSample?.length
      ? 'SAMPLE VALIDATED FACTS (financial_facts):\n' + financialSample
          .map(f => `- ${f.entity} — ${f.metric} (${f.fiscal_year ?? 'no year'}): ${f.value} ${f.unit}`)
          .join('\n')
      : docFactSample?.length
      ? 'SAMPLE EXTRACTED FACTS (document_facts):\n' + docFactSample
          .map(f => `- [${f.category ?? 'general'}] ${f.subject} — ${f.attribute}: ${f.value_text}${f.unit ? ` ${f.unit}` : ''}`)
          .join('\n')
      : ''
    // No structured facts of either kind — a suite built purely from
    // document titles (no ground-truth values to check calculation/
    // comparison/multi_year questions against) is too weak to trust; the
    // generic fallback is safer than confidently-wrong tenant-shaped
    // questions with nothing to verify them against.
    if (!factsText) return REGRESSION_QUESTIONS

    const raw = await claudeComplete({
      temperature: 0.3,
      maxTokens: 2000,
      system: GEN_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Tenant: ${orgName} — ${orgDescription}\n\nDOCUMENT INVENTORY:\n${inventoryText}\n\n${factsText}`,
      }],
    })

    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return REGRESSION_QUESTIONS
    const parsed = JSON.parse(jsonMatch[0]) as GeneratedQuestion[]
    if (!Array.isArray(parsed)) return REGRESSION_QUESTIONS

    const valid = parsed.filter(isValidGenerated)
    // Require reasonable coverage — a response that only produced 3-4 usable
    // questions (badly malformed JSON, most rows failing validation) isn't
    // a suite worth running; fall back rather than test a fragment of the
    // intended category coverage.
    if (valid.length < 7) return REGRESSION_QUESTIONS

    return valid.map((q, i) => ({
      id: `tenant-${q.category}-${i}`,
      category: q.category as RegressionQuestion['category'],
      query: q.query,
      expectInsufficiency: q.expectInsufficiency || undefined,
      expectCitation: q.expectInsufficiency ? undefined : (q.expectCitation ?? true),
      minConfidence: q.expectInsufficiency ? undefined : (typeof q.minConfidence === 'number' ? q.minConfidence : 30),
    }))
  } catch (e) {
    console.error('[SelfAssessment] tenant-aware question generation failed, using generic fallback:', e)
    return REGRESSION_QUESTIONS
  }
}
