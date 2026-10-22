/**
 * Shared document processing utilities used by both the upload route
 * and the admin training/re-training route.
 */

import path from 'path'
import { claudeComplete, isNetworkError, withRetry } from './claude'

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

// Handled by officeparser's flat text extraction. Everything that has a
// better reader is routed before this set is consulted — see
// extractStructuredText.
const OFFICE_EXTS = new Set([
  '.pptx', '.odt', '.odp', '.rtf',
])

// Spreadsheets go through SheetJS rather than officeparser, which flattens
// a workbook into one text blob. Measured on a 25MB UN demographic
// workbook: officeparser produced 39.4 million characters, most of it empty
// cell padding, and 44,000 chunks with no sheet, no row structure and no
// locator of any kind. SheetJS reads the same file as 44,930 real rows
// across three named sheets, which chunk as tables under the sheet's name.
const SPREADSHEET_EXTS = new Set(['.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv'])

// Legacy binary Word. officeparser rejects the whole CFB container family
// outright ("Create a ticket in Issues on github to add support for cfb
// files"), so a .doc upload — accepted by the allowed-extension list —
// extracted nothing and failed. Confirmed against a legacy test document:
// 0 characters before, 594 after.
const LEGACY_WORD_EXTS = new Set(['.doc'])

// How much of a spreadsheet goes into one table chunk, and how many header
// rows are repeated at the top of each. Without the repeat, every chunk
// after the first is a block of bare values whose columns are unlabelled,
// which no amount of retrieval can recover.
const SPREADSHEET_CHUNK_CHARS = 1400

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
    //
    // getTable() with no `partial` filter processes every page in one call
    // and throws as a single unit — confirmed live on a real 95-page,
    // table/image-dense brochure: one page's geometry crashed
    // pdf-parse's internal Table.getRow(), and the try/catch below (as it
    // used to be, wrapping only the bulk call) silently discarded EVERY
    // page's tables, not just the bad one — losing the document's entire
    // pricing table in the process even though 94 other pages parsed fine.
    // Keep the fast bulk call as the common path, but on failure retry
    // page-by-page (getTable() accepts `partial: [pageNum]`) so one bad
    // page's crash only costs that page's tables, not the whole document's.
    const tablesByPage = new Map<number, string[][][]>()
    try {
      const tableResult = await parser.getTable()
      for (const p of (tableResult?.pages as { num: number; tables: string[][][] }[] | undefined) ?? []) {
        if (p.tables?.length) tablesByPage.set(p.num, p.tables)
      }
    } catch (e) {
      console.error(`[extract] ${filename}: getTable() failed for the whole document, retrying per-page so one bad page doesn't drop every table:`, e)
      for (const p of pages) {
        try {
          const single = await parser.getTable({ partial: [p.num] })
          const pageResult = (single?.pages as { num: number; tables: string[][][] }[] | undefined)?.[0]
          if (pageResult?.tables?.length) tablesByPage.set(p.num, pageResult.tables)
        } catch (pageErr) {
          console.error(`[extract] ${filename}: getTable() also failed on page ${p.num}, skipping this page's tables:`, pageErr)
        }
      }
    }

    if (pages.length > 0) {
      return pages.map(p => ({ page_number: p.num, text: p.text ?? '', tables: tablesByPage.get(p.num) ?? [] }))
    }
    return [{ page_number: null, text: (result?.text as string) ?? '', tables: [] }]
  }

  if (SPREADSHEET_EXTS.has(ext)) return extractSpreadsheet(buffer, filename)

  if (ext === '.docx') return await extractDocx(buffer, filename)

  if (LEGACY_WORD_EXTS.has(ext)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WordExtractor = require('word-extractor')
    const doc = await new WordExtractor().extract(buffer)
    const parts = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
      .map(t => (t ?? '').trim()).filter(Boolean)
    return [{ page_number: null, text: parts.join('\n\n') }]
  }

  if (OFFICE_EXTS.has(ext)) {
    const ast = await parseOffice(buffer)
    return [{ page_number: null, text: ast.toText() ?? '' }]
  }

  // CSV, TXT, JSON, Markdown, etc. — Excel-exported CSVs in particular are
  // very often Windows-1252/Latin-1, not UTF-8. Decoding those as UTF-8
  // doesn't throw — it silently produces mojibake (a run of U+FFFD
  // replacement characters, or garbled accented text) with no error
  // anywhere in the pipeline, corrupting the very numbers/names a fact
  // extractor most needs to read correctly. A high density of U+FFFD (the
  // standard "invalid UTF-8 byte sequence" marker) is a cheap, reliable
  // signal that the wrong encoding was used — re-decode as latin1, which
  // covers the common real-world culprit (any non-UTF-8 single-byte
  // encoding round-trips through latin1 without loss, even if it isn't
  // literally Windows-1252/ISO-8859-1).
  const utf8Text = buffer.toString('utf-8')
  const replacementCount = (utf8Text.match(/�/g) ?? []).length
  if (replacementCount > 3 && replacementCount > utf8Text.length * 0.01) {
    return [{ page_number: null, text: buffer.toString('latin1') }]
  }
  return [{ page_number: null, text: utf8Text }]
}


