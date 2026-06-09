import { createClient } from '@/lib/supabase/client'
import type { Document } from '@/types'

interface UploadMeta {
  title?: string
  department?: string | null
  sensitivity?: string
}

/**
 * Uploads a file straight from the browser to Supabase Storage via a
 * signed URL, then asks the server to finalize it. Vercel's serverless
 * functions hard-cap request bodies at ~4.5 MB — a multipart POST carrying
 * the file itself would be rejected for anything larger (the "Network error"
 * users saw on multi-MB PDFs in production, even though `next dev` has no
 * such limit). Routing the file bytes directly to storage and only sending
 * small JSON payloads to our API routes sidesteps that limit entirely.
 */
export async function uploadDocument(file: File, meta: UploadMeta = {}): Promise<{ document?: Document; error?: string }> {
  const urlRes  = await fetch('/api/documents/upload-url', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ filename: file.name, fileSize: file.size }),
  })
  const urlData = await urlRes.json().catch(() => ({}))
  if (!urlRes.ok) return { error: urlData.error ?? 'Could not start upload' }

  const supabase = createClient()
  const { error: upErr } = await supabase.storage
    .from('documents')
    .uploadToSignedUrl(urlData.path, urlData.token, file, {
      contentType: file.type || 'application/octet-stream',
    })
  if (upErr) return { error: `File upload failed: ${upErr.message}` }

  const finalizeRes = await fetch('/api/documents/finalize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path:             urlData.path,
      title:            meta.title,
      department:       meta.department ?? null,
      sensitivity:      meta.sensitivity ?? 'internal',
      originalFilename: file.name,
      fileSize:         file.size,
      mimeType:         file.type,
    }),
  })
  const finalizeData = await finalizeRes.json().catch(() => ({}))
  if (!finalizeRes.ok) return { error: finalizeData.error ?? 'Could not process document' }
  return { document: finalizeData.document as Document }
}
