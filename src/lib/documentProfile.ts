/**
 * Asks the model what shape a document actually has, once, before anything
 * downstream assumes one.
 *
 * Why this exists. Every structural decision in this pipeline was a
 * hard-coded rule about how a document is laid out: a heading is numbered
 * or shouted or Title Case; a table is detected by whitespace columns; a
 * fact is a free-form subject/attribute/value triple. Those rules were
 * written against the documents we happened to have, and a document that
 * does not follow them degrades silently — it still produces chunks and
 * facts, so nothing looks wrong, and the answers are simply worse.
 *
 * Two measured consequences. A 40-page station register extracted as 4,170
 * free-form triples in which one column arrived under four different names
 * (station_type, type_of_fm_radio_station, type_of_fm_station,
 * type_of_station), so counting across the document meant matching
 * synonyms and the answer could only ever be approximate. And across a
 * 16-document corpus, not one document produced a section title until the
 * heading rules were widened — and widening rules is not a general fix,
 * only a bigger set of assumptions.
 *
 * What the profile is for. It names the document's own column headings, so
 * fact extraction can use them as a controlled vocabulary instead of
 * inventing a name per call; it gives real examples of the document's
 * headings, so section detection can match that document's style rather
 * than our fixed list; and it says whether the document is a set of
 * repeating records, so each chunk of rows can carry the column names that
 * make it readable on its own.
 *
 * One call per document, cached on the document row. Everything it informs
 * degrades to the previous rule-based behaviour when it is absent, so a
 * profile that fails to parse costs nothing.
 */

import { claudeComplete, extractJSON } from './claude'
import type { ExtractedPage } from './documentProcess'

export interface DocumentProfile {
  /**
   * 'records' — repeating rows about many instances of one thing: a
   *   register, price list, inventory, timetable, schedule of fees.
   * 'prose'   — continuous text in sections: a policy, report, contract.
   * 'form'    — labelled fields for one subject: an application, invoice.
   * 'mixed'   — prose with substantial tables, e.g. an annual report.
   */
  kind: 'records' | 'prose' | 'form' | 'mixed'
  /** What one record is, in the document's words: "FM station", "unit". */
  entityNoun: string | null
  /**
   * The document's own column or field names, verbatim. Used as the
   * vocabulary fact extraction must reuse, which is what makes counting
   * across the document exact rather than a matter of matching synonyms.
   */
  columns: string[]
  /** Heading lines copied verbatim from the sample, for style matching. */
  headingExamples: string[]
  /** One line on anything unusual about how it is laid out. */
  notes: string | null
}

const MAX_SAMPLE_CHARS = 9000
const MAX_COLUMNS = 40
const MAX_HEADING_EXAMPLES = 12

/**
 * Samples the beginning, middle and end rather than the first N characters.
 * A register's first page is a cover and a summary table; its columns only
 * appear once the listing starts. A report's first page is a title page.
 */
export function sampleForProfile(pages: ExtractedPage[]): string {
  // Table rows count as content. A spreadsheet's rows travel in `tables`,
  // not in `text` — its page text is just the sheet name — so testing
  // `text` alone dropped every page of a workbook and left the most
  // column-structured documents in existence unprofiled, which is exactly
  // backwards: a spreadsheet's header row IS the vocabulary.
  const contentLength = (page: ExtractedPage) =>
    (page.text ?? '').trim().length + (page.tables ?? []).flat(2).join('').length
  const withText = pages.filter(p => contentLength(p) > 40)
  if (!withText.length) return ''

  const picks = withText.length <= 3
    ? withText
    : [withText[0], withText[Math.floor(withText.length / 2)], withText[withText.length - 1]]

  const perPage = Math.floor(MAX_SAMPLE_CHARS / picks.length)
  return picks
    .map(p => {
      // The first rows of the first couple of tables: for a spreadsheet
      // that is the header row plus enough data to tell what the columns
      // hold, which is all the profile needs.
      const tableText = (p.tables ?? [])
        .slice(0, 2)
        .map(t => t.slice(0, 8).map(r => r.join(' | ')).join('\n'))
        .join('\n')
      const body = [(p.text ?? '').trim(), tableText].filter(Boolean).join('\n')
      return `[${p.page_number != null ? `page ${p.page_number}` : 'document'}]\n${body.slice(0, perPage)}`
    })
    .join('\n\n')
}

