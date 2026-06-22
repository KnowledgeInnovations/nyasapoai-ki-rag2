import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractStructuredText, chunkPages, embedBatch, EMBED_BATCH } from '@/lib/documentProcess'
import { normalizeRole, canUploadDocuments } from '@/lib/roles'
import { extractFactsFromChunk, runSanityChecks, type FinancialFact } from '@/lib/factExtraction'
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
      const warn = (step: string, message: string) =>
        warnings.push({ step, message, at: new Date().toISOString() })

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
        const chunks     = rawChunks.map(c => ({ ...c, text: titleLabel + c.text }))
        const totalBatches = Math.ceil(chunks.length / EMBED_BATCH)
        emit({ stage: 'chunked', chunks: chunks.length, totalBatches })

        const allFacts: FinancialFact[] = []

        for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
          const batchNum = start / EMBED_BATCH + 1
          emit({ stage: 'embedding', batch: batchNum, totalBatches })

          const batch = chunks.slice(start, start + EMBED_BATCH)
          let embeddings: number[][]
          try {
            embeddings = await embedBatch(batch.map(c => c.text))
          } catch (embedErr) {
            console.error('Embedding error at batch', start, embedErr)
            return fail(`Embedding failed: ${(embedErr as Error).message}`)
          }
          const { data: inserted } = await serviceClient.from('document_chunks').insert(
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
          ).select('id, document_id, tenant_id, chunk_text, metadata')

          for (const row of inserted ?? []) {
            allFacts.push(...extractFactsFromChunk(row as {
              id: string; document_id: string; tenant_id: string; chunk_text: string; metadata: Record<string, unknown>
            }))
          }

          emit({ stage: 'embedded', batch: batchNum, totalBatches })
        }

        emit({ stage: 'facts', count: allFacts.length })
        runSanityChecks(allFacts)
        if (allFacts.length) {
          await serviceClient.from('financial_facts').insert(allFacts)
        }

        if (allFacts.length < DOCUMENT_FACTS_FALLBACK_THRESHOLD) {
          try {
            const genericFacts = await extractGenericFacts(chunks, membership.tenant_id, document.id, routeDeadline)
            if (genericFacts.length) {
              await serviceClient.from('document_facts').insert(genericFacts)
              emit({ stage: 'facts', count: allFacts.length, genericCount: genericFacts.length })
            }
          } catch (err) {
            console.error('Generic fact extraction error:', err)
            warn('generic_facts_fallback', (err as Error).message)
          }
        }

        const degradedStepCount = new Set(warnings.map(w => w.step)).size
        const statusDetail = degradedStepCount ? `${degradedStepCount} step(s) degraded` : null
        await serviceClient.from('documents').update({
          status: 'ready', status_detail: statusDetail, processing_warnings: warnings,
        }).eq('id', document.id)
        emit({ stage: 'done', document: { ...document, status: 'ready' }, warnings })
        controller.close()
      } catch (err) {
        console.error('Processing error:', err)
        await fail(`Document processing failed: ${(err as Error).message}`)
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}
