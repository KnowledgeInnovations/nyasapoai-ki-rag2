/**
 * Vision-based recovery for content this pipeline otherwise cannot read at
 * all: pages with no embedded text layer (scanned/image content — pdfjs's
 * text extraction gets literally nothing), and pages whose text DID extract
 * but as positionally-scrambled garbage (a multi-column table whose glyph
 * positions don't linearize into a sane reading order — confirmed live on a
 * price list with several side-by-side sub-tables, where unit codes, areas,
 * and prices from DIFFERENT columns interleave in the raw text).
 *
 * Both cases share the same fix: stop trying to reconstruct the page from
 * its (missing or scrambled) text, and show a vision-capable model the
 * actual page IMAGE instead — it reads the visual layout directly, so
 * column/row structure that's ambiguous in linearized text is unambiguous
 * in the rendered page.
 *
 * Two entry points, used at different pipeline stages:
 * - visionTranscribePage(): plain-text transcription, for pages with NO
 *   extracted text at all — feeds into the exact same downstream pipeline
 *   (chunking, embedding, fact extraction) as any normally-extracted page.
 *   Called early (finalize/train routes), before chunking.
 * - visionExtractFactsFromPage(): direct structured fact extraction, for
 *   pages whose chunk WAS processed but produced no usable facts (a table-
 *   flagged chunk that came up empty from the text-based fact extractors).
 *   Called late (the background enrichment phase), after generic fact
 *   extraction has already run and identified the gap.
 *
 * Both are capped by the caller (MAX_VISION_RECOVERY_PAGES-style constants
 * at each call site) — a vision call costs meaningfully more than a text
 * call, so this is deliberately scoped to CONFIRMED gaps, not run
 * speculatively across a whole document.
 */

import path from 'node:path'
import { claudeComplete, extractJSON, isNetworkError } from './claude'
import type { DocumentFact } from './genericFactExtraction'

// Mirrors tableExtraction.ts's STANDARD_FONT_DATA_URL — same reasoning
// (built from process.cwd() so Turbopack's route bundling doesn't rewrite
// it to an internal module id).
const STANDARD_FONT_DATA_URL =
  path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/'

// ~144 DPI equivalent for a standard PDF page — legible for dense table text
// without producing an oversized base64 payload. pdfjs-dist's default page
// size assumption (72 DPI = scale 1) is too low-resolution for small table
// print; Claude's vision input also has a soft "long side downscaled past
// ~1568px" behavior, so pushing scale much higher than this wastes payload
// size without improving what the model actually sees.
const RENDER_SCALE = 2

// How many pages are transcribed at once. A vision call runs 10-25s, so
// sequentially a scanned document reaches about eight pages in a pass
// budget; six at a time reaches most of a normal-length document. Kept
// modest because these calls share one account's rate limit with chat.
const VISION_CONCURRENCY = 6

// Renders a single PDF page (1-indexed, matching ExtractedPage.page_number)
// to PNG bytes. @napi-rs/canvas is already a project dependency (used in
// src/instrumentation.ts to polyfill DOMMatrix/ImageData/Path2D for
// pdf-parse) and is explicitly compatible with pdfjs-dist's canvas
// rendering contract, so no new dependency is needed here.
export async function renderPageToImage(buffer: Buffer, pageNumber: number): Promise<Buffer> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  // @napi-rs/canvas's context type doesn't structurally match pdfjs-dist's
  // own (independently-declared) CanvasRenderingContext2D interface, even
  // though the runtime shapes are compatible enough for rendering to work —
  // a narrowly-scoped cast is the standard way this specific combination is
  // used (this project already polyfills DOMMatrix/ImageData/Path2D from
  // this exact package for pdfjs-dist elsewhere).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport }).promise
  return canvas.toBuffer('image/png')
}

const TRANSCRIBE_PROMPT = `Transcribe every piece of text visible on this page — headings, paragraphs, labels, and especially any tables or price lists.

For a table: do NOT just read left-to-right/top-to-bottom blindly if the layout would scramble which value belongs to which row (e.g. several side-by-side sub-tables, or columns that don't align in a simple grid). Instead output each row as a clean, unambiguous line that explicitly repeats the row's identifying label with every value on that row, e.g. "Unit A601: interior area 42.79 sqm, self-finance price $280,563, mortgage price $290,563, floor 6" — never a raw grid a reader would have to realign themselves.

Preserve exact numbers, codes, and names exactly as shown — do not round, guess, or fill in anything not actually legible. Return plain text only: no commentary, no markdown formatting, no preamble.`

