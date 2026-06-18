import { NextRequest } from 'next/server'
import path from 'node:path'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractStructuredText, chunkPages, aiCleanTableChunks, embedBatch, EMBED_BATCH } from '@/lib/documentProcess'
import { canAccessTraining } from '@/lib/roles'
import { extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks, runCrossDocumentCorroboration, type FinancialFact } from '@/lib/factExtraction'
import { extractTableRecordsFromPdf } from '@/lib/tableExtraction'

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

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
        const cleanedChunks = await aiCleanTableChunks(rawChunks).catch(() => rawChunks)

        const chunks = cleanedChunks.map(c => ({ ...c, text: titleLabel + c.text }))

        send({ stage: 'chunking', message: `Document split into ${chunks.length} knowledge chunks`, progress: 30 })

        // ── 4. Delete old chunks + facts ──────────────────────────
        send({ stage: 'clearing', message: 'Removing previous training data…', progress: 35 })
        await service.from('document_chunks').delete().eq('document_id', id)
        await service.from('financial_facts').delete().eq('document_id', id)

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

          const embeddings = await embedBatch(batch.map(c => c.text))

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

        // ── 6. Table-aware fact extraction (PDFs only) ────────────
        if (path.extname(doc.source).toLowerCase() === '.pdf') {
          send({ stage: 'tables', message: 'Extracting tables for financial facts…', progress: 90 })
          try {
            const tableRecords = await extractTableRecordsFromPdf(buffer)
            for (const record of tableRecords) {
              const fact = tableRecordToFact({ ...record, document_id: id }, membership.tenant_id, id, docFiscalYear)
              if (fact) allFacts.push(fact)
            }
          } catch (err) {
            console.error('[Train] table extraction failed', err)
          }
        }

        // ── 6.5. AI-enhanced table fact extraction ────────────────
        // Catches facts the regex pipeline misses: sector breakdowns,
        // footnote totals, multi-year rows with non-standard labels.
        try {
          const aiFacts = await aiEnhanceTableFacts(cleanedChunks, membership.tenant_id, id, docFiscalYear)
          if (aiFacts.length) {
            send({ stage: 'tables', message: `AI extracted ${aiFacts.length} additional financial facts`, progress: 93 })
            allFacts.push(...aiFacts)
          }
        } catch (err) {
          console.error('[Train] AI table fact extraction failed', err)
        }

        // ── 7. Sanity-check + store financial facts ───────────────
        runSanityChecks(allFacts)
        if (allFacts.length) {
          await service.from('financial_facts').insert(allFacts)
        }
        send({ stage: 'facts', message: `Extracted ${allFacts.length} financial facts`, progress: 95 })

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
        }

        // ── 8. Mark document as ready ─────────────────────────────
        await service.from('documents').update({ status: 'ready' }).eq('id', id)

        send({
          stage:      'complete',
          message:    `Training complete — ${chunks.length} knowledge chunks stored and ready for AI queries.`,
          progress:   100,
          chunkCount: chunks.length,
        })

      } catch (err) {
        console.error('[Train]', err)
        send({ stage: 'error', message: (err as Error).message, progress: -1 })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}