// ── Spreadsheets ───────────────────────────────────────────────────
//
// One ExtractedPage per sheet, numbered so a citation can name the sheet it
// came from, with the sheet's rows carried as tables so chunkPages keeps
// their row and column structure verbatim instead of reflowing them as
// prose. The sheet name is emitted as a heading line, which makes it the
// section title of every chunk from that sheet.
function extractSpreadsheet(buffer: Buffer, filename: string): ExtractedPage[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false })
  const pages: ExtractedPage[] = []

  wb.SheetNames.forEach((name: string, index: number) => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1, blankrows: false, defval: '',
    }) as unknown[][]

    const rows = aoa
      .map(r => r.map(c => String(c ?? '').trim()))
      // Trailing empty cells are padding from the sheet's used range, not data.
      .map(r => { while (r.length && r[r.length - 1] === '') r.pop(); return r })
      .filter(r => r.some(c => c !== ''))
    if (!rows.length) return

    // The first non-empty row is treated as the header and repeated at the
    // top of every chunk, so no chunk is a block of unlabelled values.
    const header = rows[0]
    const body = rows.slice(1)
    const tables: string[][][] = []
    let batch: string[][] = []
    let chars = 0
    const flushBatch = () => {
      if (!batch.length) return
      tables.push(body.length ? [header, ...batch] : batch)
      batch = []
      chars = 0
    }
    for (const row of body) {
      const rowChars = row.join(' | ').length + 1
      if (batch.length && chars + rowChars > SPREADSHEET_CHUNK_CHARS) flushBatch()
      batch.push(row)
      chars += rowChars
    }
    flushBatch()
    if (!tables.length) tables.push([header])

    pages.push({
      page_number: index + 1,
      // Deliberately a heading line and nothing else: the rows themselves
      // travel as tables, and anything added here would be prose glued to a
      // table in the same chunk.
      text: sheetHeadingLine(name, filename, index, wb.SheetNames.length),
      tables,
    })
  })

  if (!pages.length) return [{ page_number: null, text: '', tables: [] }]
  return pages
}

function sheetHeadingLine(name: string, filename: string, index: number, total: number): string {
  // A single-sheet CSV has no meaningful sheet name of its own (SheetJS
  // calls it "Sheet1"), so naming it would invent a section that does not
  // exist in the source.
  const generic = /^sheet\d*$/i.test(name.trim())
  if (total === 1 && generic) return ''
  return `## ${generic ? `Sheet ${index + 1}` : name}`
}

// ── Word (.docx) ───────────────────────────────────────────────────
//
// Converted through mammoth rather than officeparser, which returns one
// flat string. A Word file has no page numbers at all, so its headings are
// the only thing a citation into it can point at — and before this every
// .docx chunk carried neither a page nor a section, leaving a citation with
// nowhere to send the reader. mammoth reports real heading levels and table
// structure, which become markdown headings and pipe-joined rows here.
async function extractDocx(buffer: Buffer, filename: string): Promise<ExtractedPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth')
  try {
    const { value: html } = await mammoth.convertToHtml({ buffer })
    const text = htmlToBlocks(html)
    if (text.trim()) return [{ page_number: null, text, tables: [] }]
    console.error(`[extract] ${filename}: mammoth produced no text, falling back to officeparser`)
  } catch (e) {
    console.error(`[extract] ${filename}: mammoth failed, falling back to officeparser:`, (e as Error).message)
  }
  const ast = await parseOffice(buffer)
  return [{ page_number: null, text: ast.toText() ?? '' }]
}

