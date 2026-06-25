/**
 * Self-improvement, phase 2: closes the loop from "a recurring gap was
 * flagged" to "the underlying data was actually re-extracted and the gap
 * re-tested" — without a human needing to remember to run refacts-all.ts
 * by hand, which is exactly what happened earlier tonight (the network-
 * classifier fix sat unapplied to 2021's data until I manually re-ran it).
 *
 * Deliberately narrow in what it's allowed to do: it can only re-run the
 * EXISTING, already-tested extraction pipeline (reExtractDocumentFacts)
 * against a document the gap detector already attributed the failure to —
 * it never modifies scoring logic, confidence thresholds, or extraction
 * code itself. See the Day-2 discussion: diagnosing a root cause (like the
 * Total/component conflation found earlier) takes engineering judgment
 * that isn't safe to automate; re-applying an already-reviewed fix is.
 *
 * Each (document, gap topic) pair is attempted at most once — enforced by
 * a unique index on auto_reprocess_log(document_id, gap_topic), not just
 * application logic, so a retry race can't double-attempt. If a document
 * still fails its regression question after one re-extraction, that's a
 * signal the root cause ISN'T stale extraction (which re-running fixes) —
 * a human needs to look at it, and retrying again would just burn AI calls
 * in a loop with no chance of a different outcome.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeRecurringGaps } from './extractionGaps'
import { reExtractDocumentFacts } from './reExtract'
import { REGRESSION_QUESTIONS, scoreRegressionAnswer } from './selfAssessment'

export interface AutoReprocessAttempt {
  documentId: string
  gapTopic: string
  result: 'improved' | 'unchanged' | 'error'
  detail: string
}

async function askChat(origin: string, cookie: string, query: string): Promise<{
  answer: string; confidenceScore: number; confidenceLevel: string; citationCount: number
}> {
  const res = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ query, newSession: false, agentic: true }),
  })
  if (!res.ok || !res.body) throw new Error(`/api/chat returned ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done: { answer?: string; confidence_score?: number; confidence_level?: string; citations?: unknown[] } | null = null
  for (;;) {
    const { done: streamDone, value } = await reader.read()
    if (streamDone) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const ev = JSON.parse(line.slice(6))
        if (ev.done) done = ev
      } catch { /* partial line, wait for more */ }
    }
  }
  return {
    answer: done?.answer ?? '',
    confidenceScore: done?.confidence_score ?? 0,
    confidenceLevel: done?.confidence_level ?? 'Low',
    citationCount: done?.citations?.length ?? 0,
  }
}

// A single re-extraction (table AI-enhancement pass included) can take
// several minutes for a large document — observed live, individual attempts
// ranged from ~30s to ~9 minutes, and a tenant can accumulate far more
// actionable (document, gap) pairs than fit in one request (19, in that same
// live run). The caller (the self-assessment route) has a hard maxDuration
// of 300s that ALSO has to cover the 10-question regression suite that runs
// before this — a fixed attempt count isn't safe because a single large
// document can blow the whole remaining budget on its own. Tracking a real
// deadline and checking it BEFORE starting each attempt (not just counting
// attempts) is what actually keeps this bounded; the per-attempt AI deadline
// is also clamped to whatever budget remains so one attempt can't run past
// the point where the route itself would be killed anyway. Leftover pairs
// stay in the gap list and get picked up by the next self-assessment run —
// the dedup log makes that safe to split across runs.
const DEADLINE_SAFETY_MARGIN_MS = 15_000
const MIN_VIABLE_ATTEMPT_MS = 30_000

export async function runAutoReprocess(
  svc: SupabaseClient, tenantId: string, origin: string, cookie: string,
  onAttempt?: (attempt: AutoReprocessAttempt) => void,
  deadline: number = Date.now() + 120_000,
): Promise<AutoReprocessAttempt[]> {
  const gaps = await computeRecurringGaps(svc, tenantId)
  const actionable = gaps.filter(g => g.source === 'self_assessment' && g.documentIds.length > 0)
  const attempts: AutoReprocessAttempt[] = []

  outer: for (const gap of actionable) {
    const question = REGRESSION_QUESTIONS.find(q => q.category === gap.topic)
    if (!question) continue

    for (const documentId of gap.documentIds) {
      const remaining = deadline - DEADLINE_SAFETY_MARGIN_MS - Date.now()
      if (remaining < MIN_VIABLE_ATTEMPT_MS) break outer

      const { data: existing } = await svc.from('auto_reprocess_log')
        .select('id').eq('document_id', documentId).eq('gap_topic', gap.topic).maybeSingle()
      if (existing) continue

      let attempt: AutoReprocessAttempt
      try {
        const reExtractResult = await reExtractDocumentFacts(svc, documentId, { force: true, aiDeadlineMs: remaining })
        const retest = await askChat(origin, cookie, question.query)
        const { passed } = scoreRegressionAnswer(question, retest.answer, retest.confidenceScore, retest.confidenceLevel, retest.citationCount)
        attempt = {
          documentId, gapTopic: gap.topic,
          result: passed ? 'improved' : 'unchanged',
          detail: reExtractResult.skipped
            ? `re-extraction skipped (${reExtractResult.reason}); retest confidence ${retest.confidenceScore}`
            : `re-extracted ${reExtractResult.factsPersisted} facts; retest confidence ${retest.confidenceScore}`,
        }
      } catch (e) {
        attempt = { documentId, gapTopic: gap.topic, result: 'error', detail: (e as Error).message }
      }

      attempts.push(attempt)
      onAttempt?.(attempt)
      await svc.from('auto_reprocess_log').insert({
        tenant_id: tenantId, document_id: documentId, gap_topic: gap.topic,
        result: attempt.result, detail: attempt.detail,
      })
    }
  }

  return attempts
}
