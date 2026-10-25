import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { extractGenericFacts } from '@/lib/genericFactExtraction'
import { insertFactsResilient } from '@/lib/documentProcess'
import { alertIncompleteTraining } from '@/lib/trainingAlerts'
import type { ProcessingWarning } from '@/types'

/**
 * Resumable, facts-only pass over a document's existing chunks.
 *
 * Why this exists separately from /train. Training rebuilds a document from
 * the file: it deletes the chunks and facts, re-extracts the PDF, re-chunks,
 * re-embeds, and only then looks for facts — all inside one request budget.
 * On a large document the earlier stages consume most of that budget, the
 * per-call allowance collapses, and fact extraction aborts partway. Retrying
 * does not help, because the retry pays for extraction, chunking and
 * embedding all over again and runs out in the same place. A 40-page station
 * register sat at zero facts through repeated attempts for exactly this
 * reason, with 45 of its 58 excerpts never checked.
 *
 * This route changes the shape of the problem rather than enlarging the
 * budget. It touches neither the file nor the chunks: it reads the chunks
 * that are already indexed, processes those still awaiting facts, records
 * which ones it finished, and returns how many remain. Each pass therefore
 * starts where the last one stopped, and successive passes — by an
 * administrator or by the auto-reprocess cron — converge.
 *
 * Nothing is deleted here. Facts are added; chunks are only ever stamped.
 */

export const maxDuration = 300

