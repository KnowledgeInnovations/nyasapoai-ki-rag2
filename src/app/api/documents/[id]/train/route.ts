import { NextRequest } from 'next/server'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractText, chunkText, embedBatch, EMBED_BATCH } from '@/lib/documentProcess'

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
  if (!membership || membership.role !== 'admin') {
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

        const text = await extractText(buffer, doc.source)

        if (!text?.trim()) throw new Error('No text could be extracted. The file may be image-based, password-protected, or has an unsupported format.')

        // ── 3. Chunk ──────────────────────────────────────────────
        send({ stage: 'chunking', message: 'Analysing document structure…', progress: 25 })

        const titleLabel = `[Document: ${doc.title}]\n`
        const rawChunks  = chunkText(text)
        const chunks     = rawChunks.map(c => titleLabel + c)

        send({ stage: 'chunking', message: `Document split into ${chunks.length} knowledge chunks`, progress: 30 })

        // ── 4. Delete old chunks ──────────────────────────────────
        send({ stage: 'clearing', message: 'Removing previous training data…', progress: 35 })
        await service.from('document_chunks').delete().eq('document_id', id)

        // ── 5. Embed in batches ───────────────────────────────────
        const totalBatches = Math.ceil(chunks.length / EMBED_BATCH)

        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch    = chunks.slice(i, i + EMBED_BATCH)
          const batchNum = Math.floor(i / EMBED_BATCH) + 1
          const progress = 35 + Math.round((batchNum / totalBatches) * 55)

          send({
            stage:    'embedding',
            message:  `Embedding batch ${batchNum}/${totalBatches} — ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length} chunks processed`,
            progress,
          })

          const embeddings = await embedBatch(batch)

          await service.from('document_chunks').insert(
            batch.map((chunkText, j) => ({
              document_id: id,
              tenant_id:   membership.tenant_id,
              chunk_text:  chunkText,
              chunk_index: i + j,
              embedding:   embeddings[j],
              metadata: {
                source: doc.source,
                chunk_index: i + j,
                total_chunks: chunks.length,
                trained_at: new Date().toISOString(),
              },
            }))
          )
        }

        // ── 6. Mark document as ready ─────────────────────────────
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
