/**
 * Self-improvement, phase 3 (see migration 026_answer_heuristics). Mirrors
 * the fact_resolutions/applyLearnedHeuristics shape — generate, verify,
 * promote — but for answer-time hedging behavior instead of extraction:
 * gaps like "currency_boundary" and "insufficiency" have no document to
 * re-extract (runAutoReprocess can't touch them), they're a missing rule in
 * the system prompt. A candidate instruction is only ever promoted to
 * 'confirmed' (and therefore actually read by the chat route) after it's
 * verified to fix its target category AND introduce zero regressions across
 * the WHOLE suite — generating a plausible-sounding rule is cheap and
 * wrong-by-default; the regression suite is the one source of truth for
 * whether it actually helped.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { claudeComplete } from './claude'
import { REGRESSION_QUESTIONS, scoreRegressionAnswer, type RegressionResult } from './selfAssessment'

interface Entry<T> { v: T; exp: number }
const HEURISTICS_TTL_MS = 60_000
const heuristicsCache = new Map<string, Entry<string>>()

function evict(cache: Map<string, Entry<unknown>>) {
  const now = Date.now()
  for (const [k, e] of cache) if (e.exp <= now) cache.delete(k)
}

// Read by the chat route on every request — cached per-tenant since it's a
// DB round trip on the hot path, same TTL+Map pattern as server.ts's caches.
export async function getConfirmedHeuristicsText(svc: SupabaseClient, tenantId: string): Promise<string> {
  const hit = heuristicsCache.get(tenantId)
  if (hit && hit.exp > Date.now()) return hit.v

  const { data } = await svc.from('answer_heuristics')
    .select('instruction').eq('tenant_id', tenantId).eq('status', 'confirmed')
  const text = data?.length ? '\n\nLearned rules from past regression failures:\n' + data.map(r => `- ${r.instruction}`).join('\n') : ''

  evict(heuristicsCache)
  heuristicsCache.set(tenantId, { v: text, exp: Date.now() + HEURISTICS_TTL_MS })
  return text
}

async function generateCandidateInstruction(
  category: string, exampleQuestion: string, exampleReason: string,
  priorAttempt: { instruction: string; testDetail: string } | null,
): Promise<string> {
  const prompt = `A RAG assistant's regression suite has a recurring failure in category "${category}".

Example failing question: "${exampleQuestion}"
Why it failed: "${exampleReason}"
${priorAttempt ? `
A previous attempt at fixing this added the instruction: "${priorAttempt.instruction}"
That attempt was REJECTED because: "${priorAttempt.testDetail}"
Write a DIFFERENT, more precisely scoped instruction that still fixes the original failure but avoids causing that same regression — narrow the wording so it only applies to the specific pattern in the example, not to nearby cases that should still get a confident answer.
` : ''}
Write ONE concise imperative instruction sentence (no preamble, no explanation, just the sentence) to add to the assistant's system prompt that would fix this specific failure pattern, without making the assistant over-hedge on unrelated questions it currently answers correctly. Output only the sentence.`

  const text = await claudeComplete({ messages: [{ role: 'user', content: prompt }], maxTokens: 200, temperature: priorAttempt ? 0.4 : 0 })
  return text.trim().replace(/^["“]|["”]$/g, '')
}

async function askChatWithExtraInstruction(
  origin: string, cookie: string, query: string, extraSystemInstruction: string,
): Promise<{ answer: string; confidenceScore: number; confidenceLevel: string; citationCount: number }> {
  const res = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ query, newSession: false, agentic: true, extraSystemInstruction }),
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

export interface PromptFixAttempt {
  category: string
  result: 'confirmed' | 'rejected' | 'error'
  detail: string
}

// Re-runs the WHOLE suite (not just the failing category) with the
// candidate instruction appended, so a fix for one category can't be
// promoted at the cost of silently breaking a question that currently
// passes — the same "verify before promote" discipline as
// isPatternConfirmed, just gated on a live regression run instead of a
// recurrence count.
async function testCandidateAgainstSuite(
  origin: string, cookie: string, category: string, candidate: string,
): Promise<{ passed: boolean; detail: string }> {
  const results: RegressionResult[] = []
  for (const q of REGRESSION_QUESTIONS) {
    try {
      const r = await askChatWithExtraInstruction(origin, cookie, q.query, candidate)
      const { passed, reason } = scoreRegressionAnswer(q, r.answer, r.confidenceScore, r.confidenceLevel, r.citationCount)
      results.push({ id: q.id, category: q.category, query: q.query, answer: r.answer, confidenceScore: r.confidenceScore, confidenceLevel: r.confidenceLevel, citationCount: r.citationCount, documentIds: [], passed, reason })
    } catch (e) {
      results.push({ id: q.id, category: q.category, query: q.query, answer: '', confidenceScore: 0, confidenceLevel: 'Low', citationCount: 0, documentIds: [], passed: false, reason: `Request failed: ${(e as Error).message}` })
    }
  }

  const targetFixed = results.filter(r => r.category === category).every(r => r.passed)
  const regressions = results.filter(r => r.category !== category && !r.passed)
  const passed = targetFixed && regressions.length === 0

  const detail = passed
    ? `Target category now passes; no regressions across ${results.length} questions.`
    : !targetFixed
    ? `Target category "${category}" still fails: ${results.filter(r => r.category === category && !r.passed).map(r => r.reason).join('; ')}`
    : `Fixed "${category}" but introduced ${regressions.length} regression(s): ${regressions.map(r => `${r.id} (${r.reason})`).join('; ')}`
  return { passed, detail }
}

const DEADLINE_SAFETY_MARGIN_MS = 15_000
const MIN_VIABLE_ATTEMPT_MS = 60_000

// Orchestrator, called from the self-assessment route alongside
// runAutoReprocess. Only considers categories with no existing 'confirmed'
// heuristic yet (a confirmed rule is permanent — it doesn't get
// regenerated/re-tested every run) and respects the same shared request
// deadline pattern as runAutoReprocess.
// A category that's genuinely hard to fix without a regression would
// otherwise retry forever, one full regression-suite run at a time, with
// each attempt costing a real AI call plus 10 chat round-trips. After this
// many rejections it's left 'rejected' for a human to look at instead.
const MAX_ATTEMPTS = 5

export async function runAutoPromptFix(
  svc: SupabaseClient, tenantId: string, origin: string, cookie: string,
  failingCategories: { category: string; exampleQuestion: string; exampleReason: string }[],
  onAttempt?: (attempt: PromptFixAttempt) => void,
  deadline: number = Date.now() + 120_000,
): Promise<PromptFixAttempt[]> {
  const { data: existingRows } = await svc.from('answer_heuristics')
    .select('category, status, instruction, test_detail, attempt_count').eq('tenant_id', tenantId)
  const existingByCategory = new Map((existingRows ?? []).map(r => [r.category, r]))

  const attempts: PromptFixAttempt[] = []
  for (const gap of failingCategories) {
    const existing = existingByCategory.get(gap.category)
    if (existing?.status === 'confirmed') continue
    if (existing && existing.attempt_count >= MAX_ATTEMPTS) continue
    const remaining = deadline - DEADLINE_SAFETY_MARGIN_MS - Date.now()
    if (remaining < MIN_VIABLE_ATTEMPT_MS) break

    const nextAttemptCount = (existing?.attempt_count ?? 0) + 1
    let attempt: PromptFixAttempt
    try {
      const priorAttempt = existing && existing.status === 'rejected'
        ? { instruction: existing.instruction, testDetail: existing.test_detail ?? '' }
        : null
      const candidate = await generateCandidateInstruction(gap.category, gap.exampleQuestion, gap.exampleReason, priorAttempt)
      const { passed, detail } = await testCandidateAgainstSuite(origin, cookie, gap.category, candidate)
      await svc.from('answer_heuristics').upsert({
        tenant_id: tenantId, category: gap.category, instruction: candidate,
        status: passed ? 'confirmed' : 'rejected', source_reason: gap.exampleReason,
        test_detail: detail, confirmed_at: passed ? new Date().toISOString() : null,
        attempt_count: nextAttemptCount,
      }, { onConflict: 'tenant_id,category' })
      attempt = { category: gap.category, result: passed ? 'confirmed' : 'rejected', detail: `(attempt ${nextAttemptCount}/${MAX_ATTEMPTS}) ${candidate} — ${detail}` }
      if (passed) heuristicsCache.delete(tenantId)
    } catch (e) {
      attempt = { category: gap.category, result: 'error', detail: (e as Error).message }
    }
    attempts.push(attempt)
    onAttempt?.(attempt)
  }
  return attempts
}
