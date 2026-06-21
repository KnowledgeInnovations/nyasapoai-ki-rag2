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
}

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

  // One chunk per call (unlike aiEnhanceTableFacts' multi-chunk batching) —
  // a fact extracted from a combined multi-chunk batch can't be tied back
  // to a single page/section, which would leave page_number/section_title
  // null for most facts. Citation precision matters more here than the
  // extra Claude calls cost, since this is the only grounding layer
  // non-budget documents get.
  async function processChunk(chunk: ProcessedChunk) {
    try {
      // Raised from 2048 alongside the same fix in factExtraction.ts's
      // aiEnhanceTableFacts — a single chunk is less likely to produce a
      // huge fact list, but the headroom costs nothing and avoids the same
      // truncation/JSON-parse-failure mode for a fact-dense excerpt.
      const raw = await claudeComplete({
        maxTokens: 8192,
        messages: [{
          role: 'user',
          content: `Extract clearly-stated factual data points from this document excerpt — dates, amounts, names, statuses, deadlines, quantities, obligations, specifications, anything concrete and specific. Return a JSON array (empty array if nothing found):

[
  {
    "category": "broad bucket, e.g. financial|legal|hr|operational|compliance|other",
    "subject": "who/what this fact is about, e.g. 'Termination Clause', 'Employee Onboarding', 'Server Uptime SLA'",
    "attribute": "what kind of fact this is, e.g. 'notice_period', 'salary', 'deadline', 'target'",
    "value": "the value exactly as stated (string)",
    "unit": "unit if any, e.g. days|USD|%|null"
  }
]

Rules:
- Only extract what is literally and clearly stated — do not infer, guess, or summarize
- Skip vague or ambiguous statements
- Each fact must have a specific value, not a description

Document excerpt:
${chunk.text}`,
        }],
      })
      const parsed: AiGenericFact[] = JSON.parse(extractJSON(raw))
      if (!Array.isArray(parsed)) return
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
          value_date: parseDateValue(valueText),
          unit: f.unit ?? null,
          page_number: chunk.page_number,
          section_title: chunk.section_title,
          // Same base as aiEnhanceTableFacts — reaches the >=70 validated
          // gate without claiming table-extraction-grade certainty.
          confidence: 75,
          flags: [],
          extraction_method: 'ai',
        })
      }
    } catch (e) {
      console.error('[extractGenericFacts] chunk failed:', e)
    }
  }

  for (const chunk of usableChunks) await processChunk(chunk)

  return facts
}