export async function profileDocument(
  pages: ExtractedPage[],
  title: string,
  deadline?: number,
): Promise<DocumentProfile | null> {
  const sample = sampleForProfile(pages)
  if (sample.length < 120) return null

  let raw: string
  try {
    raw = await claudeComplete({
      maxTokens: 2048,
      deadline,
      messages: [{
        role: 'user',
        content: `Describe the SHAPE of this document — not its subject matter. Another program will use your answer to decide how to split it up and what to call the fields it extracts, so be literal and use the document's own wording.

Return only JSON:

{
  "kind": "records" | "prose" | "form" | "mixed",
  "entityNoun": "what ONE record is about, singular, in the document's words (e.g. \\"FM station\\", \\"apartment unit\\", \\"employee\\") — null if the document is not about repeating records",
  "columns": ["the document's own column or field headings, verbatim, in the order they appear"],
  "headingExamples": ["heading lines copied EXACTLY as they appear, including any numbering"],
  "notes": "one line on anything unusual about the layout, or null"
}

Definitions:
- "records": repeating rows each describing a different instance of the same thing — a register, listing, price list, inventory, timetable, schedule of fees.
- "prose": continuous text organised in sections — a policy, report, contract, strategy.
- "form": labelled fields describing one subject — an application, invoice, certificate.
- "mixed": substantial amounts of both.

Rules:
- "columns" is the document's field vocabulary whatever its layout: the column headings of a table, the labels printed beside or above the boxes of a form, or the row labels of a key-value block. A form's labels belong here — do not leave it empty just because the document is not a table.
- "columns" must be the headings the DOCUMENT uses, copied as written — do not translate them into tidy field names, do not invent any, and do not include a heading you cannot see.
- "headingExamples" must be lines that appear verbatim in the text below. If the document has no headings, return an empty array rather than guessing.
- Judge from the layout, not from what the document is about.

Document title: ${title}

${sample}`,
      }],
    })
  } catch (e) {
    // A profile is an improvement, never a prerequisite: everything that
    // uses it falls back to the rule-based behaviour.
    console.error('[documentProfile] profiling failed:', (e as Error).message)
    return null
  }

  try {
    const parsed = JSON.parse(extractJSON(raw)) as Partial<DocumentProfile>
    const kind = parsed.kind
    if (kind !== 'records' && kind !== 'prose' && kind !== 'form' && kind !== 'mixed') return null

    const clean = (values: unknown, limit: number) =>
      Array.isArray(values)
        ? [...new Set(values.map(v => String(v ?? '').trim()).filter(v => v.length > 0 && v.length <= 120))].slice(0, limit)
        : []

    // Heading examples are only useful if they really are in the document —
    // a hallucinated example would teach the chunker a style the document
    // does not have. Checked against the sample, which is where they were
    // supposed to come from.
    const sampleNorm = sample.replace(/\s+/g, ' ').toLowerCase()
    const headingExamples = clean(parsed.headingExamples, MAX_HEADING_EXAMPLES)
      .filter(h => sampleNorm.includes(h.replace(/\s+/g, ' ').toLowerCase()))

    return {
      kind,
      entityNoun: parsed.entityNoun ? String(parsed.entityNoun).trim().slice(0, 80) || null : null,
      columns: clean(parsed.columns, MAX_COLUMNS),
      headingExamples,
      notes: parsed.notes ? String(parsed.notes).trim().slice(0, 300) || null : null,
    }
  } catch (e) {
    console.error('[documentProfile] could not parse the profile:', (e as Error).message)
    return null
  }
}

/**
 * A predicate for "is this line a heading in THIS document", derived from
 * the document's own headings rather than from a fixed list of shapes.
 *
 * Returns null when the examples support no reliable rule, in which case
 * the caller keeps its built-in detection.
 */
export function headingMatcherFor(profile: DocumentProfile | null): ((line: string) => boolean) | null {
  const examples = profile?.headingExamples ?? []
  if (examples.length < 2) return null

  const shape = (text: string) => ({
    numbered: /^\(?\d+(\.\d+)*[.)]?\s/.test(text) || /^[(\[]?[a-z][.)]\s/i.test(text) || /^[IVXLC]+[.)]\s/.test(text),
    shouted: text === text.toUpperCase() && /[A-Z]{3}/.test(text),
    words: text.trim().split(/\s+/).length,
    endsClean: !/[.,;!?]$/.test(text.trim()),
  })

  const shapes = examples.map(shape)
  const allNumbered = shapes.every(s => s.numbered)
  const allShouted = shapes.every(s => s.shouted)
  const maxWords = Math.max(...shapes.map(s => s.words)) + 2

  // Only a property shared by every example becomes a rule. Anything less
  // and the "rule" is really a guess about the two or three lines we saw.
  if (!allNumbered && !allShouted) return null

  return (line: string) => {
    const text = line.trim()
    if (!text || text.length > 140) return false
    const s = shape(text)
    if (s.words > maxWords || !s.endsClean) return false
    // Tabular data is never a heading, whatever its capitalisation — a
    // register's rows are shouted too.
    const digits = (text.match(/\d/g) ?? []).length
    if (digits > text.length * 0.25) return false
    if (allNumbered && !s.numbered) return false
    if (allShouted && !s.shouted) return false
    return true
  }
}
