import { NextRequest, NextResponse, after } from 'next/server'
import nodePath from 'node:path'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractStructuredText, chunkPages, aiCleanTableChunks, embedBatch, EMBED_BATCH, insertChunkBatch, insertFactsResilient } from '@/lib/documentProcess'
import { normalizeRole, canUploadDocuments } from '@/lib/roles'
import {
  extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks,
  runCrossDocumentCorroboration, supersedeForwardProjections, applyLearnedHeuristics,
  looksLikeBudgetDocument, type FinancialFact,
} from '@/lib/factExtraction'
import { extractTableRecordsFromPdf } from '@/lib/tableExtraction'
import { extractGenericFacts } from '@/lib/genericFactExtraction'
import type { ProcessingWarning } from '@/types'

export const maxDuration = 300 // 5 min — extraction + embedding can take a while for large documents

// Below this many budget-specific facts, a document is unlikely to be a
// budget statement at all — see train/route.ts for the matching constant
// and full rationale.
const DOCUMENT_FACTS_FALLBACK_THRESHOLD = 3

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface FinalizeBody {
  path?:             string
  title?:            string
  department?:       string | null
  sensitivity?:      string
  originalFilename?: string
  fileSize?:         number
  mimeType?:         string
}

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
}

// Leaves 60s of the 300s maxDuration above as headroom for the remaining
// steps (status update, response) after generic fact extraction stops —
// see the deadline param on extractGenericFacts for why this exists.
const PROCESSING_BUDGET_MS = 240_000

