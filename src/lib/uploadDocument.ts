import { createClient } from '@/lib/supabase/client'
import type { Document } from '@/types'

interface UploadMeta {
  title?: string
  department?: string | null
  sensitivity?: string
}

// One progress update from the finalize SSE stream — `stage` is a free-form
// step name (e.g. "extracting", "embedding") plus whatever extra fields that
// step reports (page counts, batch numbers, etc).
export interface ExtractionProgress {
  stage: string
  [key: string]: unknown
}

// Rough size-based processing-time estimate shown to the uploader before/
// during processing, so "why is this still processing" doesn't read as
// broken for a large file. Calibrated from one real measured run this
// session (a 0.12MB/12-page/16-chunk document: ~86s end-to-end, dominated
// by the now-batched generic-fact-extraction step — see
// genericFactExtraction.ts's GENERIC_FACT_BATCH_CHARS) plus the route-level
// 240s processing deadline as a hard ceiling (extractGenericFacts degrades
// gracefully past that point rather than running indefinitely — see the
// `deadline` param). This is a first-pass calibration on a single small
// sample, not a statistically solid curve — intentionally conservative
// (wide range, capped at the deadline) until more real documents of
// varying size have been measured. Re-tighten once that data exists.
const MEASURED_MB = 0.12
const MEASURED_SECONDS = 86
const PROCESSING_DEADLINE_SECONDS = 240

export function estimateProcessingMinutes(fileSizeBytes: number): { lowMinutes: number; highMinutes: number } {
  const sizeMB = Math.max(fileSizeBytes / (1024 * 1024), 0.01)
  const ratio = sizeMB / MEASURED_MB
  // Smaller files have proportionally more fixed overhead (download, model
  // round-trip latency) that doesn't shrink with size — sub-linear scaling
  // (sqrt) avoids implying a tiny file is instant or a huge file is
  // catastrophically slower than the deadline actually allows for.
  const estimatedSeconds = MEASURED_SECONDS * Math.sqrt(ratio)
  const lowSeconds  = Math.max(20, estimatedSeconds * 0.6)
  const highSeconds = Math.min(estimatedSeconds * 1.8, PROCESSING_DEADLINE_SECONDS + 60)
  return {
    lowMinutes:  Math.max(1, Math.round(lowSeconds / 60)),
    highMinutes: Math.max(2, Math.round(highSeconds / 60)),
  }
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
export async function uploadDocument(
  file: File,
  meta: UploadMeta = {},
  onProgress?: (p: ExtractionProgress) => void,
): Promise<{ document?: Document; error?: string }> {
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

  if (!finalizeRes.ok) {
    const finalizeData = await finalizeRes.json().catch(() => ({}))
    return { error: finalizeData.error ?? 'Could not process document' }
  }
  if (!finalizeRes.body) return { error: 'Could not process document' }

  // The finalize endpoint streams progress as SSE ("data: {...}\n\n" lines)
  // and ends with either a "done" (with the document) or "error" event.
  const reader  = finalizeRes.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let document: Document | undefined
  let error: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split('\n\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6)) as ExtractionProgress
      if (event.stage === 'done') document = event.document as Document
      else if (event.stage === 'error') error = (event.error as string) ?? 'Could not process document'
      else onProgress?.(event)
    }
  }

  if (error) return { error }
  if (!document) return { error: 'Could not process document' }
  return { document }
}
