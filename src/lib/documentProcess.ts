/**
 * Shared document processing utilities used by both the upload route
 * and the admin training/re-training route.
 */

import path from 'path'
import { claudeComplete, isNetworkError } from './claude'

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
  // Structured tables detected on this page via grid geometry (PDF only) —
  // each table is an array of rows, each row an array of cell strings.
  // Far more reliable for multi-column numeric tables than the whitespace
  // heuristic in chunkPages, which can misalign or merge adjacent columns.
  tables?: string[][][]
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

    // Loud, non-fatal check that every page made it through — a silent
    // drop here (e.g. an unparseable page) would otherwise show up only as
    // "missing" figures much later, in answers that look confidently wrong.
    if (result?.total && pages.length !== result.total) {
      console.error(`[extract] ${filename}: getText() returned ${pages.length} of ${result.total} pages`)
    }

    // Structured tables (detected from vector grid geometry) — see the
    // `tables` field comment on ExtractedPage. getTable() does a heavier
    // geometric analysis that can fail on some PDFs; a failure here must
    // not block extraction of the page's regular text.
    const tablesByPage = new Map<number, string[][][]>()
    try {
      const tableResult = await parser.getTable()
      for (const p of (tableResult?.pages as { num: number; tables: string[][][] }[] | undefined) ?? []) {
        if (p.tables?.length) tablesByPage.set(p.num, p.tables)
      }
    } catch (e) {
      console.error(`[extract] ${filename}: getTable() failed:`, e)
    }

    if (pages.length > 0) {
      return pages.map(p => ({ page_number: p.num, text: p.text ?? '', tables: tablesByPage.get(p.num) ?? [] }))
    }
    return [{ page_number: null, text: (result?.text as string) ?? '', tables: [] }]
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
    // "Social Security" (a routine line item under Compensation of Employees
    // in every budget's macro/national section) must not trigger the
    // "Security" sector keyword — it's an unrelated fiscal term, not the
    // Security sector (Defence/Police/etc).
    const rx = s === 'Security'
      ? new RegExp(`(?<!social\\s)\\b${s}\\b`, 'i')
      : new RegExp(`\\b${s}\\b`, 'i')
    if (rx.test(text)) return s
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
    // Low floor — high enough to skip stray page-number/whitespace
    // artifacts, low enough not to drop a short but meaningful trailing
    // line (e.g. an isolated total-figure sentence).
    if (text.length > 10) {
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
    const blocks = normalised ? normalised.split(/\n\n+/).map(b => b.trim()).filter(b => b.length > 0) : []

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

      if (block.length < 8) continue

      if (current.length === 0) currentPage = page.page_number

      if (block.length > maxChars) {
        const sentences = block.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [block]
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

    // Structured tables for this page (see ExtractedPage.tables) — appended
    // after the page's text blocks, each as its own is_table chunk so the
    // PDF's vector-grid row/column structure survives verbatim, instead of
    // relying on the whitespace-based isTableBlock heuristic above (which
    // can misalign or merge adjacent numeric columns).
    for (const table of page.tables ?? []) {
      if (table.length < 2) continue
      const tableText = table.map(row => row.map(c => c.trim()).join(' | ')).join('\n')
      if (tableText.trim().length < 10) continue
      flush()
      chunks.push({
        text: tableText,
        page_number: page.page_number,
        section_title: currentSection,
        fiscal_year: docFiscalYear,
        ministry: extractMinistry(tableText),
        sector: extractSector(tableText),
        is_table: true,
      })
    }
  }
  flush()

  return chunks
}

// ── AI-assisted table chunk cleaning ───────────────────────────────────────
// Sends is_table chunks (in batches of 8) to Claude to fix OCR artifacts,
// misaligned columns, broken numbers, and garbled cell values. Non-table
// chunks are returned unchanged. Fails gracefully — on any error the
// original text is kept so training continues.
const TABLE_CLEAN_BATCH = 8