// Stage 1 — plain-text transcription for a page with no extracted text at
// all. Returns null (never throws) on any failure so a caller can treat it
// exactly like "still couldn't recover this page" rather than special-
// casing a vision-specific error.
/**
 * Reads every page that extracted no text, as far as the time allows.
 *
 * A wholly scanned document is not a rare edge case — a register, a signed
 * contract, an older government report are routinely photographs of paper,
 * and a RAG that cannot read them simply cannot answer about them. Pages
 * are transcribed several at a time, because one at a time a 26-page scan
 * needs several minutes of wall clock and a single pass budget would reach
 * about eight pages.
 *
 * Pages are mutated in place, so everything downstream — chunking,
 * embedding, fact extraction — treats a transcribed page exactly like a
 * normally-extracted one. Whatever the budget did not reach is reported,
 * not hidden: those pages contribute nothing until the document is trained
 * again, and the caller surfaces that.
 */
export async function recoverEmptyPagesWithVision(
  buffer: Buffer,
  pages: { page_number: number | null; text: string }[],
  deadline: number,
  maxPages: number,
  // Where transcriptions are kept between runs. Without it the same first
  // pages are re-read on every attempt and a long scan never finishes.
  store?: PageTextStore,
  // Set when the file IS an image rather than a PDF of pages: there is
  // nothing to render, so the bytes go to the model as they are.
  asImage?: { mediaType: VisionImageType },
): Promise<{ recovered: number; attempted: number; remaining: number; reused: number }> {
  let reused = 0
  if (store) {
    const cached = await store.load()
    for (const page of pages) {
      if (page.text.trim() || page.page_number == null) continue
      const text = cached.get(page.page_number)
      if (text) { page.text = text; reused++ }
    }
  }

  const empty = pages
    .filter(p => !p.text.trim())
    .map(p => p.page_number)
    .filter((n): n is number => n != null)
  if (!empty.length) return { recovered: 0, attempted: 0, remaining: 0, reused }

  const queue = empty.slice(0, maxPages)
  let cursor = 0
  let recovered = 0
  let attempted = 0

  await Promise.all(
    Array.from({ length: Math.min(VISION_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        // Checked before taking a page, so a transcription is never started
        // on an allowance that has already collapsed.
        if (Date.now() > deadline) return
        const index = cursor++
        if (index >= queue.length) return
        const pageNumber = queue[index]
        attempted++
        const text = asImage
          ? await visionTranscribeImage(buffer, asImage.mediaType, deadline)
          : await visionTranscribePage(buffer, pageNumber, deadline)
        if (text) {
          const page = pages.find(p => p.page_number === pageNumber)
          if (page) { page.text = text; recovered++ }
          // Saved as each page finishes, not in one batch at the end: a
          // pass that runs out of time mid-document must still keep what
          // it read, or the next attempt repeats it.
          await store?.save(pageNumber, text)
        }
      }
    }),
  )

  const stillEmpty = pages.filter(p => !p.text.trim()).length
  return { recovered, attempted, remaining: stillEmpty, reused }
}

export interface PageTextStore {
  load(): Promise<Map<number, string>>
  save(pageNumber: number, text: string): Promise<void>
}

/**
 * The store backed by document_page_text (migration 038). Tolerates the
 * table not existing yet: a database without the migration loses the
 * caching, not the extraction.
 */
export function pageTextStore(
  service: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  documentId: string,
): PageTextStore {
  return {
    async load() {
      const map = new Map<number, string>()
      const { data, error } = await service
        .from('document_page_text')
        .select('page_number, text')
        .eq('document_id', documentId)
      if (error) {
        console.error('[visionExtraction] could not read stored page text:', error.message)
        return map
      }
      for (const row of (data ?? []) as { page_number: number; text: string }[]) {
        if (row.text?.trim()) map.set(row.page_number, row.text)
      }
      return map
    },
    async save(pageNumber, text) {
      const { error } = await service
        .from('document_page_text')
        .upsert({ document_id: documentId, page_number: pageNumber, text, method: 'vision' },
          { onConflict: 'document_id,page_number' })
      if (error) console.error(`[visionExtraction] could not store page ${pageNumber}:`, error.message)
    },
  }
}

/**
 * Transcribes an image that IS the document — a photograph or screenshot
 * of paper, uploaded as it was taken.
 *
 * Separate from the page path only in that there is nothing to render: the
 * bytes are already an image. The media type comes from the leading bytes
 * rather than the filename, because the extension lies — a file uploaded
 * as image.png was a WebP, and a mislabelled media type is rejected by the
 * model outright.
 */
