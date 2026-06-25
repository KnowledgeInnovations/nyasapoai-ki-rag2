/**
 * Self-improvement, phase 1: recurring-gap flagging. Read-only analysis over
 * existing per-tenant signal (search_reviews verdicts, self_assessments
 * regression results) — never writes anything, never changes a live answer,
 * so it's safe to ship without the regression-testing a retrieval-ranking
 * adjustment (phase 2) would need. Surfaces "these gaps keep coming up" to
 * admins so re-extraction effort goes where it actually helps, instead of
 * needing someone to remember which past reviews/runs flagged a problem.
 *
 * Two independent signal sources, kept separate rather than merged into one
 * fuzzy "topic" via an LLM call — simpler, deterministic, and fast enough to
 * compute on every Training-page load rather than needing a cron job:
 *  - search_reviews: real questions an admin tested via Document Search,
 *    grouped by exact normalized question text. The same question marked
 *    'incorrect' more than once is a genuine recurring gap.
 *  - self_assessments: the fixed regression suite's results, grouped by
 *    category. A category that keeps failing across multiple runs over time
 *    is a standing weakness, not a one-off blip.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecurringGap {
  source: 'search_review' | 'self_assessment'
  topic: string
  occurrences: number
  lastSeenAt: string
  exampleQuestion: string
  exampleReason: string
  // Distinct document_ids the failing self_assessment answers cited, deduped
  // across occurrences. Empty for search_review gaps (no per-document
  // attribution exists for those) or if no failing run cited any document.
  // This is what makes a gap auto-reprocessable rather than just visible.
  documentIds: string[]
}

function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '')
}

// Below this many occurrences, a failure is more likely a one-off than a
// genuine recurring gap worth prioritizing re-extraction effort for.
const MIN_OCCURRENCES = 2

export async function computeRecurringGaps(
  svc: SupabaseClient,
  tenantId: string,
): Promise<RecurringGap[]> {
  const [reviewsRes, assessmentsRes] = await Promise.all([
    svc.from('search_reviews')
      .select('question, verdict, reasoning, created_at')
      .eq('tenant_id', tenantId)
      .eq('verdict', 'incorrect')
      .order('created_at', { ascending: false })
      .limit(500),
    svc.from('self_assessments')
      .select('results, created_at')
      .eq('tenant_id', tenantId)
      .is('document_id', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const gaps: RecurringGap[] = []

  // ── search_reviews: group repeated identical (normalized) questions ──
  const reviewGroups = new Map<string, { count: number; lastSeenAt: string; question: string; reasoning: string }>()
  for (const r of reviewsRes.data ?? []) {
    if (!r.question) continue
    const key = normalizeQuestion(r.question)
    const existing = reviewGroups.get(key)
    if (existing) {
      existing.count++
      if (r.created_at > existing.lastSeenAt) existing.lastSeenAt = r.created_at
    } else {
      reviewGroups.set(key, { count: 1, lastSeenAt: r.created_at, question: r.question, reasoning: r.reasoning ?? '' })
    }
  }
  for (const g of reviewGroups.values()) {
    if (g.count < MIN_OCCURRENCES) continue
    gaps.push({
      source: 'search_review',
      topic: g.question,
      occurrences: g.count,
      lastSeenAt: g.lastSeenAt,
      exampleQuestion: g.question,
      exampleReason: g.reasoning,
      documentIds: [],
    })
  }

  // ── self_assessments: group failed results by category across runs ──
  interface SelfAssessmentResult {
    category: string
    query: string
    passed: boolean
    reason: string
    documentIds?: string[]
  }
  const categoryGroups = new Map<string, { count: number; lastSeenAt: string; query: string; reason: string; documentIds: Set<string> }>()
  for (const run of assessmentsRes.data ?? []) {
    const results = (run.results ?? []) as SelfAssessmentResult[]
    for (const r of results) {
      if (r.passed) continue
      const existing = categoryGroups.get(r.category)
      if (existing) {
        existing.count++
        if (run.created_at > existing.lastSeenAt) existing.lastSeenAt = run.created_at
        for (const id of r.documentIds ?? []) existing.documentIds.add(id)
      } else {
        categoryGroups.set(r.category, { count: 1, lastSeenAt: run.created_at, query: r.query, reason: r.reason, documentIds: new Set(r.documentIds ?? []) })
      }
    }
  }
  for (const [category, g] of categoryGroups) {
    if (g.count < MIN_OCCURRENCES) continue
    gaps.push({
      source: 'self_assessment',
      topic: category,
      occurrences: g.count,
      lastSeenAt: g.lastSeenAt,
      exampleQuestion: g.query,
      exampleReason: g.reason,
      documentIds: [...g.documentIds],
    })
  }

  return gaps.sort((a, b) => b.occurrences - a.occurrences || (b.lastSeenAt > a.lastSeenAt ? 1 : -1))
}