export async function aiCleanTableChunks(
  chunks: ProcessedChunk[],
  // Epoch ms — passed through to claudeComplete so a transient network
  // failure retries with growing backoff for as long as the route's
  // remaining processing budget allows. See claudeComplete's deadline param.
  deadline?: number,
  // Invoked when a batch is dropped after exhausting retries (kept as the
  // original, uncleaned text) — lets the caller surface this in
  // processing_warnings instead of it being silent console.error noise.
  onBatchDropped?: (info: { reason: string; network?: boolean }) => void,
): Promise<ProcessedChunk[]> {
  const tableIndexes = chunks.map((c, i) => c.is_table ? i : -1).filter(i => i >= 0)
  if (!tableIndexes.length) return chunks

  const result = [...chunks]

  // Same reasoning as aiEnhanceTableFacts's outer loop: per-call retries
  // respect `deadline`, but without also checking it here, a document with
  // many table batches just keeps starting new ones under sustained network
  // trouble. Stop and return what's been cleaned so far rather than grinding
  // through every remaining batch's full retry cycle one at a time.
  for (let b = 0; b < tableIndexes.length; b += TABLE_CLEAN_BATCH) {
    if (deadline != null && Date.now() > deadline) break
    const batch = tableIndexes.slice(b, b + TABLE_CLEAN_BATCH)
    const separator = '\n---TABLE_BREAK---\n'
    const combined = batch.map(i => chunks[i].text).join(separator)

    try {
      const cleaned = await claudeComplete({
        maxTokens: 4096,
        deadline,
        messages: [{
          role: 'user',
          content: `You are a PDF table formatter. Fix the formatting of each table block below.

Tasks for each block:
- Fix broken numbers (e.g. "1,23 4.56" → "1,234.56", "1 2,345" → "12,345")
- Fix merged/split cells by restoring column alignment
- Fix OCR errors in entity names and monetary figures
- Remove spurious page-number artifacts or repeated headers
- Preserve ALL numeric values and row labels exactly — never change a figure

Return the fixed blocks separated by exactly the same ---TABLE_BREAK--- delimiter. Same number of blocks.

${combined}`,
        }],
      })

      const parts = cleaned.split('---TABLE_BREAK---')
      if (parts.length === batch.length) {
        batch.forEach((chunkIdx, j) => {
          result[chunkIdx] = { ...result[chunkIdx], text: parts[j].trim() || result[chunkIdx].text }
        })
      }
    } catch (e) {
      console.error('[aiCleanTableChunks] batch failed, keeping original:', e)
      onBatchDropped?.({ reason: (e as Error).message, network: isNetworkError(e) })
    }
  }

  return result
}

// ── Legacy plain-text chunking (kept for any callers that just need text) ──
export function chunkText(text: string | null | undefined, maxChars = 1500, overlapChars = 300): string[] {
  if (!text?.trim()) return []
  return chunkPages([{ page_number: null, text }], '', maxChars, overlapChars).map(c => c.text)
}

// ── Batch embedding ────────────────────────────────────────────────
// A stalled TCP connection (no error, no response — observed repeatedly on
// unstable networks) previously blocked this fetch indefinitely: no timeout
// meant a single hung request could occupy the entire serverless function
// until Vercel's hard maxDuration kill, leaving the document stuck on
// "processing" forever with no error ever raised to catch and record.
// Bounding each attempt and retrying turns that into a fast, recoverable
// failure instead.
const EMBED_TIMEOUT_MS = 25000
const EMBED_MAX_ATTEMPTS = 3
// Unlike fact extraction, a failed embed call is fatal to the whole document
// (chunks can't be stored without their vector) — so this is the highest-
// value place to ride out a network blip rather than fail fast. Same
// growing-backoff idea as claudeComplete's deadline param.
const EMBED_NETWORK_RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000]
const EMBED_DEADLINE_SAFETY_MARGIN_MS = 5000

export async function embedBatch(texts: string[], deadline?: number): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`)
      const data = await res.json()
      if (!Array.isArray(data?.data)) throw new Error('OpenAI embeddings: malformed response')
      return (data.data as { index: number; embedding: number[] }[])
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding)
    } catch (e) {
      if (deadline != null && isNetworkError(e)) {
        const wait = EMBED_NETWORK_RETRY_BACKOFF_MS[Math.min(attempt - 1, EMBED_NETWORK_RETRY_BACKOFF_MS.length - 1)]
        if (Date.now() + wait > deadline - EMBED_DEADLINE_SAFETY_MARGIN_MS) throw e
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (attempt >= EMBED_MAX_ATTEMPTS) throw e
      await new Promise(r => setTimeout(r, attempt * 1000))
    }
  }
}
