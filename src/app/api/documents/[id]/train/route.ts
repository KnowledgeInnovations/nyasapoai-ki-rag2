import { NextRequest, after } from 'next/server'
import path from 'node:path'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractStructuredText, chunkPages, aiCleanTableChunks, embedBatch, EMBED_BATCH, insertChunkBatch, insertFactsResilient } from '@/lib/documentProcess'
import { canAccessTraining, type Role } from '@/lib/roles'
import { extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks, runCrossDocumentCorroboration, supersedeForwardProjections, applyLearnedHeuristics, looksLikeBudgetDocument, type FinancialFact } from '@/lib/factExtraction'
import { extractTableRecordsFromPdf } from '@/lib/tableExtraction'
import { extractGenericFacts } from '@/lib/genericFactExtraction'
import { profileDocument, headingMatcherFor, type DocumentProfile } from '@/lib/documentProfile'
import { recoverEmptyPagesWithVision, pageTextStore, visionExtractFactsFromPage } from '@/lib/visionExtraction'
import type { ProcessingWarning } from '@/types'

// Below this many budget-specific facts, a document is unlikely to be a
// budget statement at all (a real one yields well more from the regex pass
// alone) — run the domain-agnostic extractor as a fallback so it still gets
// a structured, citable fact layer instead of none.
const DOCUMENT_FACTS_FALLBACK_THRESHOLD = 3

// Caps on how many pages get a vision-model pass per document — a vision
// call costs meaningfully more than a text call, so both stages are scoped
// to CONFIRMED gaps (pages already known to have failed some other way),
// not run speculatively across a whole document. See visionExtraction.ts.
// Stage 1: pages with zero extracted text. Raised from 8 now that they
// are transcribed six at a time and the loop stops on the route's own
// deadline — a wholly scanned document is the normal case for this
// path, not an appendix of two or three image pages.
const MAX_VISION_RECOVERY_PAGES = 60
const MAX_VISION_FACT_PAGES = 10      // Stage 2: table-flagged pages that produced no facts

// Number of independently-degradable steps below (table cleaning, table
// extraction, AI table facts, generic-fact fallback, cross-doc
// corroboration) — keeps the "N of TOTAL_STEPS degraded" summary text
// self-documenting if a step is ever added or removed.
const TOTAL_STEPS = 5

export const maxDuration = 300 // 5 min for large documents

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
}

// Leaves 60s of the 300s maxDuration above as headroom for the remaining
// steps (cross-doc corroboration, status update, response) after generic
// fact extraction stops — see the deadline param on extractGenericFacts.
const PROCESSING_BUDGET_MS = 240_000

