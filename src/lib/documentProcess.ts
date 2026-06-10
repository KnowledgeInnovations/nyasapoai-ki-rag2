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

export interface ExtractedPage {
  page_number: number | null  // null when the source format has no page concept
  text: string
}

export interface ProcessedChunk {
  text: string
  page_number: number | null
  section_title: string | null
  fiscal_year: string | null
  ministry: string | null
  sector: string | null
  is_table: boolean
}

// ── Text extraction (page-aware where possible) ────────────────────
export async function extractStructuredText(buffer: Buffer, filename: string): Promise<ExtractedPage[]> {
  const ext = path.extname(filename).toLowerCase()

  if (ext === '.pdf') {
    // DOMMatrix/ImageData/Path2D are polyfilled at module load (above) —
    // pdf-parse can now run its normal text extraction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = await import('pdf-parse') as any
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    const pages = (result?.pages as { num: number; text: string }[] | undefined) ?? []
    if (pages.length > 0) {
      return pages.map(p => ({ page_number: p.num, text: p.text ?? '' }))
    }
    return [{ page_number: null, text: (result?.text as string) ?? '' }]
  }

  if (OFFICE_EXTS.has(ext)) {
    const ast = await parseOffice(buffer)
    return [{ page_number: null, text: ast.toText() ?? '' }]
  }

  // CSV, TXT, JSON, Markdown, etc.
  return [{ page_number: null, text: buffer.toString('utf-8') }]
}

// Backwards-compatible plain-text extraction (used where structure isn't needed)
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const pages = await extractStructuredText(buffer, filename)
  return pages.map(p => p.text).join('\n\n')
}

// ── Metadata extraction helpers ─────────────────────────────────────

// "2026 Budget Statement", "Budget 2024/2025" → "2026" / "2024/2025"
export function extractFiscalYear(title: string): string | null {
  const m = title.match(/(19|20)\d{2}(?:\s*[/-]\s*(19|20)?\d{2})?/)
  return m ? m[0].replace(/\s+/g, '') : null
}

// "...allocations to the Ministry of Health for..." → "Ministry of Health"
export function extractMinistry(text: string): string | null {
  const m = text.match(/Minist(?:ry|ries)\s+of\s+[A-Z][A-Za-z,&'\-\s]{2,60}?(?=[.\n,;:]|\s{2,}|$)/)
  return m ? m[0].trim().replace(/\s+/g, ' ') : null
}

const SECTOR_KEYWORDS = [
  'Education', 'Health', 'Agriculture', 'Infrastructure', 'Energy', 'Water',
  'Social Protection', 'Security', 'Defence', 'Justice', 'Trade', 'Industry',
  'Tourism', 'Environment', 'Local Government', 'Finance', 'Communications',
  'ICT', 'Transport', 'Housing', 'Youth', 'Sports', 'Roads', 'Sanitation',
]

export function extractSector(text: string): string | null {
  for (const s of SECTOR_KEYWORDS) {
    if (new RegExp(`\\b${s}\\b`, 'i').test(text)) return s
  }
  return null
}

// A block is a "table" if most of its non-empty lines look like
// whitespace/tab/pipe-delimited columns — these are kept as a single
// chunk regardless of size so row/column relationships survive.
function isTableBlock(block: string): boolean {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return false
  const tableLines = lines.filter(l =>
    /(\t|\s{2,}).*(\t|\s{2,})/.test(l) || (l.match(/\|/g)?.length ?? 0) >= 2
  )
  return tableLines.length / lines.length >= 0.6
}

// A block is a "heading" if it's a single short line that reads like a
// section/appendix title — used to track `section_title` for chunks.
function isHeading(block: string): boolean {
  if (block.includes('\n')) return false
  const t = block.trim()
  if (!t || t.length > 100) return false
  if (/^#{1,3}\s+\S/.test(t)) return true
  if (/^(appendix|chapter|section|part)\s+[\divxlc]+/i.test(t)) return true
  const letters = t.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 3 && letters === letters.toUpperCase() && t.length <= 80) return true
  return false
}

function cleanHeading(block: string): string {
  return block.trim().replace(/^#{1,3}\s+/, '')
}

// ── Structure-aware chunking ────────────────────────────────────────
// Splits page text into paragraphs/tables/headings, never splitting a
// table block, and tags each chunk with page number + current section.
export function chunkPages(
  pages: ExtractedPage[],
  docTitle: string,
  maxChars = 1500,
  overlapChars = 300,
): ProcessedChunk[] {
  const docFiscalYear = extractFiscalYear(docTitle)
  const chunks: ProcessedChunk[] = []

  let currentSection: string | null = null
  let current = ''
  let currentPage: number | null = null

  const flush = () => {
    const text = current.trim()
    if (text.length > 50) {
      chunks.push({
        text,
        page_number: currentPage,
        section_title: currentSection,
        fiscal_year: docFiscalYear,
        ministry: extractMinistry(text),
        sector: extractSector(text),
        is_table: false,
      })
    }
    current = ''
  }

  for (const page of pages) {
    const normalised = page.text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!normalised) continue
    const blocks = normalised.split(/\n\n+/).map(b => b.trim()).filter(b => b.length > 0)

    for (const block of blocks) {
      if (isHeading(block)) {
        flush()
        currentSection = cleanHeading(block)
        continue
      }

      if (isTableBlock(block)) {
        flush()
        chunks.push({
          text: block,
          page_number: page.page_number,
          section_title: currentSection,
          fiscal_year: docFiscalYear,
          ministry: extractMinistry(block),
          sector: extractSector(block),
          is_table: true,
        })
        continue
      }

      if (block.length < 20) continue

      if (current.length === 0) currentPage = page.page_number

      if (block.length > maxChars) {
        const sentences = block.match(/[^.!?\n]+[.!?\n]+/g) ?? [block]
        for (const sent of sentences) {
          if (current.length > 0 && (current + ' ' + sent).length > maxChars) {
            flush()
            current = sent
            currentPage = page.page_number
          } else {
            current += (current ? ' ' : '') + sent
          }
        }
      } else if (current.length > 0 && (current + '\n\n' + block).length > maxChars) {
        const overlap = current.slice(-overlapChars)
        flush()
        current = overlap + '\n\n' + block
        currentPage = page.page_number
      } else {
        current += (current ? '\n\n' : '') + block
      }
    }
  }
  flush()

  return chunks
}

// ── Legacy plain-text chunking (kept for any callers that just need text) ──
export function chunkText(text: string | null | undefined, maxChars = 1500, overlapChars = 300): string[] {
  if (!text?.trim()) return []
  return chunkPages([{ page_number: null, text }], '', maxChars, overlapChars).map(c => c.text)
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
