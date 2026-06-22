/**
 * Domain-agnostic fact extraction — the counterpart to factExtraction.ts
 * for documents that aren't budget statements (contracts, HR policies,
 * technical specs, reports). factExtraction.ts only recognizes fiscal
 * aggregates (total_budget/revenue/debt/...); this module asks Claude to
 * pull out whatever clearly-stated factual data points a document actually
 * contains, with no fixed schema of what those points can be about.
 *
 * Called as a fallback in the training pipelines (train/route.ts,
 * finalize/route.ts) only when the budget-specific pass finds little/
 * nothing — see DOCUMENT_FACTS_FALLBACK_THRESHOLD at the call sites.
 */

import type { ProcessedChunk } from './documentProcess'
import { claudeComplete, extractJSON } from './claude'

export interface DocumentFact {
  tenant_id: string
  document_id: string
  chunk_id: string | null
  category: string | null
  subject: string | null
  attribute: string | null
  value_text: string
  value_number: number | null
  value_date: string | null
  unit: string | null
  page_number: number | null
  section_title: string | null
  confidence: number
  flags: string[]
  extraction_method: 'ai'
}

interface AiGenericFact {
  category?: string | null
  subject?: string | null
  attribute?: string | null
  value?: string | number | null
  unit?: string | null
  chunk?: number | null
}

// Mirrors aiEnhanceTableFacts' AI_TABLE_BATCH_CHARS (factExtraction.ts) —
// same rationale: combining several chunks into one Claude call cuts the
// call count (and so the wall-clock time) roughly proportionally to batch
// size, without combining so much text that a single call's output gets
// truncated. A document with 100+ chunks previously issued 100+ sequential
// Claude calls here (one per chunk), which on its own — independent of any
// budget-specific pipeline cost — could exceed the training route's
// maxDuration and leave the document stuck in "processing" forever.
const GENERIC_FACT_BATCH_CHARS = 6000

// "12/31/2025", "2025-12-31", "31 December 2025", "December 31, 2025" — the
// handful of date shapes a document is actually likely to state literally.
// Deliberately conservative: a false-positive date parse (e.g. treating
// "Section 12.31" as a date) is worse than leaving value_date null and
// keeping the raw text in value_text either way.
function parseDateValue(value: string): string | null {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return value
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, m, d, y] = slashMatch
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  const wordMatch = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$|^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (wordMatch) {
    const date = new Date(value)
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  return null
}

function parseNumberValue(value: string): number | null {
  const cleaned = value.replace(/[,$]/g, '').trim()
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && /^-?[\d.]+%?$/.test(cleaned) ? n : null
}

