import { NextRequest, after } from 'next/server'
import path from 'node:path'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractStructuredText, chunkPages, aiCleanTableChunks, embedBatch, EMBED_BATCH } from '@/lib/documentProcess'
import { canAccessTraining } from '@/lib/roles'
import { extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks, runCrossDocumentCorroboration, supersedeForwardProjections, applyLearnedHeuristics, looksLikeBudgetDocument, type FinancialFact } from '@/lib/factExtraction'
import { extractTableRecordsFromPdf } from '@/lib/tableExtraction'
import { extractGenericFacts } from '@/lib/genericFactExtraction'
import type { ProcessingWarning } from '@/types'

// Below this many budget-specific facts, a document is unlikely to be a
// budget statement at all (a real one yields well more from the regex pass
// alone) — run the domain-agnostic extractor as a fallback so it still gets
// a structured, citable fact layer instead of none.
const DOCUMENT_FACTS_FALLBACK_THRESHOLD = 3

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

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeDeadline = Date.now() + PROCESSING_BUDGET_MS
  const { id } = await params
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const service = svc()

  // Fetch document record
  const { data: doc } = await service
    .from('documents')
    .select('id, title, source, file_path, tenant_id, status')
    .eq('id', id)
    .eq('tenant_id', membership.tenant_id)
    .single()

  if (!doc) return new Response('Document not found', { status: 404 })

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: object) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const warnings: ProcessingWarning[] = []
      const warn = (step: string, message: string, network?: boolean) =>
        warnings.push({ step, message, at: new Date().toISOString(), ...(network ? { network: true } : {}) })

      try {
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

        if (!pages.some(p => p.text.trim())) throw new Error('No text could be extracted. The file may be image-based, password-protected, or has an unsupported format.')

        // ── 3. Chunk ──────────────────────────────────────────────
        send({ stage: 'chunking', message: 'Analysing document structure…', progress: 25 })

        const titleLabel = `[Document: ${doc.title}]\n`
        const rawChunks  = chunkPages(pages, doc.title)

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

        // ── 4. Delete old chunks + facts ──────────────────────────
        send({ stage: 'clearing', message: 'Removing previous training data…', progress: 35 })
        await service.from('document_chunks').delete().eq('document_id', id)
        await service.from('financial_facts').delete().eq('document_id', id)
        // document_facts was missing from this clear — confirmed live: a
        // document retrained twice showed 189 total facts in the Training
        // UI (accumulated across runs) while the retrain's own log said it
        // only extracted 89 this time. Every retrain appended a fresh
        // batch on top of the previous run's instead of replacing it,
        // silently duplicating (and, for long-running docs, endlessly
        // growing) the facts shown to the chat model as ground truth.
        await service.from('document_facts').delete().eq('document_id', id)

        // ── 5. Embed in batches ───────────────────────────────────
        const totalBatches = Math.ceil(chunks.length / EMBED_BATCH)
        const allFacts: FinancialFact[] = []

        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch    = chunks.slice(i, i + EMBED_BATCH)
          const batchNum = Math.floor(i / EMBED_BATCH) + 1
          const progress = 35 + Math.round((batchNum / totalBatches) * 55)

          send({
            stage:    'embedding',
            message:  `Embedding batch ${batchNum}/${totalBatches} — ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length} chunks processed`,
            progress,
          })

          const embeddings = await embedBatch(batch.map(c => c.text), routeDeadline)

          const { data: inserted } = await service.from('document_chunks').insert(
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
          ).select('id, document_id, tenant_id, chunk_text, metadata')

          for (const row of inserted ?? []) {
            allFacts.push(...extractFactsFromChunk(row as {
              id: string; document_id: string; tenant_id: string; chunk_text: string; metadata: Record<string, unknown>
            }))
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

        // ── 7. Sanity-check + store the cheap, regex-extracted facts ──
        // (Table extraction, AI-enhanced table facts, the generic-fact
        // fallback, and cross-document reconciliation all move to the
        // background below — see the note at the split point.)
        runSanityChecks(allFacts)
        if (allFacts.length) {
          await service.from('financial_facts').insert(allFacts)
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
              await service.from('financial_facts').insert(enrichmentFacts)
            }

            // ── 7.4. Generic fact extraction fallback (non-budget documents) ──
            // Not every document is a table/budget document — most aren't.
            // This RAG has to extract usable facts out of any document
            // type, so whenever the table-driven paths above found too
            // little, fall back to general-purpose AI fact extraction over
            // the document's own prose/lists/definitions.
            if (allFacts.length + enrichmentFacts.length < DOCUMENT_FACTS_FALLBACK_THRESHOLD) {
              try {
                const genericFacts = await extractGenericFacts(
                  cleanedChunks, membership.tenant_id, id, routeDeadline,
                  ({ reason, network }) => warn('generic_facts_fallback', reason, network),
                )
                if (genericFacts.length) {
                  await service.from('document_facts').insert(genericFacts)
                }
              } catch (err) {
                console.error('[Train] generic fact extraction failed', err)
                warn('generic_facts_fallback', (err as Error).message)
              }
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
            const degradedStepCount = new Set(warnings.map(w => w.step)).size
            const hadNetworkIssue = warnings.some(w => w.network)
            const statusDetail = degradedStepCount
              ? `${degradedStepCount} of ${TOTAL_STEPS} step${degradedStepCount === 1 ? '' : 's'} degraded${hadNetworkIssue ? ' (network interruption — retry recommended)' : ''}`
              : null
            await service.from('documents').update({
              status_detail: statusDetail, processing_warnings: warnings,
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