// Turns mammoth's HTML into the blank-line-separated blocks chunkPages
// expects, keeping headings (as markdown, which the heading detector
// already recognises) and table rows (pipe-joined, which the table
// detector already recognises).
function htmlToBlocks(html: string): string {
  const blocks: string[] = []
  // Tables first, so their rows are not flattened by the generic pass.
  const parts = html.split(/(<table[\s\S]*?<\/table>)/i)
  for (const part of parts) {
    if (/^<table/i.test(part)) {
      const rows: string[] = []
      for (const row of part.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
        const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [])
          .map(c => decodeEntities(c.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
        while (cells.length && cells[cells.length - 1] === '') cells.pop()
        if (cells.some(c => c !== '')) rows.push(cells.join(' | '))
      }
      if (rows.length) blocks.push(rows.join('\n'))
      continue
    }
    for (const m of part.matchAll(/<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const tag = m[1].toLowerCase()
      const inner = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
      if (!inner) continue
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(3, Number(tag[1]))
        blocks.push('#'.repeat(level) + ' ' + inner)
      } else {
        blocks.push(inner)
      }
    }
  }
  return blocks.join('\n\n')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
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

// Whether a SINGLE LINE reads as a heading.
//
// isHeading above only ever sees a whole block, and a PDF rarely puts a
// blank line between a heading and the paragraph under it — so the heading
// arrived glued to its first paragraph, was rejected for containing a
// newline, and no document ever got a section title. Measured across a
// 16-document corpus: every PDF and Office file produced zero section
// titles, which is also why a citation into a Word file (which has no page
// numbers either) had nothing at all to point at.
function looksLikeHeadingLine(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 100) return false
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false

  // A heading does not end a sentence. A trailing colon is fine.
  if (/[.,;!?]$/.test(t)) return false

  // A table-of-contents entry is a pointer to a heading, not one: its dot
  // leaders and trailing page number would become the section label for
  // every chunk that followed it.
  if (/\.{4,}/.test(t)) return false
  // A bullet is a list item even when it is capitalised throughout.
  if (/^[\u2022\u00b7\u25aa\u25e6\u2023*\-\u2013\u2014]\s/.test(t)) return false

  // Tabular data is not a heading, however capitalised. A register's rows
  // ("1 ASHANTI 117 2 1 27 5 82 95 22") are entirely upper case, and
  // treating them as headings would shred the table into fragments.
  const digits = (t.match(/\d/g) ?? []).length
  if (digits > t.length * 0.25) return false
  if ((t.match(/\s+\d/g) ?? []).length >= 3) return false
  if (t.includes('|') || /\s{3,}\s*\S/.test(t)) return false

  const words = t.split(/\s+/)
  if (words.length > 14) return false

  // "5.1.1.2 Memorized Secret Verifiers"
  if (/^\d+(\.\d+)*\.?\s+\S/.test(t)) return true
  // "Appendix A — Strength of Memorized Secrets", "Table 4", "Annex II"
  if (/^(appendix|chapter|section|part|annex|schedule|exhibit|table|figure)\s+[\divxlcIVXLC]/i.test(t)) return true
  // A wrapped table cell is not a heading, however it is capitalised.
  if (/^[(\[]/.test(t)) return false

  const substantial = words.filter(w => /[A-Za-z]{4,}/.test(w))
  if (substantial.length < 2) return false

  // Shouted headings. No digits at all: a row of a register is upper case
  // too, and the only thing separating the two reliably is that a heading
  // does not carry data.
  if (letters === letters.toUpperCase() && t.length <= 80 && digits === 0) return true
  // Title Case — every word long enough to carry meaning is capitalised.
  if (substantial.every(w => /^[^A-Za-z]*[A-Z]/.test(w)) && t.length <= 70) return true

  return false
}

// Splits a block wherever a heading line appears inside it, so the heading
// becomes the section label for what follows instead of being swallowed
// into the first paragraph's text.
function splitAtHeadings(
  block: string,
  isHeadingLine: (line: string) => boolean,
): { text: string; heading: boolean }[] {
  const out: { text: string; heading: boolean }[] = []
  let buffer: string[] = []
  const flushBuffer = () => {
    if (buffer.length) {
      const text = buffer.join('\n')
      if (text.trim()) out.push({ text, heading: false })
      buffer = []
    }
  }
  for (const line of block.split('\n')) {
    if (looksLikeHeadingLine(line)) {
      flushBuffer()
      out.push({ text: line.trim(), heading: true })
    } else {
      buffer.push(line)
    }
  }
  flushBuffer()
  return out
}

// Removes the running header and footer a paginated document repeats on
// every page.
//
// A 78-page specification printed its title, its publication DOI (wrapped
// over four lines) and its page number at the top of every page, so that
// boilerplate was embedded into every chunk of the document and extracted
// as a fact over and over — the generic extractor already carries a dedupe
// step specifically to cope with it. Removing it at source makes every
// chunk's embedding about the page's actual content.
//
// Only the top and bottom few lines of each page are eligible, so a
// sentence that legitimately recurs in the body is never dropped, and only
// lines that recur across most pages qualify. Digits are normalised before
// comparison so "15" and "16" of a page number count as the same line.
function stripRunningHeaders(pages: ExtractedPage[]): ExtractedPage[] {
  const MIN_PAGES = 4
  const ZONE = 5
  const SHARE = 0.6
  if (pages.length < MIN_PAGES) return pages

  const key = (line: string) => line.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#')
  const seen = new Map<string, number>()
  const pageLines = pages.map(p => p.text.split(/\r?\n/))

  for (const lines of pageLines) {
    const zone = new Set<string>()
    for (const line of [...lines.slice(0, ZONE), ...lines.slice(-ZONE)]) {
      const k = key(line)
      if (k.replace(/[^a-z#]/g, '').length >= 2) zone.add(k)
    }
    for (const k of zone) seen.set(k, (seen.get(k) ?? 0) + 1)
  }

  const boilerplate = new Set(
    [...seen.entries()].filter(([, n]) => n >= pages.length * SHARE).map(([k]) => k),
  )
  if (!boilerplate.size) return pages

  return pages.map((page, i) => {
    const lines = pageLines[i]
    const keep = lines.map((line, j) => {
      const inZone = j < ZONE || j >= lines.length - ZONE
      return inZone && boilerplate.has(key(line)) ? null : line
    }).filter((l): l is string => l !== null)
    return { ...page, text: keep.join('\n') }
  })
}

function cleanHeading(block: string): string {
  return block.trim()
    .replace(/^#{1,3}\s+/, '')
    // Dot leaders and a trailing page number, where one slipped through.
    .replace(/\s*\.{3,}\s*\d*$/, '')
    .replace(/\s+/g, ' ')
}

// ── Structure-aware chunking ────────────────────────────────────────
// Splits page text into paragraphs/tables/headings, never splitting a
// table block, and tags each chunk with page number + current section.
export interface ChunkingHints {
  /**
   * A heading test derived from this document's own headings
   * (documentProfile.ts), used in place of the built-in shapes. The
   * built-in rules are a list of layouts we have seen; a document laid out
   * differently got no sections at all until the list was widened, and
   * widening a list of assumptions is not the same as not assuming.
   */
  isHeadingLine?: ((line: string) => boolean) | null
  /**
   * The column headings of a document made of repeating records. Prefixed
   * to each tabular chunk so a block of rows is readable on its own: a
   * chunk of a register is otherwise bare values whose columns are named
   * only on some earlier page, which no amount of retrieval recovers.
   */
  recordColumns?: string[]
}

export function chunkPages(
  pages: ExtractedPage[],
  docTitle: string,
  maxChars = 1500,
  overlapChars = 300,
  hints: ChunkingHints = {},
): ProcessedChunk[] {
  const docFiscalYear = extractFiscalYear(docTitle)
  const chunks: ProcessedChunk[] = []
  pages = stripRunningHeaders(pages)

  const isHeadingLine = hints.isHeadingLine ?? looksLikeHeadingLine
  // One line, not a table row, so it travels with the rows it describes
  // without being mistaken for data.
  const columnLegend = hints.recordColumns?.length
    ? `[Columns: ${hints.recordColumns.join(' | ')}]`
    : null

  let currentSection: string | null = null
  let current = ''
  let currentPage: number | null = null

  // Set while walking a page whose rows need their column names. Applied
  // in flush() rather than when a chunk starts, because a page of a
  // register exceeds maxChars and goes down the sentence-splitting path,
  // which reassigns `current` and discarded a legend added up front — 0 of
  // 56 chunks carried it on the first attempt.
  let legendThisPage = false

  const flush = () => {
    const body = current.trim()
    const text = legendThisPage && body && !body.startsWith('[Columns:')
      ? `${columnLegend}\n${body}`
      : body
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

    // A data-dense page is a table whatever its line breaks say, so its
    // lines are not searched for headings. Measured on a 40-page station
    // register: its rows and wrapped cells ("KUMASI COMMERCIAL") read as
    // shouted headings, which split 58 whole-table chunks into 90 partial
    // ones — and on a document costing 46 seconds an excerpt to extract
    // facts from, that is a 55% increase in the work for a worse result.
    // The same digit-share signal decides batch sizing in
    // genericFactExtraction; prose and brochures here run 0.7-4.4%, tables
    // 15-19%.
    const pageDigits = (normalised.match(/\d/g) ?? []).length
    const dataDense = normalised.length > 200 && pageDigits > normalised.length * 0.08
    // A register's pages are data-dense but are not detected as table
    // blocks by the whitespace heuristic, so their rows arrive as ordinary
    // text and would otherwise be stored as bare values whose columns are
    // named only on some earlier page.
    legendThisPage = columnLegend != null && dataDense
    const blocks = normalised ? normalised.split(/\n\n+/).map(b => b.trim()).filter(b => b.length > 0) : []

    for (const rawBlock of blocks) {
      // Tabular blocks are never searched for headings. A register's rows
      // are upper case throughout ("72 JOYKEN PLATINUM COMPANY LIMITED
      // 19-08-20 95.5MHz ON AIR JUASO COMMERCIAL"), and treating them as
      // headings shredded a 40-page table into 93 fragments labelled with
      // pieces of its own rows, where whole-table chunks had been 58.
      const parts = dataDense || isTableBlock(rawBlock)
        ? [{ text: rawBlock, heading: false }]
        : splitAtHeadings(rawBlock, isHeadingLine)

      for (const part of parts) {
      const block = part.text
      if (part.heading || isHeading(block)) {
        // A heading starts a new chunk only once the current one is worth
        // keeping. Flushing on every heading halved the average chunk —
        // 1,400 characters down to 490 on a 229-page gazette, doubling the
        // chunk count and the embedding cost while giving each chunk less
        // context to be retrieved on. The heading's own text stays in the
        // chunk either way: it is usually the most descriptive line on the
        // page, and dropping it was losing that from the embedding.
        if (current.length >= maxChars * 0.7) flush()
        currentSection = cleanHeading(block)
        if (current.length === 0) currentPage = page.page_number
        current += (current ? '\n\n' : '') + block.trim()
        continue
      }

      if (isTableBlock(block)) {
        flush()
        chunks.push({
          text: columnLegend ? `${columnLegend}\n${block}` : block,
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
        text: columnLegend ? `${columnLegend}\n${tableText}` : tableText,
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

// ── Resilient chunk insert ──────────────────────────────────────────
// Both finalize/route.ts and train/route.ts inserted each embedded batch
// with `const { data } = await ...insert(...)` — discarding `error`
// entirely. Confirmed as a real, silent data-loss path: a failed batch
// insert (a transient DB error, a constraint violation, a momentary
// connection drop) left `data` null/empty and nothing ever threw, logged,
// or warned — the loop just moved on to the next batch as if that one had
// succeeded, and the document was later marked "ready" with however many
// chunks DID make it in, no different from a document that genuinely only
// had that many.
//
// Reuses the existing withRetry (claude.ts) — the same network-aware retry
// primitive reExtract.ts already relies on — rather than inventing a second,
// differently-behaved retry helper: it only retries genuinely transient
// network errors with backoff and returns non-network errors (a constraint
// violation, bad data) immediately rather than retrying something retrying
// can't fix. insertChunkBatch always throws on a final error so the
// caller's existing top-level catch marks the document "failed" with a real
// reason instead of quietly shipping a partial document as complete.
export async function insertChunkBatch<T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
  label: string,
): Promise<T> {
  const { data, error } = await withRetry(fn, label)
  if (error) throw new Error(`${label} failed: ${(error as Error).message ?? String(error)}`)
  return data as T
}

// ── Resilient fact-store inserts (financial_facts / document_facts) ────
// The same blind `await X.insert(Y)` pattern (not even destructured, let
// alone checked) existed for all six financial_facts/document_facts insert
// calls across finalize/route.ts and train/route.ts — a failed insert here
// silently dropped an entire batch of extracted facts with no retry, log, or
// warning. Unlike chunk inserts, these all happen inside the best-effort
// enrichment phase (see finalize/route.ts's fast-path/background split) —
// losing facts degrades analytics quality but never makes a document
// unusable for chat, so this warns (via the caller's existing `warn()`
// closure, surfaced in processing_warnings/status_detail) rather than
// throwing and failing the whole document over an enrichment-only hiccup.
export async function insertFactsResilient(
  fn: () => PromiseLike<{ data: unknown; error: unknown }>,
  step: string,
  warn: (step: string, message: string, network?: boolean) => void,
): Promise<void> {
  const { error } = await withRetry(fn, step)
  if (error) {
    const message = (error as Error).message ?? String(error)
    console.error(`[${step}] insert failed:`, message)
    warn(step, message, isNetworkError(error))
  }
}