// The share of that budget page-image transcription may spend. At about
// ten seconds a page it would otherwise consume the whole allowance and
// leave a scanned document with text but no embeddings.
const VISION_RECOVERY_BUDGET_MS = 100_000

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeDeadline = Date.now() + PROCESSING_BUDGET_MS
  const { id } = await params

  // What the caller asked for, when it said. "continue" picks up the
  // excerpts a previous run left; "rebuild" re-reads the file from scratch.
  // Omitted, the route decides for itself (below) — which is what the cron
  // and any older client get.
  //
  // This exists because the two are genuinely different jobs and only the
  // user knows which one they want. A document that stopped partway needs
  // its remaining excerpts, not a rebuild that re-pays for extraction,
  // chunking and embedding and then runs out of budget in the same place.
  const mode = new URL(_request.url).searchParams.get('mode')

  // Two ways in: the normal authenticated-admin flow (session cookie), or
  // the scheduled auto-heal cron job (api/cron/auto-reprocess-documents)
  // re-running a document that finished degraded last time. The cron path
  // never has a user session, so it authenticates with a server-only
  // shared secret instead and derives tenant_id from the document row
  // itself (the cron route already selected this specific document under
  // its own service-role query) rather than from a membership record.
  const isCronCall = !!process.env.CRON_SECRET && _request.headers.get('x-cron-secret') === process.env.CRON_SECRET
  let membership: { tenant_id: string; role: Role } | null = null
  if (!isCronCall) {
    membership = await getMembership()
    if (!membership || !canAccessTraining(membership.role)) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const service = svc()

  // Fetch document record — scoped by the authenticated user's own tenant
  // for the normal path; the cron path is trusted and already chose this
  // specific document_id, so it derives tenant_id from the row instead.
  let docQuery = service.from('documents').select('id, title, source, file_path, tenant_id, status, processing_warnings').eq('id', id)
  if (membership) docQuery = docQuery.eq('tenant_id', membership.tenant_id)
  const { data: doc } = await docQuery.single()

  if (!doc) return new Response('Document not found', { status: 404 })
  if (!membership) membership = { tenant_id: doc.tenant_id, role: 'senior' }

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: object) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const warnings: ProcessingWarning[] = []
      const warn = (step: string, message: string, network?: boolean) =>
        warnings.push({ step, message, at: new Date().toISOString(), ...(network ? { network: true } : {}), level: 'degraded' })
      // For something that went right but is worth saying. Kept out of the
      // degraded count, so a step that succeeded never reads as a problem.
      const note = (step: string, message: string) =>
        warnings.push({ step, message, at: new Date().toISOString(), level: 'note' })

      try {
        // ── 0. Resume instead of rebuilding, where that is all that's left ──
        //
        // A document whose text is already indexed and whose only deficiency
        // is an incomplete fact layer must NOT be rebuilt from the file.
        // Rebuilding deletes the chunks and re-pays for download, extraction,
        // chunking and embedding out of the same budget before fact
        // extraction even starts — which is exactly why such a document never
        // converges: every attempt runs out of time in the same place.
        // Measured: a 58-chunk register sat at 0 facts with 45 excerpts
        // unchecked through repeated retrains.
        //
        // Resuming spends the entire budget on the work that is actually
        // outstanding, and destroys nothing if it is interrupted.
        const { count: existingChunks } = await service
          .from('document_chunks').select('*', { count: 'exact', head: true }).eq('document_id', id)
        const { count: pendingFactChunks } = await service
          .from('document_chunks').select('*', { count: 'exact', head: true })
          .eq('document_id', id).is('facts_extracted_at', null)

        // Resume only where fact extraction demonstrably stopped early:
        // either it produced nothing, or it recorded that it ran out of
        // budget. Pending chunks alone are not evidence — no chunk created
        // before migration 035 carries a completion marker, so every document
        // predating it looks entirely unprocessed. Without this test a
        // deliberate full rebuild would be silently downgraded to a
        // facts-only pass and the text would never be re-extracted.
        const { count: existingFacts } = await service
          .from('document_facts').select('*', { count: 'exact', head: true }).eq('document_id', id)
        const priorWarnings = (doc as { processing_warnings?: { message?: string }[] }).processing_warnings ?? []
        const stoppedEarly = priorWarnings.some(w => /Time budget reached/i.test(String(w?.message ?? '')))
        const factLayerMissing = (existingFacts ?? 0) === 0

        // pendingFactChunks is null when migration 035 has not run; in that
        // case fall through to the full rebuild rather than guessing.
        // An explicit "continue" is taken at its word whenever there is
        // anything to continue: the caller can see the outstanding count and
        // asked for exactly this. An explicit "rebuild" skips the branch
        // entirely. Only an unspecified request falls back to inferring it.
        const canResume =
          (existingChunks ?? 0) > 0 && pendingFactChunks !== null && (pendingFactChunks ?? 0) > 0

        // A document with pages nobody has managed to read yet is not
        // finished being extracted, so continuing it means reading more of
        // those pages — not skipping to facts over the part already read.
        // The transcriptions are kept (migration 038), so the full path
        // starts where the last run stopped instead of repeating it.
        // Read on its own and tolerantly: before migration 038 the column
        // does not exist, and folding it into the document query would turn
        // a missing column into "document not found" for every training run.
        const { data: unreadRow } = await service
          .from('documents').select('unread_pages').eq('id', id).maybeSingle()
        const unreadPages = unreadRow?.unread_pages ?? 0

        const shouldResume = mode === 'rebuild' || unreadPages > 0
          ? false
          : canResume && (mode === 'continue' || factLayerMissing || stoppedEarly)

        if (shouldResume) {
          send({
            stage: 'resuming',
            message: `Text is already indexed — continuing fact extraction for the remaining ${pendingFactChunks} of ${existingChunks} excerpts.`,
            progress: 10,
          })

          const origin = _request.nextUrl.origin
          const res = await fetch(`${origin}/api/documents/${id}/extract-facts`, {
            method: 'POST',
            headers: process.env.CRON_SECRET ? { 'x-cron-secret': process.env.CRON_SECRET } : {},
          })
          const body = await res.json().catch(() => ({} as Record<string, unknown>))

          if (res.ok) {
            const done = body.done === true
            send({
              stage: done ? 'complete' : 'partial',
              message: String(body.message ?? 'Fact extraction continued.'),
              progress: 100,
              remaining: body.remaining ?? 0,
            })
          } else {
            send({ stage: 'error', message: String(body.error ?? 'Could not continue fact extraction.'), progress: 100 })
          }
          controller.close()
          return
        }

        // ── 1. Download file from storage ────────────────────────
        send({ stage: 'downloading', message: 'Downloading file from storage…', progress: 5 })

        const { data: blob, error: dlErr } = await service.storage
          .from('documents')
          .download(doc.file_path)

        if (dlErr || !blob) throw new Error(`Could not download file: ${dlErr?.message ?? 'unknown error'}`)

        const buffer = Buffer.from(await blob.arrayBuffer())

        // ── 2. Extract text ───────────────────────────────────────
        send({ stage: 'extracting', message: 'Extracting all text content…', progress: 15 })

        const pages = await extractStructuredText(buffer, doc.source)

        // A wholly scanned document used to be rejected here, before the
        // vision recovery below ever ran — so the one case that recovery
        // exists for was the one case it could never reach. A 26-page
        // scanned census volume failed outright with "no text could be
        // extracted" while the machinery to read it sat ten lines further
        // down. The check now happens after the attempt.
        // See the matching note in finalize/route.ts — a document with SOME
        // real text can still have individual pages that extracted nothing
        // (scanned pages, image-only appendices) with no visibility
        // anywhere that they were silently skipped.
        let emptyPageNumbers = pages
          .filter(p => !p.text.trim())
          .map(p => p.page_number)
          .filter((n): n is number => n != null)

        // Vision recovery — see the matching block (and its full comment) in
        // finalize/route.ts. Recovered pages are mutated in place BEFORE
        // chunking runs below.
        if (emptyPageNumbers.length && path.extname(doc.source).toLowerCase() === '.pdf') {
          send({
            stage: 'extracting',
            message: `Reading ${emptyPageNumbers.length} page(s) that hold no text, as images…`,
            progress: 18,
          })
          const result = await recoverEmptyPagesWithVision(
            buffer, pages,
            // A sub-budget, not the route's whole allowance: reading pages
            // as images at ~10s each would otherwise leave nothing for
            // chunking, embedding and facts.
            Math.min(routeDeadline, Date.now() + VISION_RECOVERY_BUDGET_MS),
            MAX_VISION_RECOVERY_PAGES,
            pageTextStore(service, id),
          )
          if (result.recovered || result.reused) {
            note('vision_recovery',
              `Read ${result.recovered} image-only page(s) by transcribing the page image` +
              `${result.reused ? `, and reused ${result.reused} read in an earlier run` : ''}.`)
          }
          emptyPageNumbers = pages
            .filter(p => !p.text.trim())
            .map(p => p.page_number)
            .filter((n): n is number => n != null)
        }

        if (!pages.some(p => p.text.trim())) {
          throw new Error(
            'No text could be extracted, and the pages could not be read as images either. ' +
            'The file may be a scan too faint to read, password-protected, or in an unsupported format.')
        }

        // Whatever's still empty after the vision attempt above genuinely
        // isn't recoverable by this pipeline — surface it as a warning
        // rather than fixing it silently, so an admin can see the gap and
        // decide whether to act on it (re-scan, re-upload a text version).
        if (emptyPageNumbers.length) {
          warn(
            'empty_pages',
            `${emptyPageNumbers.length} of ${pages.length} page(s) still hold no readable text — page(s): ${emptyPageNumbers.slice(0, 25).join(', ')}${emptyPageNumbers.length > 25 ? '…' : ''}. ` +
            `Continue training to read them; the pages already read are kept, so each run starts where the last one stopped.`,
          )
        }
        // Recorded on the document so the Training page can offer to carry
        // on, and say how much of the document has still never been read.
        const { error: unreadErr } = await service.from('documents')
          .update({ unread_pages: emptyPageNumbers.length })
          .eq('id', id)
        if (unreadErr) console.error('[Train] could not record unread pages:', unreadErr.message)

        // ── 3. Work out what shape this document has, then chunk it ──
        //
        // Asked once, before anything downstream assumes a layout. Every
        // structural decision below it was a fixed rule about how a
        // document is laid out, so a document that does not follow those
        // rules degraded silently — it still produced chunks and facts, and
        // the answers were simply worse. See documentProfile.ts.
        send({ stage: 'chunking', message: 'Working out how this document is laid out…', progress: 22 })
        const profile = await profileDocument(pages, doc.title, routeDeadline)
        if (profile) {
          const { error: profileErr } = await service.from('documents')
            .update({ extraction_profile: profile }).eq('id', id)
          if (profileErr) console.error('[Train] could not store the document profile:', profileErr.message)
          note('document_profile',
            `Read as ${profile.kind}${profile.entityNoun ? ` about each ${profile.entityNoun}` : ''}` +
            `${profile.columns.length ? `, with ${profile.columns.length} named column(s)/field(s) used as the vocabulary for extracted facts` : ''}.`)
        }

        send({ stage: 'chunking', message: 'Analysing document structure…', progress: 25 })

        const titleLabel = `[Document: ${doc.title}]\n`
        const rawChunks  = chunkPages(pages, doc.title, undefined, undefined, {
          isHeadingLine: headingMatcherFor(profile),
          recordColumns: profile?.kind === 'records' ? profile.columns : undefined,
        })

        // AI table cleanup — fixes OCR artifacts, misaligned columns,
        // and broken number formatting in table blocks before embedding.
        send({ stage: 'chunking', message: 'AI-cleaning table blocks…', progress: 28 })
        const cleanedChunks = await aiCleanTableChunks(
          rawChunks, routeDeadline,
          ({ reason, network }) => warn('table_cleaning', reason, network),
        ).catch((err) => {
          warn('table_cleaning', (err as Error).message)
          return rawChunks
        })

        const chunks = cleanedChunks.map(c => ({ ...c, text: titleLabel + c.text }))

        send({ stage: 'chunking', message: `Document split into ${chunks.length} knowledge chunks`, progress: 30 })

        // Nothing was extracted, so there is nothing to swap in. Stopping
        // here leaves whatever the document already held untouched and says
        // why, rather than marking an empty document ready — see the same
        // guard in the upload path.
        if (!chunks.length) {
          const detail = 'No readable text could be extracted from this file. ' +
            'If it is a scan or a photograph, it needs to be converted to a text or searchable-PDF form before it can be searched or cited.'
          await service.from('documents')
            .update({ status: 'failed', status_detail: detail })
            .eq('id', id)
          send({ stage: 'error', message: detail, progress: -1 })
          controller.close()
          return
        }

        // ── 4. Embed the whole replacement before touching what exists ──
        //
        // Nothing is deleted here. Training used to delete the document's
        // chunks and both fact tables at this point and rebuild afterwards,
        // with no transaction and no rollback — so a rebuild that failed,
        // timed out or was interrupted left the document holding less than
        // it started with, sometimes nothing. A 108-chunk document was
        // observed going from 266 facts to 0 that way. "Try to improve this
        // document" must not be able to mean "destroy it", so the old data
        // now stands until a complete replacement exists, and the swap
        // happens in one short step at the end.
        const totalBatches = Math.ceil(chunks.length / EMBED_BATCH)
        const allFacts: FinancialFact[] = []
        const embeddedBatches: number[][][] = []

        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch    = chunks.slice(i, i + EMBED_BATCH)
          const batchNum = Math.floor(i / EMBED_BATCH) + 1
          const progress = 35 + Math.round((batchNum / totalBatches) * 45)

          send({
            stage:    'embedding',
            message:  `Embedding batch ${batchNum}/${totalBatches} — ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length} chunks processed`,
            progress,
          })

          embeddedBatches.push(await embedBatch(batch.map(c => c.text), routeDeadline))
        }

        // ── 5. Swap: drop the old chunks and write the new ones ───
        // Anything that could fail slowly — download, extraction, table
        // cleaning, embedding — has already succeeded by the time this
        // runs, which reduces the window in which the document holds
        // neither generation from minutes to the length of these inserts.
        send({ stage: 'clearing', message: 'Replacing previous training data…', progress: 80 })
        await service.from('document_chunks').delete().eq('document_id', id)

        const insertedChunks: { id: string; chunk_text: string }[] = []

        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch    = chunks.slice(i, i + EMBED_BATCH)
          const batchNum = Math.floor(i / EMBED_BATCH) + 1
          const embeddings = embeddedBatches[batchNum - 1]
          send({
            stage:    'embedding',
            message:  `Storing batch ${batchNum}/${totalBatches} — ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length} chunks written`,
            progress: 80 + Math.round((batchNum / totalBatches) * 10),
          })

          // insertWithRetry throws (rather than silently returning
          // null/[]) after exhausting retries — the outer try/catch below
          // marks the document "failed" with the real reason instead of
          // this batch's chunks quietly vanishing while the document still
          // gets marked "ready" with whatever earlier batches DID land.
          const inserted = await insertChunkBatch(
            () => service.from('document_chunks').insert(
              batch.map((c, j) => ({
                document_id: id,
                tenant_id:   membership.tenant_id,
                chunk_text:  c.text,
                chunk_index: i + j,
                embedding:   embeddings[j],
                metadata: {
                  source: doc.source,
                  chunk_index: i + j,
                  total_chunks: chunks.length,
                  page_number: c.page_number,
                  section_title: c.section_title,
                  fiscal_year: c.fiscal_year,
                  ministry: c.ministry,
                  sector: c.sector,
                  is_table: c.is_table,
                  trained_at: new Date().toISOString(),
                },
              }))
            ).select('id, document_id, tenant_id, chunk_text, metadata'),
            `document_chunks insert (batch ${batchNum})`,
          )

          for (const row of inserted) {
            const r = row as {
              id: string; document_id: string; tenant_id: string; chunk_text: string; metadata: Record<string, unknown>
            }
            insertedChunks.push({ id: r.id, chunk_text: r.chunk_text })
            allFacts.push(...extractFactsFromChunk(r))
          }
        }

        // Pass the document's own fiscal year so tableRecordToFact /
        // aiEnhanceTableFacts can flag MTEF columns whose year exceeds the
        // document year as forward_projection rather than letting them
        // compete with actuals.
        const docYearMatch = doc.title.match(/\b(19|20)\d{2}\b/)
        const docFiscalYear = docYearMatch ? docYearMatch[0] : null

        // Cheap document-level check, computed once: does this document show
        // ANY sign of being a government budget statement? If not, skip the
        // two AI-driven budget-specific steps below entirely (6, 6.5) — they
        // were never going to find a ministry/national budget figure in an
        // inflation report or a business report, and running them anyway
        // costs real wall-clock time (one or more Claude calls per table
        // batch) that has previously pushed non-budget uploads past this
        // route's maxDuration, leaving them stuck in "processing" forever.
        // extractFactsFromChunk (the cheap regex pass, already run per chunk
        // above) stays unconditional — it's local computation, not an API
        // call, so there's no cost to leaving it as a safety net.
        const budgetSignal = looksLikeBudgetDocument(chunks.map(c => c.text).join('\n'))

        // Each fact table is cleared once, immediately before the first
        // insert of this run's replacement — never up front.
        //
        // Both properties have to hold at once. Clearing up front destroyed
        // the fact layer whenever a later stage failed; not clearing at all
        // duplicated it (one document showed 189 facts from 89 extracted,
        // because every retrain appended on top of the last). Clearing at
        // the moment of insert gives replacement semantics without a window
        // in which the document holds neither generation.
        //
        // And if this run extracted nothing, the clear never happens: the
        // previous layer stands. Facts keep their own page and section, and
        // their chunk reference is ON DELETE SET NULL, so a kept fact stays
        // citable after the chunk swap above.
        // Excerpt texts whose fact extraction completed in this run.
        const completedFactChunks = new Set<string>()
        let financialCleared = false
        const clearFinancialFactsOnce = async () => {
          if (financialCleared) return
          financialCleared = true
          await service.from('financial_facts').delete().eq('document_id', id)
        }
        let documentFactsCleared = false
        const clearDocumentFactsOnce = async () => {
          if (documentFactsCleared) return
          documentFactsCleared = true
          await service.from('document_facts').delete().eq('document_id', id)
        }

        // ── 7. Sanity-check + store the cheap, regex-extracted facts ──
        // (Table extraction, AI-enhanced table facts, the generic-fact
        // fallback, and cross-document reconciliation all move to the
        // background below — see the note at the split point.)
        runSanityChecks(allFacts)
        if (allFacts.length) {
          await clearFinancialFactsOnce()
          await insertFactsResilient(() => service.from('financial_facts').insert(allFacts), 'financial_facts_insert', warn)
        }
        send({ stage: 'facts', message: `Extracted ${allFacts.length} financial facts`, progress: 95 })

        // ── 8. Mark document as ready and end the SSE stream ──────
        // --- Fast path ends here. --------------------------------------
        // Table-geometry extraction, AI-enhanced table facts, the
        // generic-facts fallback, cross-document corroboration,
        // forward-projection supersession and learned heuristics are all
        // AI-driven enrichment that can legitimately take minutes on a
        // large, image/table-dense document — see genericFactExtraction.ts.
        // Holding this SSE connection open for all of that is fragile: a
        // proxy/idle timeout anywhere between here and the platform's own
        // maxDuration kills the connection with no "complete" or "error"
        // event ever sent, leaving the document stuck on "processing"
        // forever with nothing to explain why. A document only needs its
        // chunks + embeddings to be chat-able (chat/route.ts filters on
        // status "ready" and reads only document_chunks), so mark it ready
        // and let the Training UI move on now — the enrichment facts keep
        // filling in afterwards, in the same invocation, via next/server's
        // after() (bounded by the same maxDuration budget), finishing by
        // writing straight to the document row instead of through the
        // (by-then-closed) SSE stream.
        await service.from('documents').update({ status: 'ready' }).eq('id', id)
        send({
          stage:      'complete',
          message:    `Training complete — ${chunks.length} knowledge chunks stored and ready for AI queries.`,
          progress:   100,
          chunkCount: chunks.length,
          warnings,
        })
        controller.close()

        after(async () => {
          try {
            const enrichmentFacts: FinancialFact[] = []

            // ── 6. Table-aware fact extraction (PDFs only) ────────────
            if (budgetSignal && path.extname(doc.source).toLowerCase() === '.pdf') {
              try {
                const tableRecords = await extractTableRecordsFromPdf(buffer)
                for (const record of tableRecords) {
                  const fact = tableRecordToFact({ ...record, document_id: id }, membership.tenant_id, id, docFiscalYear)
                  if (fact) enrichmentFacts.push(fact)
                }
              } catch (err) {
                console.error('[Train] table extraction failed', err)
                warn('table_extraction', (err as Error).message)
              }
            }

            // ── 6.5. AI-enhanced table fact extraction ────────────────
            // Catches facts the regex pipeline misses: sector breakdowns,
            // footnote totals, multi-year rows with non-standard labels.
            if (budgetSignal) {
              try {
                const aiFacts = await aiEnhanceTableFacts(
                  cleanedChunks, membership.tenant_id, id, docFiscalYear,
                  ({ tableCount, reason, network }) => warn('ai_table_facts', `Could not parse ${tableCount} table batch(es): ${reason}`, network),
                  routeDeadline,
                )
                enrichmentFacts.push(...aiFacts)
              } catch (err) {
                console.error('[Train] AI table fact extraction failed', err)
                warn('ai_table_facts', (err as Error).message)
              }
            }

            if (enrichmentFacts.length) {
              await clearFinancialFactsOnce()
              await insertFactsResilient(() => service.from('financial_facts').insert(enrichmentFacts), 'financial_facts_insert', warn)
            }

            // ── 7.4. Generic fact extraction fallback (non-budget documents) ──
            // Not every document is a table/budget document — most aren't.
            // This RAG has to extract usable facts out of any document
            // type, so whenever the table-driven paths above found too
            // little, fall back to general-purpose AI fact extraction over
            // the document's own prose/lists/definitions.
            let genericFacts: Awaited<ReturnType<typeof extractGenericFacts>> = []
            if (allFacts.length + enrichmentFacts.length < DOCUMENT_FACTS_FALLBACK_THRESHOLD) {
              try {
                genericFacts = await extractGenericFacts(
                  cleanedChunks, membership.tenant_id, id, routeDeadline,
                  ({ reason, network }) => warn('generic_facts_fallback', reason, network),
                  batch => { for (const c of batch) completedFactChunks.add(c.text) },
                  profile?.columns,
                )
                // Replacing a complete layer with a partial one is still
                // leaving the document worse than it started. A dense
                // register costs ~46s an excerpt, so a rebuild of it
                // reliably stops early — and clearing 4,170 facts to insert
                // 1,500 would be a loss dressed up as a refresh. In that
                // case the existing layer stands and the new chunks stay
                // queued, so the resumable pass fills the gap and dedupes
                // against what is already there.
                const { count: priorDocFacts } = await service
                  .from('document_facts').select('*', { count: 'exact', head: true }).eq('document_id', id)
                const stoppedEarly = warnings.some(w => /Time budget reached/i.test(String(w.message ?? '')))
                const wouldLose = stoppedEarly && (priorDocFacts ?? 0) > genericFacts.length

                if (genericFacts.length && !wouldLose) {
                  await clearDocumentFactsOnce()
                  await insertFactsResilient(() => service.from('document_facts').insert(genericFacts), 'document_facts_insert', warn)
                } else if (wouldLose) {
                  warn('generic_facts_fallback',
                    `Kept the ${priorDocFacts} fact(s) this document already held: this run stopped early with only ${genericFacts.length}, ` +
                    `so replacing them would have left the document with less than it started with. The remaining excerpts are queued — ` +
                    `use Continue training to add to the existing facts rather than replacing them.`)
                }
                // Record which excerpts this run actually checked, so the
                // resumable facts-only pass queues only what is left rather
                // than re-reading the whole document.
                if (completedFactChunks.size && !wouldLose) {
                  const byText = new Map<string, string[]>()
                  for (const c of insertedChunks) {
                    byText.set(c.chunk_text, [...(byText.get(c.chunk_text) ?? []), c.id])
                  }
                  // Stored chunk text carries the document-title prefix that
                  // was added before embedding; the extractor sees the text
                  // without it.
                  const stampIds = [...new Set(
                    [...completedFactChunks].flatMap(t => byText.get(titleLabel + t) ?? []),
                  )]
                  const stampedAt = new Date().toISOString()
                  for (let i = 0; i < stampIds.length; i += 200) {
                    const { error: stampErr } = await service
                      .from('document_chunks')
                      .update({ facts_extracted_at: stampedAt })
                      .in('id', stampIds.slice(i, i + 200))
                    if (stampErr) console.error('[Train] stamping chunks failed:', stampErr.message)
                  }
                }
              } catch (err) {
                console.error('[Train] generic fact extraction failed', err)
                warn('generic_facts_fallback', (err as Error).message)
              }
            }

            // ── 7.45. Stage 2 vision backfill ──────────────────────────
            // For a table-flagged chunk whose text-based fact extraction
            // above found nothing on its page — a table can extract as
            // genuinely scrambled/unreadable text even on an otherwise-fine
            // page (see visionExtraction.ts's module comment), so the text
            // extractors correctly decline to guess at it. Re-check just
            // those specific pages against the actual page image. Only
            // targets pages already confirmed to have failed some other
            // way, not run speculatively.
            try {
              const factPages = new Set(genericFacts.map(f => f.page_number).filter((n): n is number => n != null))
              const emptyTablePages = [...new Set(
                cleanedChunks
                  .filter(c => c.is_table && c.page_number != null && !factPages.has(c.page_number))
                  .map(c => c.page_number as number),
              )].slice(0, MAX_VISION_FACT_PAGES)
              if (emptyTablePages.length) {
                const visionFacts: Awaited<ReturnType<typeof visionExtractFactsFromPage>> = []
                for (const pageNum of emptyTablePages) {
                  const facts = await visionExtractFactsFromPage(
                    buffer, pageNum, membership.tenant_id, id, routeDeadline,
                    ({ reason, network }) => warn('vision_facts_backfill', reason, network),
                  )
                  visionFacts.push(...facts)
                }
                if (visionFacts.length) {
                  await clearDocumentFactsOnce()
                  await insertFactsResilient(() => service.from('document_facts').insert(visionFacts), 'document_facts_insert', warn)
                  note('vision_facts_backfill', `Recovered ${visionFacts.length} fact(s) from ${emptyTablePages.length} table page(s) via vision extraction.`)
                }
              }
            } catch (err) {
              console.error('[Train] vision fact backfill failed', err)
              warn('vision_facts_backfill', (err as Error).message)
            }

            // ── 7.5. Cross-document corroboration (national total_budget) ──
            // runSanityChecks above only sees this document's own facts. Now
            // that this document's facts are stored, re-check the FULL national
            // total_budget series across all documents for this tenant — a
            // figure flagged alternate_estimate here may be exactly corroborated
            // by another document.
            try {
              const { data: allNational } = await service
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
                .eq('entity_type', 'national')
                .eq('metric', 'total_budget')
              const changed = runCrossDocumentCorroboration((allNational ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await service.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('[Train] cross-document corroboration failed', err)
              warn('cross_doc_corroboration', (err as Error).message)
            }

            // ── 7.6. Supersede stale forward-projections (ministry/sector) ──
            // This document may BE the actual-year budget for a fiscal year
            // other documents only had forward-looking MTEF projections for —
            // re-check the full ministry/sector series so those older
            // projections stop competing with the real figure.
            try {
              const { data: allMinistrySector } = await service
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
                .in('entity_type', ['ministry', 'sector'])
              const changed = supersedeForwardProjections((allMinistrySector ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await service.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('[Train] forward-projection supersession failed', err)
              warn('forward_projection_supersession', (err as Error).message)
            }

            // ── 7.7. Apply learned heuristics, if confirmed for this tenant ──
            // A no-op until the agentic loop's record_resolution tool has
            // confirmed the same resolution pattern across enough distinct
            // entities for this tenant (see isPatternConfirmed) — at that point
            // it's no longer "the LLM noticed this once" but a rule worth
            // applying deterministically across the whole corpus.
            try {
              const { data: allTenantFacts } = await service
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
              const changed = await applyLearnedHeuristics(service, membership.tenant_id, (allTenantFacts ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await service.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('[Train] learned-heuristic promotion failed', err)
              warn('learned_heuristic_promotion', (err as Error).message)
            }

            // Count distinct DEGRADED STEPS, not total warning entries — a
            // single step (e.g. ai_table_facts) can push multiple warnings, one
            // per dropped batch, which must not read as "every step failed".
            const degradedStepCount = new Set(
              warnings.filter(w => w.level !== 'note').map(w => w.step),
            ).size
            const hadNetworkIssue = warnings.some(w => w.network && w.level !== 'note')
            const statusDetail = degradedStepCount
              ? `${degradedStepCount} of ${TOTAL_STEPS} step${degradedStepCount === 1 ? '' : 's'} degraded${hadNetworkIssue ? ' (network interruption — retry recommended)' : ''}`
              : null
            await service.from('documents').update({
              status_detail: statusDetail, processing_warnings: warnings,
              // A clean run (no warnings at all) means whatever earlier
              // problem this document had is actually resolved now — give
              // it a fresh auto_reprocess_count budget rather than leaving
              // it part-spent from an unrelated past episode, so a NEW
              // degraded run in the future (a different cause) gets its own
              // full set of auto-heal attempts instead of inheriting
              // whatever was left over from this one.
              ...(degradedStepCount === 0 ? { auto_reprocess_count: 0 } : {}),
            }).eq('id', id)
          } catch (err) {
            // The document is already "ready" with its chunks/embeddings —
            // an enrichment-phase crash should never revert that. Just
            // record what happened so it's visible in the Training UI.
            console.error('[Train] background enrichment error', err)
            await service.from('documents').update({
              status_detail: `Enrichment failed: ${(err as Error).message.slice(0, 450)}`,
            }).eq('id', id)
          }
        })

      } catch (err) {
        console.error('[Train]', err)
        // Without this, a fatal error here left the document stuck on
        // 'processing' forever — the SSE error event only reached whoever
        // had the page open at the time, with no persisted record.
        await service.from('documents')
          .update({ status: 'failed', status_detail: (err as Error).message.slice(0, 500) })
          .eq('id', id)
          .then(() => {}, (e) => console.error('[Train] failed to persist failure status', e))
        send({ stage: 'error', message: (err as Error).message, progress: -1 })
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}