export type VisionImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export async function visionTranscribeImage(
  buffer: Buffer,
  mediaType: VisionImageType,
  deadline?: number,
): Promise<string | null> {
  try {
    const raw = await claudeComplete({
      maxTokens: 4096,
      deadline,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE_PROMPT },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
        ],
      }],
    })
    const text = raw.trim()
    return text || null
  } catch (e) {
    console.error('[visionExtraction] transcribe failed for an uploaded image:', e)
    return null
  }
}

export async function visionTranscribePage(buffer: Buffer, pageNumber: number, deadline?: number): Promise<string | null> {
  try {
    const imageBuffer = await renderPageToImage(buffer, pageNumber)
    const raw = await claudeComplete({
      maxTokens: 4096,
      deadline,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE_PROMPT },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBuffer.toString('base64') } },
        ],
      }],
    })
    const text = raw.trim()
    return text || null
  } catch (e) {
    console.error(`[visionExtraction] transcribe failed for page ${pageNumber}:`, e)
    return null
  }
}

const VISION_FACTS_PROMPT = `This page's extracted text came out unreadable (likely a complex multi-column table, or a scanned/graphic-heavy layout) — you are seeing the page image directly instead. Extract clearly-stated factual data points: dates, amounts, names, statuses, deadlines, quantities, specifications — especially any table or price-list rows, resolving each row's columns correctly (never mix a value from one row/column with another).

Return a JSON array (empty array if nothing found):
[
  {
    "category": "broad bucket, e.g. financial|legal|hr|operational|compliance|other",
    "subject": "who/what this fact is about, e.g. 'Unit A601', 'Termination Clause'",
    "attribute": "what kind of fact this is, e.g. 'self_finance_price', 'notice_period'",
    "value": "the value exactly as shown (string)",
    "unit": "unit if any, e.g. USD|%|sqm|null"
  }
]

Rules:
- Only extract what is clearly legible — do not guess a value you can't read confidently
- Each fact must have a specific value, not a description
- For a table, each distinct row/item gets its own fact(s)`

interface AiVisionFact {
  category?: string | null
  subject?: string | null
  attribute?: string | null
  value?: string | number | null
  unit?: string | null
}

function parseNumberValue(value: string): number | null {
  const cleaned = value.replace(/[,$]/g, '').trim()
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && /^-?[\d.]+%?$/.test(cleaned) ? n : null
}

// Stage 2 — direct structured fact extraction from a page image, for a
// chunk that was flagged table-shaped but produced zero facts from the
// text-based extractors. Returns [] (never throws) on any failure.
export async function visionExtractFactsFromPage(
  buffer: Buffer, pageNumber: number, tenantId: string, documentId: string, deadline?: number,
  onFailure?: (info: { reason: string; network?: boolean }) => void,
): Promise<DocumentFact[]> {
  let imageBuffer: Buffer
  try {
    imageBuffer = await renderPageToImage(buffer, pageNumber)
  } catch (e) {
    console.error(`[visionExtraction] render failed for page ${pageNumber}:`, e)
    onFailure?.({ reason: (e as Error).message })
    return []
  }

  let raw: string
  try {
    raw = await claudeComplete({
      maxTokens: 4096,
      deadline,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: VISION_FACTS_PROMPT },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBuffer.toString('base64') } },
        ],
      }],
    })
  } catch (e) {
    console.error(`[visionExtraction] fact extraction call failed for page ${pageNumber}:`, e)
    onFailure?.({ reason: (e as Error).message, network: isNetworkError(e) })
    return []
  }

  let parsed: AiVisionFact[]
  try {
    parsed = JSON.parse(extractJSON(raw))
  } catch (e) {
    console.error(`[visionExtraction] JSON parse failed for page ${pageNumber}:`, e)
    return []
  }
  if (!Array.isArray(parsed)) return []

  const facts: DocumentFact[] = []
  for (const f of parsed) {
    if (!f.subject || !f.attribute || f.value == null) continue
    const valueText = String(f.value).trim()
    if (!valueText) continue
    facts.push({
      tenant_id: tenantId,
      document_id: documentId,
      chunk_id: null,
      category: f.category ?? null,
      subject: f.subject,
      attribute: f.attribute,
      value_text: valueText,
      value_number: parseNumberValue(valueText),
      value_date: null,
      unit: f.unit ?? null,
      page_number: pageNumber,
      section_title: null,
      // Slightly below the 75 used for text-based generic facts — vision
      // transcription of a page a text pass already struggled with carries
      // its own error risk, and this still comfortably clears the >=70
      // validated-facts gate used everywhere else.
      confidence: 70,
      flags: [],
      extraction_method: 'ai',
    })
  }
  return facts
}