export async function extractGenericFacts(
  chunks: ProcessedChunk[],
  tenantId: string,
  documentId: string,
): Promise<DocumentFact[]> {
  const usableChunks = chunks.filter(c => c.text.trim().length > 30)
  if (!usableChunks.length) return []

  const facts: DocumentFact[] = []

  // Batched (multiple chunks per call, same char-budget pattern as
  // aiEnhanceTableFacts) rather than one call per chunk — a document with
  // 100+ chunks previously issued 100+ sequential Claude calls here alone,
  // which could exceed the training route's maxDuration on its own and
  // leave the document stuck in "processing" forever, independent of
  // anything the budget-specific pipeline did. Claude is told which
  // numbered excerpt in the batch each fact came from ("chunk": N) so
  // page_number/section_title attribution stays per-chunk-accurate even
  // though several chunks share one call.
  const MAX_TEXT_SPLIT_DEPTH = 2

  async function processBatch(batch: ProcessedChunk[], depth = 0) {
    const combined = batch.map((c, i) => `[Excerpt ${i + 1}${c.page_number ? ` (page ${c.page_number})` : ''}]\n${c.text}`).join('\n\n')
    let raw: string
    try {
      // Raised from 2048 alongside the same fix in factExtraction.ts's
      // aiEnhanceTableFacts — avoids silent truncation/JSON-parse-failure on
      // a fact-dense batch.
      raw = await claudeComplete({
        maxTokens: 8192,
        messages: [{
          role: 'user',
          content: `Extract clearly-stated factual data points from these document excerpts — dates, amounts, names, statuses, deadlines, quantities, obligations, specifications, anything concrete and specific. Return a JSON array (empty array if nothing found):

[
  {
    "category": "broad bucket, e.g. financial|legal|hr|operational|compliance|other",
    "subject": "who/what this fact is about, e.g. 'Termination Clause', 'Employee Onboarding', 'Server Uptime SLA'",
    "attribute": "what kind of fact this is, e.g. 'notice_period', 'salary', 'deadline', 'target'",
    "value": "the value exactly as stated (string)",
    "unit": "unit if any, e.g. days|USD|%|null",
    "chunk": 1
  }
]

Rules:
- Only extract what is literally and clearly stated — do not infer, guess, or summarize
- Skip vague or ambiguous statements
- Each fact must have a specific value, not a description
- "chunk" is the [Excerpt N] number this fact came from, so it can be cited back to the right page

Excerpts:
${combined}`,
        }],
      })
    } catch (e) {
      console.error('[extractGenericFacts] batch failed:', e)
      return
    }

    let parsed: AiGenericFact[]
    try {
      parsed = JSON.parse(extractJSON(raw))
    } catch (e) {
      // Same truncation-recovery strategy as aiEnhanceTableFacts: split the
      // batch and retry each half before giving up on a fact-dense excerpt.
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2)
        await processBatch(batch.slice(0, mid), depth)
        await processBatch(batch.slice(mid), depth)
        return
      }
      const lines = batch[0].text.split('\n')
      if (depth < MAX_TEXT_SPLIT_DEPTH && lines.length >= 6) {
        const mid = Math.ceil(lines.length / 2)
        const halves = [lines.slice(0, mid).join('\n'), lines.slice(mid).join('\n')]
        for (const halfText of halves) {
          if (halfText.trim()) await processBatch([{ ...batch[0], text: halfText }], depth + 1)
        }
      } else {
        console.error('[extractGenericFacts] batch failed:', e)
      }
      return
    }

    if (!Array.isArray(parsed)) return
    for (const f of parsed) {
      if (!f.subject || !f.attribute || f.value == null) continue
      const valueText = String(f.value).trim()
      if (!valueText) continue

      const sourceChunk = f.chunk != null ? batch[f.chunk - 1] : undefined

      facts.push({
        tenant_id: tenantId,
        document_id: documentId,
        chunk_id: null,
        category: f.category ?? null,
        subject: f.subject,
        attribute: f.attribute,
        value_text: valueText,
        value_number: parseNumberValue(valueText),
        value_date: parseDateValue(valueText),
        unit: f.unit ?? null,
        page_number: sourceChunk?.page_number ?? null,
        section_title: sourceChunk?.section_title ?? null,
        // Same base as aiEnhanceTableFacts — reaches the >=70 validated
        // gate without claiming table-extraction-grade certainty.
        confidence: 75,
        flags: [],
        extraction_method: 'ai',
      })
    }
  }

  let batch: ProcessedChunk[] = []
  let batchChars = 0
  for (const chunk of usableChunks) {
    if (batchChars + chunk.text.length > GENERIC_FACT_BATCH_CHARS && batch.length) {
      await processBatch(batch)
      batch = []
      batchChars = 0
    }
    batch.push(chunk)
    batchChars += chunk.text.length
  }
  if (batch.length) await processBatch(batch)

  // Repeated headers/footers (a report's title block, version number, etc.
  // printed on every page) get extracted fresh from each chunk and produce
  // exact duplicate rows — same subject+attribute+value, just from a
  // different page. Keep the first (lowest page number) occurrence only.
  const seen = new Set<string>()
  return facts.filter(f => {
    const key = `${f.subject}|${f.attribute}|${f.value_text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
