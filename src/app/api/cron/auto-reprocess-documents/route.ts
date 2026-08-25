/**
 * Stage 3 of the extraction-completeness work (see 032_document_auto_
 * reprocess_tracking.sql): today, a document that finishes training with
 * processing_warnings — a degraded run, most confirmed this session to be a
 * transient network blip that a plain re-run clears — just sits there
 * until an admin happens to notice the "degraded" badge and clicks Retry.
 * There is no reason that has to be a human action for the common case.
 *
 * Invoked on a schedule by Vercel Cron (see vercel.json) — NOT wired to
 * anything user-facing. Finds degraded documents across every tenant,
 * re-runs training for a capped batch of them via the existing /train
 * route's cron-secret auth path (see that route's isCronCall branch), and
 * lets each document's own auto_reprocess_count/last_auto_reprocess_at cap
 * how many times it gets retried — if it's still degraded after a few
 * attempts, the cause isn't a transient blip (retrying fixes that) but
 * something a human needs to look at, and retrying forever would just
 * waste API calls in a loop with no chance of a different outcome.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 300 // mirrors /train — this drains each retrain's SSE stream to completion in turn

const MAX_AUTO_REPROCESS_ATTEMPTS = 3
const COOLDOWN_HOURS = 6
// Caps how many documents get retried per cron invocation, to bound total
// time/cost per run — each retrain can itself take minutes, and this
// handler shares the same maxDuration ceiling as /train.
const BATCH_SIZE = 5

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(request: NextRequest) {
  // Vercel adds this header automatically for cron-triggered invocations
  // when CRON_SECRET is set (vercel.com/docs/cron-jobs/manage-cron-jobs
  // #securing-cron-jobs). Without a configured secret, refuse rather than
  // run unauthenticated — this endpoint retrains documents across every
  // tenant, so it must never be reachable by an arbitrary outside request.
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const service = svc()
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()

  const { data: candidates, error } = await service
    .from('documents')
    .select('id, title, tenant_id, auto_reprocess_count, last_auto_reprocess_at')
    .eq('status', 'ready')
    .neq('processing_warnings', '[]')
    .lt('auto_reprocess_count', MAX_AUTO_REPROCESS_ATTEMPTS)
    .or(`last_auto_reprocess_at.is.null,last_auto_reprocess_at.lt.${cooldownCutoff}`)
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[auto-reprocess-documents] candidate query failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: { id: string; title: string; outcome: string }[] = []
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host')}`

  for (const doc of candidates ?? []) {
    // Record the attempt BEFORE calling out — if the retrain itself hangs
    // or this handler gets killed mid-call, the document still shows as
    // having been attempted (and past its cooldown) rather than being
    // retried again immediately on the very next cron tick.
    await service.from('documents').update({
      auto_reprocess_count: (doc.auto_reprocess_count ?? 0) + 1,
      last_auto_reprocess_at: new Date().toISOString(),
    }).eq('id', doc.id)

    try {
      const res = await fetch(`${baseUrl}/api/documents/${doc.id}/train`, {
        method: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET! },
      })
      // /train streams SSE — drain it so this retrain actually finishes
      // before moving to the next document (running two retrains in
      // parallel would have each assume it has the full time budget to
      // itself, when they'd really be splitting the underlying rate limits).
      const reader = res.body?.getReader()
      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }
      results.push({ id: doc.id, title: doc.title, outcome: res.ok ? 'retried' : `http_${res.status}` })
    } catch (err) {
      console.error(`[auto-reprocess-documents] retry failed for ${doc.id}:`, err)
      results.push({ id: doc.id, title: doc.title, outcome: 'error' })
    }
  }

  return NextResponse.json({ checked: candidates?.length ?? 0, results })
}
