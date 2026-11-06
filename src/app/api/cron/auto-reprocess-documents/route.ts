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
import { knownCount } from '@/lib/dbResult'
import { isModelEnabled } from '@/lib/modelSwitch'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 300 // mirrors /train — this drains each retrain's SSE stream to completion in turn

/**
 * Consecutive attempts that achieved NOTHING before a document is left
 * alone.
 *
 * It counts no-progress attempts, not attempts. A large document needs
 * many passes and each one is progress, so charging them against a retry
 * budget strands exactly the documents that most need finishing — which it
 * did: five documents sat part-read for two and a half days.
 */
const MAX_NO_PROGRESS_ATTEMPTS = 3
const COOLDOWN_HOURS = 6
// Caps how many documents get retried per cron invocation, to bound total
// time/cost per run — each retrain can itself take minutes, and this
// handler shares the same maxDuration ceiling as /train.
const BATCH_SIZE = 5

/**
 * How long this invocation gives itself, under the 300s ceiling.
 *
 * The loop below used to start a document whenever one was left, with no
 * regard for the time remaining. A resumable pass takes up to 240s, so the
 * first document could consume the whole invocation and the rest were
 * simply never reached — measured: four documents with `last=never` after
 * two and a half days of nightly runs. Now a document is only started when
 * there is enough time to be worth starting, and the others are reported
 * as deferred rather than silently skipped.
 */
const CRON_BUDGET_MS = 280_000

/**
 * Don't start a document with less than this left.
 *
 * A pass given thirty seconds spends them, records that it achieved
 * nothing, and counts against the document's no-progress budget — worse
 * than not starting at all.
 */
