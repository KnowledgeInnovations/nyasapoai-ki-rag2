import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { extractText, chunkText, embedBatch, EMBED_BATCH } from '@/lib/documentProcess'

export const maxDuration = 300 // 5 min — extraction + embedding can take a while for large documents

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

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
  if (!['admin', 'exco', 'senior_manager', 'senior', 'middle'].includes(membership.role)) {
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

  try {
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

    // Step 1: extract text
    let text: string
    try {
      text = await extractText(buffer, originalFilename)
    } catch (extractErr) {
      console.error('Text extraction error:', extractErr)
      await serviceClient.from('documents').update({ status: 'failed' }).eq('id', document.id)
      return NextResponse.json(
        { error: `Text extraction failed: ${(extractErr as Error).message}` },
        { status: 500 }
      )
    }

    if (!text.trim()) {
      await serviceClient.from('documents').update({ status: 'failed' }).eq('id', document.id)
      return NextResponse.json(
        { error: 'No text could be extracted. The file may be image-based, password-protected, or corrupted.' },
        { status: 422 }
      )
    }

    // Step 2: paragraph-aware chunking + batch embedding
    // Prepend document title to every chunk so filename searches work via vector search
    const titleLabel = `[Document: ${docTitle}]\n`
    const rawChunks  = chunkText(text)
    const chunks     = rawChunks.map(c => titleLabel + c)

    for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
      const batch = chunks.slice(start, start + EMBED_BATCH)
      let embeddings: number[][]
      try {
        embeddings = await embedBatch(batch)
      } catch (embedErr) {
        console.error('Embedding error at batch', start, embedErr)
        await serviceClient.from('documents').update({ status: 'failed' }).eq('id', document.id)
        return NextResponse.json(
          { error: `Embedding failed: ${(embedErr as Error).message}` },
          { status: 500 }
        )
      }
      await serviceClient.from('document_chunks').insert(
        batch.map((chunkText, j) => ({
          document_id: document.id,
          tenant_id:   membership.tenant_id,
          chunk_text:  chunkText,
          chunk_index: start + j,
          embedding:   embeddings[j],
          metadata: { source: originalFilename, chunk_index: start + j, total_chunks: chunks.length },
        }))
      )
    }

    await serviceClient.from('documents').update({ status: 'ready' }).eq('id', document.id)
    return NextResponse.json({ document: { ...document, status: 'ready' } })
  } catch (err) {
    console.error('Processing error:', err)
    await serviceClient.from('documents').update({ status: 'failed' }).eq('id', document.id)
    return NextResponse.json(
      { error: `Document processing failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