// Leave headroom under maxDuration so the run can persist its progress and
// return a response rather than being killed mid-write.
const PASS_BUDGET_MS = 240_000

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface ChunkRow {
  id: string
  chunk_text: string
  page_number: number | null
  section_title: string | null
  fiscal_year: string | null
  ministry: string | null
  sector: string | null
  // Carries page_offsets: where each page starts inside this excerpt's
  // text. Without it, a fact from an excerpt spanning pages is attributed
  // to the page the excerpt began on — see ProcessedChunk.page_offsets.
  metadata: Record<string, unknown> | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const service = svc()

  // Either a Senior user of the owning workspace, or the cron.
  const fromCron =
    !!process.env.CRON_SECRET && request.headers.get('x-cron-secret') === process.env.CRON_SECRET

  let tenantId: string | null = null
  if (fromCron) {
    const { data: doc } = await service.from('documents').select('tenant_id').eq('id', id).maybeSingle()
    tenantId = doc?.tenant_id ?? null
  } else {
    const membership = await getMembership()
    if (!membership || !canAccessTraining(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    tenantId = membership.tenant_id
  }
  if (!tenantId) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Scoped by tenant as well as id, so a document id from another workspace
  // cannot be reached even with a valid session.
  const { data: doc, error: docError } = await service
    .from('documents')
    .select('id, title, tenant_id, processing_warnings')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (docError || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // The queue: chunks of this document not yet checked for facts.
  const { data: pending, error: pendingError } = await service
    .from('document_chunks')
    .select('id, chunk_text, page_number, section_title, fiscal_year, ministry, sector, metadata')
    .eq('document_id', id)
    .is('facts_extracted_at', null)
    .order('chunk_index', { ascending: true })

  if (pendingError) {
    // Includes "column does not exist" before migration 035 has run.
    console.error('[extract-facts] pending query failed:', pendingError)
    return NextResponse.json({
      error: 'Could not read pending excerpts. If this persists, migration 035 may not have been applied.',
    }, { status: 500 })
  }

  const { count: totalChunks } = await service
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', id)

  if (!pending?.length) {
    return NextResponse.json({
      done: true, processed: 0, remaining: 0, totalChunks: totalChunks ?? 0,
      message: 'Every excerpt in this document has already been checked for facts.',
    })
  }

  // Read on its own and tolerantly: before migration 039 the column does
  // not exist, and folding it into the document query would turn a missing
  // column into "document not found" for every pass.
  const { data: profileRow, error: profileError } = await service
    .from('documents').select('extraction_profile').eq('id', id).maybeSingle()
  if (profileError) console.error('[extract-facts] no document profile available:', profileError.message)
  const storedProfile = profileRow?.extraction_profile as { columns?: unknown } | null | undefined
  const profileColumns = Array.isArray(storedProfile?.columns)
    ? (storedProfile!.columns as unknown[]).map(c => String(c)).filter(Boolean)
    : undefined

  const rows = pending as ChunkRow[]
  const byText = new Map<string, string[]>()
  for (const r of rows) {
    const key = r.chunk_text
    byText.set(key, [...(byText.get(key) ?? []), r.id])
  }

  const completedIds = new Set<string>()
  const warnings: ProcessingWarning[] = []

  const facts = await extractGenericFacts(
    rows.map(r => ({
      text: r.chunk_text,
      page_number: r.page_number,
      page_offsets: (r.metadata?.page_offsets as { offset: number; page: number }[] | null) ?? undefined,
      section_title: r.section_title,
      fiscal_year: r.fiscal_year,
      ministry: r.ministry,
      sector: r.sector,
      is_table: false,
    })),
    tenantId,
    id,
    Date.now() + PASS_BUDGET_MS,
    info => {
      warnings.push({
        at: new Date().toISOString(),
        step: 'generic_facts_resume',
        message: info.reason,
        ...(info.network ? { network: true } : {}),
      } as ProcessingWarning)
    },
    batch => {
      // Map each completed excerpt back to the chunk row(s) it came from.
      for (const c of batch) for (const cid of byText.get(c.text) ?? []) completedIds.add(cid)
    },
    // The document's own column headings, from the profile the training run
    // stored (migration 039). A later pass must name attributes the same way
    // the earlier ones did, or the document ends up with the same column
    // under one name for the excerpts done on Monday and another for
    // Tuesday's — which is the inconsistency the vocabulary exists to stop.
    profileColumns,
  )

  // Drop anything this document already holds before inserting.
  //
  // This pass adds without deleting, which is what makes it safe to
  // interrupt — but it also means re-checking an excerpt that was processed
  // under the old pipeline would append a second copy of the same fact. That
  // is precisely the defect the full rebuild's upfront delete was introduced
  // to prevent (a document once showed 189 facts from 89 extracted). Chunks
  // carry no completion marker from before migration 035, so overlap is not
  // merely possible, it is expected on every document that predates it.
  // Paged deliberately: PostgREST caps an unbounded select (1000 rows by
  // default), and a dense table document can hold thousands of facts. A
  // short read here would silently re-admit the duplicates this check
  // exists to keep out.
  const priorFacts: { subject?: string | null; attribute?: string | null; value_text?: string | null; value_number?: number | null; page_number?: number | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data: page, error: pageError } = await service
      .from('document_facts')
      .select('subject, attribute, value_text, value_number, page_number')
      .eq('document_id', id)
      .range(from, from + 999)
    if (pageError) {
      console.error('[extract-facts] could not read existing facts:', pageError.message)
      break
    }
    if (!page?.length) break
    priorFacts.push(...page)
    if (page.length < 1000) break
  }

  const factKey = (f: { subject?: string | null; attribute?: string | null; value_text?: string | null; value_number?: number | null; page_number?: number | null }) =>
    [f.subject ?? '', f.attribute ?? '', f.value_text ?? '', f.value_number ?? '', f.page_number ?? ''].join('').toLowerCase()

  const seenAlready = new Set(priorFacts.map(factKey))
  const beforeDedupe = facts.length
  const newFacts = facts.filter(f => !seenAlready.has(factKey(f)))
  const duplicatesSkipped = beforeDedupe - newFacts.length

  // Persist facts first: a chunk must never be marked done while the facts it
  // produced are still unsaved, or those facts are lost for good.
  let inserted = 0
  if (newFacts.length) {
    await insertFactsResilient(
      () => service.from('document_facts').insert(newFacts),
      'document_facts_insert',
      (step, message, network) => warnings.push({
        at: new Date().toISOString(), step, message,
        ...(network ? { network: true } : {}),
      } as ProcessingWarning),
    )
    inserted = newFacts.length
  }

  // Then stamp the excerpts that were actually checked.
  const stampedAt = new Date().toISOString()
  const ids = [...completedIds]
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const { error } = await service
      .from('document_chunks')
      .update({ facts_extracted_at: stampedAt })
      .in('id', slice)
    if (error) console.error('[extract-facts] stamping failed for a slice:', error)
  }

  const remaining = rows.length - completedIds.size
  const done = remaining === 0

  // Keep the document's warnings honest: on completion, drop the stale
  // extraction warnings that this pass has just resolved rather than leaving
  // a finished document looking permanently degraded.
  const existing = (doc.processing_warnings ?? []) as ProcessingWarning[]
  const kept = done
    ? existing.filter(w => !String(w.step ?? '').startsWith('generic_facts'))
    : existing
  await service.from('documents')
    .update({
      processing_warnings: [...kept, ...warnings],
      status_detail: done
        ? null
        : `Fact extraction in progress — ${remaining} of ${rows.length} excerpts still queued.`,
    })
    .eq('id', id)

  // Tell the workspace's Senior users, once per incident, that this document
  // is not fully indexed yet — it otherwise reads as healthy and the shortfall
  // only shows up later as thinner answers. Sent after the response so a slow
  // or failing mail relay cannot delay or fail the pass itself.
  if (!done) {
    const budgetNote = warnings.find(w => /Time budget reached/i.test(String(w.message ?? '')))
    after(async () => {
      await alertIncompleteTraining(service, {
        tenantId: tenantId!,
        documentId: id,
        documentTitle: doc.title ?? 'Untitled document',
        remaining,
        total: rows.length,
        reason: String(budgetNote?.message ?? 'The processing pass reached its time limit before every excerpt was checked.'),
      })
    })
  }

  return NextResponse.json({
    done,
    processed: completedIds.size,
    remaining,
    totalChunks: totalChunks ?? rows.length,
    factsAdded: inserted,
    duplicatesSkipped,
    message: done
      ? `All excerpts checked. ${inserted} fact(s) added${duplicatesSkipped ? `, ${duplicatesSkipped} duplicate(s) skipped` : ''} in this pass.`
      : `${completedIds.size} excerpt(s) checked this pass, ${remaining} still queued. Run again to continue.`,
  })
}