const MIN_SLICE_MS = 90_000

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const msLeft = () => CRON_BUDGET_MS - (Date.now() - startedAt)

  // Vercel adds this header automatically for cron-triggered invocations
  // when CRON_SECRET is set (vercel.com/docs/cron-jobs/manage-cron-jobs
  // #securing-cron-jobs). Without a configured secret, refuse rather than
  // run unauthenticated — this endpoint retrains documents across every
  // tenant, so it must never be reachable by an arbitrary outside request.
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // The nightly retry is the one caller nobody is watching, which makes it
  // the one most likely to quietly run up a bill against a switch someone
  // believed was off. Checked before any candidate is selected, and it
  // reports a clean no-op rather than an error — a cron that "fails" every
  // night while the platform is deliberately paused is noise.
  if (!(await isModelEnabled('training'))) {
    console.log('[auto-reprocess-documents] skipped — AI document processing is switched off')
    return NextResponse.json({ skipped: true, reason: 'AI document processing is switched off', processed: 0 })
  }

  const service = svc()
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()

  const { data: rawCandidates, error } = await service
    .from('documents')
    .select('id, title, tenant_id, auto_reprocess_count, last_auto_reprocess_at, processing_warnings')
    .eq('status', 'ready')
    .neq('processing_warnings', '[]')
    .lt('auto_reprocess_count', MAX_NO_PROGRESS_ATTEMPTS)
    .or(`last_auto_reprocess_at.is.null,last_auto_reprocess_at.lt.${cooldownCutoff}`)
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[auto-reprocess-documents] candidate query failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // A non-empty warnings list is no longer evidence that anything went
  // wrong: that list also carries notes recording what a run RECOVERED —
  // reading a document's image-only pages, for instance. Selecting on the
  // list alone would retry documents whose only entry is a success, once
  // per cooldown until the attempt cap, spending model budget on documents
  // that were already finished. Only a genuine degradation qualifies;
  // entries from before notes existed carry no level and still count.
  const candidates = (rawCandidates ?? []).filter(doc => {
    const warnings = (doc.processing_warnings ?? []) as { level?: string }[]
    return warnings.some(w => w.level !== 'note')
  })
  if ((rawCandidates?.length ?? 0) !== candidates.length) {
    console.log(`[auto-reprocess-documents] ${(rawCandidates?.length ?? 0) - candidates.length} candidate(s) skipped: their only entries record what a run recovered, not a problem`)
  }

  const results: { id: string; title: string; outcome: string }[] = []
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host')}`

  // Housekeeping runs AFTER the documents, on whatever time is left.
  //
  // It used to run first, on the reasoning that it is cheap. Cheap is not
  // free, and it was spending the opening seconds of the only slot the
  // documents had. Both jobs are idempotent and skipping one for an hour
  // costs nothing, whereas a document not reached is a customer's document
  // not finished.
  let reaped: unknown = null
  let billing: unknown = null

  async function housekeeping() {
    for (const [name, path] of [
      ['orphaned-file sweep', '/api/cron/reap-orphaned-files'],
      ['billing sweep', '/api/cron/billing'],
    ] as const) {
      if (msLeft() < 20_000) {
        console.log(`[auto-reprocess] ${name} skipped — no time left this run`)
        if (path.includes('reap')) reaped = { skipped: 'no time left this run' }
        else billing = { skipped: 'no time left this run' }
        continue
      }
      try {
        const r = await fetch(`${baseUrl}${path}`, {
          headers: { 'x-cron-secret': process.env.CRON_SECRET! },
        })
        const body = await r.json().catch(() => ({ error: `status ${r.status}` }))
        if (path.includes('reap')) reaped = body
        else billing = body
        console.log(`[auto-reprocess] ${name}:`, JSON.stringify(body))
      } catch (e) {
        const err = { error: (e as Error).message }
        if (path.includes('reap')) reaped = err
        else billing = err
      }
    }
  }

  const deferred: string[] = []

  for (const doc of candidates) {
    // Only start a document there is time to make progress on. Starting one
    // with seconds left burns them, records nothing done, and charges the
    // document a no-progress attempt for the privilege.
    if (msLeft() < MIN_SLICE_MS) {
      deferred.push(doc.title)
      continue
    }

    // Record the attempt BEFORE calling out — if the retrain itself hangs
    // or this handler gets killed mid-call, the document still shows as
    // having been attempted (and past its cooldown) rather than being
    // retried again immediately on the very next cron tick.
    await service.from('documents').update({
      auto_reprocess_count: (doc.auto_reprocess_count ?? 0) + 1,
      last_auto_reprocess_at: new Date().toISOString(),
    }).eq('id', doc.id)

    // A document whose only outstanding work is fact extraction gets the
    // cheap resumable pass rather than a full retrain. Retraining would
    // delete its chunks and re-pay for PDF extraction, chunking and
    // embedding before reaching facts — which is precisely why such a
    // document never converges: it runs out of budget in the same place
    // every time. The facts-only pass starts where the last one stopped.
    const pendingFacts = knownCount(
      await service
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id)
        .is('facts_extracted_at', null),
      `excerpts awaiting facts for document ${doc.id}`,
    )

    const totalChunks = knownCount(
      await service
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id),
      `indexed excerpts for document ${doc.id}`,
    )

    // Only when the document is already chunked, so there is something to
    // resume over. A document with no chunks at all still needs a retrain.
    //
    // An undetermined count is not zero. Reading it as zero sent a
    // document that only needed its facts finishing into a full retrain
    // instead — which re-pays for extraction, chunking and embedding and
    // runs out of budget in the same place, the exact loop the resumable
    // pass exists to break. Unknown means skip this document this tick and
    // look again on the next one, which costs a day and nothing else.
    if (pendingFacts == null || totalChunks == null) {
      results.push({ id: doc.id, title: doc.title, outcome: 'skipped — could not determine what it still needs' })
      continue
    }
    const resumeFactsOnly = totalChunks > 0 && pendingFacts > 0

    try {
      if (resumeFactsOnly) {
        const r = await fetch(`${baseUrl}/api/documents/${doc.id}/extract-facts`, {
          method: 'POST',
          headers: { 'x-cron-secret': process.env.CRON_SECRET! },
        })
        const body = await r.json().catch(() => ({}))

        // The attempt counter exists to stop a genuinely broken document
        // being retried forever. A resumable pass that actually processed
        // excerpts is not a failed retry — it is progress, and charging it
        // against a 3-attempt budget would strand a large document
        // permanently part-done. So give the attempt back whenever the pass
        // moved forward. The increment above still stands if this handler
        // dies mid-call, which is the case the counter is really protecting.
        // Reset to zero, not back to what it was. The counter means
        // "consecutive attempts that achieved nothing", so any pass that
        // moved the document forward clears the history — otherwise a
        // document needing ten passes accumulates its way to the cap and
        // is abandoned part-read, which is the failure this whole route
        // exists to prevent.
        if (r.ok && (body.processed ?? 0) > 0) {
          await service.from('documents')
            .update({ auto_reprocess_count: 0 })
            .eq('id', doc.id)
        }

        results.push({
          id: doc.id, title: doc.title,
          outcome: r.ok
            ? `facts-resume: ${body.message ?? 'completed'}`
            : `facts-resume failed (${r.status})`,
        })
        continue
      }

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

  await housekeeping()

  if (deferred.length) {
    console.log(`[auto-reprocess] ${deferred.length} document(s) deferred to the next run: ${deferred.join(', ')}`)
  }

  return NextResponse.json({
    checked: candidates?.length ?? 0,
    results,
    deferred,
    msUsed: Date.now() - startedAt,
    orphanedFiles: reaped,
    billing,
  })
}
