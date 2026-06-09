/**
 * Shared document processing utilities used by both the upload route
 * and the admin training/re-training route.
 */

import path from 'path'

// The DOMMatrix/ImageData/Path2D polyfills pdf-parse needs are installed in
// src/instrumentation.ts, which Next.js guarantees runs to completion before
// any request — and before pdf-parse is ever imported — so the module
// registry never caches a failed (and permanently un-retriable) evaluation.

type OfficeAst = { toText(): string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseOffice } = require('officeparser') as {
  parseOffice: (input: Buffer, opts?: Record<string, unknown>) => Promise<OfficeAst>
}

export const EMBED_BATCH = 100

const OFFICE_EXTS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.odt', '.ods', '.odp',
])

// ── Text extraction ────────────────────────────────────────────────
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase()

  if (ext === '.pdf') {
    // DOMMatrix/ImageData/Path2D are polyfilled at module load (above) —
    // pdf-parse can now run its normal text extraction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = await import('pdf-parse') as any
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return (result?.text as string) ?? ''
  }

  if (OFFICE_EXTS.has(ext)) {
    const ast = await parseOffice(buffer)
    return ast.toText() ?? ''
  }

  // CSV, TXT, JSON, Markdown, etc.
  return buffer.toString('utf-8')
}

// ── Paragraph-aware chunking ───────────────────────────────────────
export function chunkText(text: string | null | undefined, maxChars = 1500, overlapChars = 300): string[] {
  if (!text?.trim()) return []
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const paragraphs = normalised.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20)

  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      const sentences = para.match(/[^.!?\n]+[.!?\n]+/g) ?? [para]
      for (const sent of sentences) {
        if (current.length > 0 && (current + ' ' + sent).length > maxChars) {
          chunks.push(current.trim())
          current = current.slice(-overlapChars) + ' ' + sent
        } else {
          current += (current ? ' ' : '') + sent
        }
      }
    } else if (current.length > 0 && (current + '\n\n' + para).length > maxChars) {
      chunks.push(current.trim())
      const lastPara = current.split('\n\n').pop() ?? ''
      current = lastPara + '\n\n' + para
    } else {
      current += (current ? '\n\n' : '') + para
    }
  }
  if (current.trim().length > 50) chunks.push(current.trim())
  return chunks.filter(c => c.trim().length > 50)
}

// ── Batch embedding ────────────────────────────────────────────────
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  })
  const data = await res.json()
  return (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}