export async function POST(request: NextRequest) {
  const routeDeadline = Date.now() + PROCESSING_BUDGET_MS
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
  if (!canUploadDocuments(normalizeRole(membership.role))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json() as FinalizeBody
  const { path, originalFilename } = body
  if (!path || !originalFilename) {
    return NextResponse.json({ error: 'Missing upload path or filename' }, { status: 400 })
  }
  // The signed-upload path is generated server-side as `${tenant_id}/...` —
  // reject anything else so a forged path can't attach another tenant's file.
  if (!path.startsWith(`${membership.tenant_id}/`)) {
    return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
  }

  const serviceClient = svc()
  const department  = body.department ?? null
  const sensitivity = body.sensitivity || 'internal'
  const docTitle    = body.title?.trim() || originalFilename.replace(/\.[^.]+$/, '')
  const mimeType    = body.mimeType || 'application/octet-stream'

  const { data: document, error: docError } = await serviceClient
    .from('documents')
    .insert({
      tenant_id:   membership.tenant_id,
      uploaded_by: user.id,
      title:       docTitle,
      source:      originalFilename,
      department,
      sensitivity,
      status:      'processing',
      file_path:   path,
      file_size:   body.fileSize ?? 0,
      mime_type:   mimeType,
    })
    .select()
    .single()

  if (docError || !document) {
    console.error('Document insert error:', docError)
    return NextResponse.json({ error: `Failed to create document record: ${docError?.message}` }, { status: 500 })
  }

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))

      const fail = async (error: string, status = 500) => {
        await serviceClient.from('documents')
          .update({ status: 'failed', status_detail: error.slice(0, 500) })
          .eq('id', document.id)
        emit({ stage: 'error', error, status })
        controller.close()
      }

      const warnings: ProcessingWarning[] = []
      const warn = (step: string, message: string, network?: boolean) =>
        warnings.push({ step, message, at: new Date().toISOString(), ...(network ? { network: true } : {}) })

      try {
        emit({ stage: 'downloading' })

        // Retry the download up to 3 times — transient ECONNRESET on Supabase
        // Storage is common on first request after a new connection is established.
        let blob: Blob | null = null
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { data, error: dlErr } = await serviceClient.storage.from('documents').download(path)
          if (data) { blob = data; break }
          if (attempt === 3) throw new Error(`Could not read uploaded file: ${dlErr?.message ?? 'unknown error'}`)
          await new Promise(r => setTimeout(r, attempt * 1000))
        }
        const buffer = Buffer.from(await blob!.arrayBuffer())

        // Step 1: extract text (page-aware where the format supports it)
        emit({ stage: 'extracting' })
        let pages: Awaited<ReturnType<typeof extractStructuredText>>
        try {
          pages = await extractStructuredText(buffer, originalFilename)
        } catch (extractErr) {
          console.error('Text extraction error:', extractErr)
          return fail(`Text extraction failed: ${(extractErr as Error).message}`)
        }

        if (!pages.some(p => p.text.trim())) {
          return fail('No text could be extracted. The file may be image-based, password-protected, or corrupted.', 422)
        }

        // A document with SOME real text passes the check above even if a
        // subset of its pages are individually empty (e.g. a scanned
        // signature page, an appendix inserted as an image, a blank
        // separator page) — those pages silently contribute nothing to the
        // knowledge base with no record anywhere that they were skipped.
        // Surfacing this doesn't fix the underlying content gap (this
        // pipeline has no OCR), but it turns a silent, invisible hole in
        // the document's coverage into something an admin can actually see
        // and decide whether to act on (re-scan, re-upload a text version).
        const emptyPageNumbers = pages
          .filter(p => !p.text.trim())
          .map(p => p.page_number)
          .filter((n): n is number => n != null)
        if (emptyPageNumbers.length) {
          warn(
            'empty_pages',
            `${emptyPageNumbers.length} of ${pages.length} page(s) had no extractable text (likely scanned/image content, not covered by this system) — page(s): ${emptyPageNumbers.slice(0, 25).join(', ')}${emptyPageNumbers.length > 25 ? '…' : ''}`,
          )
        }

        const tableCount = pages.reduce((n, p) => n + (p.tables?.length ?? 0), 0)
        emit({
          stage: 'extracted',
          pages: pages.length,
          pageNumbers: pages.map(p => p.page_number),
          tables: tableCount,
        })

        // Step 2: structure-aware chunking + batch embedding
        // Prepend document title to every chunk so filename searches work via vector search
        emit({ stage: 'chunking' })
        const titleLabel = `[Document: ${docTitle}]\n`
        const rawChunks  = chunkPages(pages, docTitle)

        // AI table cleanup — fixes OCR artifacts, misaligned columns, and
        // broken number formatting in table blocks before embedding. Runs
        // on upload too (not just manual re-train) so a document's first
        // pass already gets the accurate extraction tier.
        emit({ stage: 'chunking', message: 'AI-cleaning table blocks' })
        const cleanedChunks = await aiCleanTableChunks(
          rawChunks, routeDeadline,
          ({ reason, network }) => warn('table_cleaning', reason, network),
        ).catch((err) => {
          warn('table_cleaning', (err as Error).message)
          return rawChunks
        })

        const chunks = cleanedChunks.map(c => ({ ...c, text: titleLabel + c.text }))
        const totalBatches = Math.ceil(chunks.length / EMBED_BATCH)
        emit({ stage: 'chunked', chunks: chunks.length, totalBatches })

        const allFacts: FinancialFact[] = []

        for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
          const batchNum = start / EMBED_BATCH + 1
          emit({ stage: 'embedding', batch: batchNum, totalBatches })

          const batch = chunks.slice(start, start + EMBED_BATCH)
          let embeddings: number[][]
          try {
            embeddings = await embedBatch(batch.map(c => c.text), routeDeadline)
          } catch (embedErr) {
            console.error('Embedding error at batch', start, embedErr)
            return fail(`Embedding failed: ${(embedErr as Error).message}`)
          }
          let inserted: { id: string; document_id: string; tenant_id: string; chunk_text: string; metadata: Record<string, unknown> }[]
          try {
            inserted = await insertChunkBatch(
              () => serviceClient.from('document_chunks').insert(
                batch.map((c, j) => ({
                  document_id: document.id,
                  tenant_id:   membership.tenant_id,
                  chunk_text:  c.text,
                  chunk_index: start + j,
                  embedding:   embeddings[j],
                  metadata: {
                    source: originalFilename,
                    chunk_index: start + j,
                    total_chunks: chunks.length,
                    page_number: c.page_number,
                    section_title: c.section_title,
                    fiscal_year: c.fiscal_year,
                    ministry: c.ministry,
                    sector: c.sector,
                    is_table: c.is_table,
                  },
                }))
              ).select('id, document_id, tenant_id, chunk_text, metadata'),
              `document_chunks insert (batch ${batchNum})`,
            )
          } catch (insertErr) {
            console.error('Chunk insert error at batch', start, insertErr)
            return fail(`Storing document chunks failed: ${(insertErr as Error).message}`)
          }

          for (const row of inserted) {
            allFacts.push(...extractFactsFromChunk(row as {
              id: string; document_id: string; tenant_id: string; chunk_text: string; metadata: Record<string, unknown>
            }))
          }

          emit({ stage: 'embedded', batch: batchNum, totalBatches })
        }

        // Pass the document's own fiscal year so tableRecordToFact /
        // aiEnhanceTableFacts can flag MTEF columns whose year exceeds the
        // document year as forward_projection rather than letting them
        // compete with actuals.
        const docYearMatch = docTitle.match(/\b(19|20)\d{2}\b/)
        const docFiscalYear = docYearMatch ? docYearMatch[0] : null

        // Regex-extracted facts are cheap (pure local computation already
        // gathered per chunk-batch above) — store them now, as part of the
        // fast path.
        emit({ stage: 'facts', count: allFacts.length })
        runSanityChecks(allFacts)
        if (allFacts.length) {
          await insertFactsResilient(() => serviceClient.from('financial_facts').insert(allFacts), 'financial_facts_insert', warn)
        }

        // --- Fast path ends here. ------------------------------------------
        // Everything below (PDF table-geometry extraction, AI-enhanced table
        // facts, the generic-facts fallback, cross-document corroboration,
        // forward-projection supersession, learned heuristics) is AI-driven
        // enrichment that can legitimately take minutes on a large,
        // image/table-dense document — see genericFactExtraction.ts. Holding
        // the browser's upload SSE connection open for all of that is
        // fragile: a proxy/idle timeout anywhere between here and the
        // platform's own maxDuration kills the connection with no "done" or
        // "error" event ever sent, so uploadDocument.ts falls back to the
        // generic "Could not process document" — while the row itself stays
        // stuck at status "processing" forever, since nothing else ever
        // updates it. A document only needs its chunks + embeddings to be
        // chat-able (chat/route.ts filters on status "ready" and reads only
        // document_chunks), so mark it ready and let the browser move on now.
        // The enrichment facts keep filling in afterwards, in the same
        // invocation, via next/server's after() — bounded by the same
        // maxDuration budget — and finish by writing straight to the
        // document row instead of through the (by-then-closed) SSE stream.
        await serviceClient.from('documents').update({ status: 'ready' }).eq('id', document.id)
        emit({ stage: 'done', document: { ...document, status: 'ready' }, warnings })
        controller.close()

        after(async () => {
          try {
            // Cheap document-level check: does this document show any sign of
            // being a government budget statement? If not, skip the two
            // AI-driven budget-specific steps below — see train/route.ts for
            // the full rationale (cost + maxDuration risk on non-budget docs).
            const budgetSignal = looksLikeBudgetDocument(chunks.map(c => c.text).join('\n'))
            const enrichmentFacts: FinancialFact[] = []

            // Table-aware fact extraction (PDFs only)
            if (budgetSignal && nodePath.extname(originalFilename).toLowerCase() === '.pdf') {
              try {
                const tableRecords = await extractTableRecordsFromPdf(buffer)
                for (const record of tableRecords) {
                  const fact = tableRecordToFact({ ...record, document_id: document.id }, membership.tenant_id, document.id, docFiscalYear)
                  if (fact) enrichmentFacts.push(fact)
                }
              } catch (err) {
                console.error('Table extraction error:', err)
                warn('table_extraction', (err as Error).message)
              }
            }

            // AI-enhanced table fact extraction — catches facts the regex
            // pipeline misses: sector breakdowns, footnote totals, multi-year
            // rows with non-standard labels.
            if (budgetSignal) {
              try {
                const aiFacts = await aiEnhanceTableFacts(
                  cleanedChunks, membership.tenant_id, document.id, docFiscalYear,
                  ({ tableCount, reason, network }) => warn('ai_table_facts', `Could not parse ${tableCount} table batch(es): ${reason}`, network),
                  routeDeadline,
                )
                enrichmentFacts.push(...aiFacts)
              } catch (err) {
                console.error('AI table fact extraction error:', err)
                warn('ai_table_facts', (err as Error).message)
              }
            }

            if (enrichmentFacts.length) {
              await insertFactsResilient(() => serviceClient.from('financial_facts').insert(enrichmentFacts), 'financial_facts_insert', warn)
            }

            // Not every document is a table/budget document — most aren't.
            // This RAG has to extract usable facts out of any document type,
            // so whenever the table-driven paths above found too little,
            // fall back to general-purpose AI fact extraction over the
            // document's own prose/lists/definitions.
            if (allFacts.length + enrichmentFacts.length < DOCUMENT_FACTS_FALLBACK_THRESHOLD) {
              try {
                const genericFacts = await extractGenericFacts(
                  cleanedChunks, membership.tenant_id, document.id, routeDeadline,
                  ({ reason, network }) => warn('generic_facts_fallback', reason, network),
                )
                if (genericFacts.length) {
                  await insertFactsResilient(() => serviceClient.from('document_facts').insert(genericFacts), 'document_facts_insert', warn)
                }
              } catch (err) {
                console.error('Generic fact extraction error:', err)
                warn('generic_facts_fallback', (err as Error).message)
              }
            }

            // Cross-document corroboration (national total_budget) — this
            // document's facts are now stored, so re-check the full national
            // total_budget series across all documents for this tenant.
            try {
              const { data: allNational } = await serviceClient
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
                .eq('entity_type', 'national')
                .eq('metric', 'total_budget')
              const changed = runCrossDocumentCorroboration((allNational ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await serviceClient.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('Cross-document corroboration error:', err)
              warn('cross_doc_corroboration', (err as Error).message)
            }

            // Supersede stale forward-projections (ministry/sector) — this
            // document may BE the actual-year budget other documents only had
            // MTEF projections for.
            try {
              const { data: allMinistrySector } = await serviceClient
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
                .in('entity_type', ['ministry', 'sector'])
              const changed = supersedeForwardProjections((allMinistrySector ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await serviceClient.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('Forward-projection supersession error:', err)
              warn('forward_projection_supersession', (err as Error).message)
            }

            // Apply learned heuristics, if confirmed for this tenant.
            try {
              const { data: allTenantFacts } = await serviceClient
                .from('financial_facts')
                .select('*')
                .eq('tenant_id', membership.tenant_id)
              const changed = await applyLearnedHeuristics(serviceClient, membership.tenant_id, (allTenantFacts ?? []) as (FinancialFact & { id: string })[])
              for (const f of changed) {
                await serviceClient.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
              }
            } catch (err) {
              console.error('Learned-heuristic promotion error:', err)
              warn('learned_heuristic_promotion', (err as Error).message)
            }

            const degradedStepCount = new Set(warnings.map(w => w.step)).size
            const hadNetworkIssue = warnings.some(w => w.network)
            const statusDetail = degradedStepCount
              ? `${degradedStepCount} step(s) degraded${hadNetworkIssue ? ' (network interruption — retry recommended)' : ''}`
              : null
            await serviceClient.from('documents').update({
              status_detail: statusDetail, processing_warnings: warnings,
            }).eq('id', document.id)
          } catch (err) {
            // The document is already "ready" with its chunks/embeddings —
            // an enrichment-phase crash should never revert that. Just
            // record what happened so it's visible in the Training UI.
            console.error('Background enrichment error:', err)
            await serviceClient.from('documents').update({
              status_detail: `Enrichment failed: ${(err as Error).message.slice(0, 450)}`,
            }).eq('id', document.id)
          }
        })
      } catch (err) {
        console.error('Processing error:', err)
        await fail(`Document processing failed: ${(err as Error).message}`)
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}
