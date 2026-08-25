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
