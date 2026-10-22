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
import { claudeComplete, extractJSON, isNetworkError } from './claude'

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

// How small a batch may get before combining stops helping. Reached by
// halving (see batchCharCap below) on a document whose excerpts turn out to
// produce far more output than the batch size assumed.
const MIN_GENERIC_FACT_BATCH_CHARS = 1200

// The ceiling for dense, machine-formatted content — a station register, a
// price list, a timetable. What decides whether a call succeeds is the size
// of its reply, not the size of its prompt, and such content yields an
// order of magnitude more facts per character than prose: one 1,544-char
// excerpt of an FM station register was measured producing 5,576 output
// tokens in 46s. Batched four at a time under the prose ceiling, the same
// material needs over 20,000 tokens and roughly three minutes, so it
// exceeds both the output ceiling and the per-call allowance and comes back
// as nothing at all — 55 excerpts, two full pass budgets, zero facts. One
// excerpt per call completes.
const DENSE_FACT_BATCH_CHARS = 1800

// Digit share above which an excerpt counts as dense. Measured across this
// deployment's documents: prose and brochures run 0.7-4.4%, while the two
// documents whose fact extraction kept failing — an FM station register and
// a floor-by-floor price table — run 15.7% and 18.6%. Nothing sits near the
// boundary, and the cost of being wrong is asymmetric: treating prose as
// dense merely issues a few more cheap calls, while treating a table as
// prose returns nothing.
const DENSE_DIGIT_RATIO = 0.08

// How many batches are in flight at once.
//
// This was strictly sequential, which is affordable for prose and hopeless
// for a dense table. Measured on a 58-excerpt FM station register: one
// 1,544-character excerpt takes 46s and yields 83 facts, so the whole
// document needs roughly 45 minutes of model time. Against a 240s pass
// budget that checked four excerpts and left 54 for a later pass that would
// make the same four-excerpt dent. Six at a time brings the same document
// within two or three passes. Kept modest because every call here shares
// one account's rate limit with chat; claudeComplete already backs off on
// 429.
const GENERIC_FACT_CONCURRENCY = 6

// This runs LAST in the training pipeline, after PDF extraction, chunking
// (including its own "AI-clean table blocks" Claude call) and embedding —
// all of which are counted against the same shared routeDeadline. Confirmed
// live: a large, image-heavy 73-page brochure let those earlier stages eat
// nearly the entire 240s soft budget, so by the time this function started,
// claude.ts's deadline-aware timeoutMs() had shrunk toward its 1s floor —
// every single batch call failed near-instantly as a "timeout", and the
// document ended up with ZERO document_facts, not merely a partial set.
// Reserving a floor here means this fallback — the ONLY structured fact
// layer a non-budget tenant gets — is never entirely starved by whatever
// the earlier stages happened to spend, at the cost of occasionally running
// a bit past the nominal soft budget on a slow document. That's a better
// trade than a guaranteed-empty result: this is the last step in the
// pipeline, so the overrun is small and bounded, not compounding.
// Raised from 60s to 120s after confirming live that 60s still wasn't
// enough for a modest 31-chunk document (~7 batches) to reliably finish —
// it recovered from 0 facts to 32, but still lost 7 of 31 excerpts (23%) to
// the deadline, including the one section (a 2-bedroom/duplex price table)
// this fix exists to recover. ~7 sequential batches at realistic per-call
// latency comfortably fit in 120s with room to spare.
const MIN_GENERIC_FACTS_BUDGET_MS = 120_000

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

// Reorders chunks into an evenly-spread traversal (small local runs,
// round-robined across buckets spanning the whole document) instead of
// strict front-to-back order. Confirmed live: a 72-page property brochure's
// generic fact extraction hit its wall-clock deadline partway through and
// silently stopped at page 36 of 72 — losing every fact in the entire
// second half of the document (in this case, the 2-bedroom/duplex pricing
// table, which only appeared past that point; only the earlier studio-unit
// pricing made it into document_facts). Worse, a retrain restarts chunk
// processing from index 0 every time, so it would hit the exact same wall
// and drop the exact same section on every future attempt — this isn't a
// transient flake, it's a deterministic, permanent blind spot for anything
// past the truncation point in a large document. Interleaving in small runs
// (keeps a table/section's own nearby chunks mostly batched together, so
// local context for extraction is preserved) but spread across buckets
// means a deadline cutoff now loses a scattered handful of runs throughout
// the document rather than guaranteeing zero coverage of everything after
// wherever time ran out.
// Picks the batch ceiling from a sample of the document's own text. Cheap
// on purpose: no model call, and it reads the same excerpts that are about
// to be processed.
function batchCharsFor(chunks: ProcessedChunk[]): number {
  const sample = chunks.slice(0, 12).map(c => c.text).join('')
  if (!sample.length) return GENERIC_FACT_BATCH_CHARS
  const digitShare = (sample.match(/\d/g) ?? []).length / sample.length
  return digitShare > DENSE_DIGIT_RATIO ? DENSE_FACT_BATCH_CHARS : GENERIC_FACT_BATCH_CHARS
}

function interleaveForCoverage<T>(items: T[], runSize = 4, buckets = 6): T[] {
  if (items.length <= runSize * 2) return items
  const runs: T[][] = []
  for (let i = 0; i < items.length; i += runSize) runs.push(items.slice(i, i + runSize))
  const groupCount = Math.min(buckets, runs.length)
  // Contiguous blocks — bucket 0 is the document's first segment, bucket 1
  // the next, and so on — NOT a modulo assignment of runs to buckets:
  // assigning run i to bucket (i % groupCount) and then reading back
  // position-major reconstructs the exact original order (each bucket's
  // position-p slot maps 1:1 back to a single contiguous original index),
  // which is a no-op, not a spread. Splitting into whole document segments
  // and taking one run from each segment in turn is what actually touches
  // the start, middle, and end of the document early.
  const blockSize = Math.ceil(runs.length / groupCount)
  const grouped: T[][][] = []
  for (let b = 0; b < groupCount; b++) grouped.push(runs.slice(b * blockSize, (b + 1) * blockSize))
  const out: T[] = []
  const maxLen = Math.max(...grouped.map(g => g.length))
  for (let i = 0; i < maxLen; i++) {
    for (const g of grouped) if (g[i]) out.push(...g[i])
  }
  return out
}

export async function extractGenericFacts(
  chunks: ProcessedChunk[],
  tenantId: string,
  documentId: string,
  // Wall-clock cutoff (Date.now() epoch ms) — once past it, stop starting
  // new batches and return what's accumulated so far. Batching (above) cuts
  // the call count a lot, but a large enough document (1000+ chunks) can
  // still add up to more than the training route's maxDuration; without a
  // cutoff here, that document gets killed by the platform mid-call with no
  // chance to persist a terminal status, leaving it stuck in "processing"
  // forever — the exact incident this fallback exists to avoid. Partial
  // generic facts (most of the document, just not literally every chunk)
  // are far more useful than none, so this degrades rather than fails.
  deadline = Infinity,
  // Invoked when a batch is dropped after exhausting retries — lets the
  // caller surface "some document facts were lost" in processing_warnings
  // instead of this being silent console.error noise.
  onBatchDropped?: (info: { reason: string; network?: boolean; budgetExhausted?: boolean }) => void,
  // Invoked after each batch that completes without being dropped. Lets a
  // resumable caller record which chunks have been checked, so a later pass
  // can queue only the rest instead of starting from the beginning. See
  // migration 035 and /api/documents/[id]/extract-facts.
  onBatchComplete?: (chunks: ProcessedChunk[]) => void,
): Promise<DocumentFact[]> {
  const usableChunks = interleaveForCoverage(chunks.filter(c => c.text.trim().length > 30))
  if (!usableChunks.length) return []

  // See MIN_GENERIC_FACTS_BUDGET_MS above — guarantee a floor regardless of
  // how much of the caller's deadline earlier pipeline stages already spent.
  const startedAt = Date.now()
  const effectiveDeadline = Math.max(deadline, Date.now() + MIN_GENERIC_FACTS_BUDGET_MS)

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

  // Starts from what this document's own text implies, and shrinks further
  // if a reply still comes back truncated — see the parse failure path.
  let batchCharCap = batchCharsFor(usableChunks)

  // Returns whether the batch was genuinely examined. A batch dropped
  // because the allowance expired returns false, and that distinction is
  // load-bearing: the resumable pass stamps the excerpts a completed batch
  // covered, so reporting a dropped batch as checked marks a document
  // complete while it holds nothing. Measured: a 58-excerpt register had
  // three excerpts stamped having extracted zero facts.
  async function processBatch(batch: ProcessedChunk[], depth = 0): Promise<boolean> {
    const combined = batch.map((c, i) => `[Excerpt ${i + 1}${c.page_number ? ` (page ${c.page_number})` : ''}]\n${c.text}`).join('\n\n')
    let raw: string
    try {
      // Raised from 2048 alongside the same fix in factExtraction.ts's
      // aiEnhanceTableFacts — avoids silent truncation/JSON-parse-failure on
      // a fact-dense batch.
      raw = await claudeComplete({
        // A single dense table excerpt was measured producing 5,576 output
        // tokens from 1,544 input characters. At 8192 a two-excerpt batch of
        // such content truncates mid-JSON, which costs a full 46s call and
        // returns nothing — so the ceiling has to leave room for the batch
        // the sizing logic below is willing to send.
        maxTokens: 16384,
        deadline: effectiveDeadline,
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
      // An abort raised because OUR deadline expired is not a network fault,
      // even though both arrive as AbortError/TimeoutError and
      // isNetworkError() cannot distinguish them. Reporting the difference
      // matters: "network interruption" sends an administrator looking for a
      // connectivity problem that never existed, when the real cause is this
      // run running out of its own time budget.
      const outOfBudget = Date.now() > effectiveDeadline
      onBatchDropped?.({
        reason: outOfBudget
          ? 'Time budget reached while checking this excerpt for facts.'
          : (e as Error).message,
        network: outOfBudget ? false : isNetworkError(e),
        budgetExhausted: outOfBudget,
      })
      return false
    }

    let parsed: AiGenericFact[]
    try {
      parsed = JSON.parse(extractJSON(raw))
    } catch (e) {
      // Same truncation-recovery strategy as aiEnhanceTableFacts: split the
      // batch and retry each half before giving up on a fact-dense excerpt.
      if (batch.length > 1) {
        // The reply did not parse, and the overwhelmingly common cause is the
        // model running out of output tokens mid-array. Splitting recovers
        // this batch, but without also lowering the ceiling every later batch
        // of the same document repeats the doomed call at full price — which
        // is how one 240s budget went on four excerpts.
        batchCharCap = Math.max(MIN_GENERIC_FACT_BATCH_CHARS, Math.floor(batchCharCap / 2))
        const mid = Math.ceil(batch.length / 2)
        const firstHalf = await processBatch(batch.slice(0, mid), depth)
        const secondHalf = await processBatch(batch.slice(mid), depth)
        return firstHalf && secondHalf
      }
      const lines = batch[0].text.split('\n')
      if (depth < MAX_TEXT_SPLIT_DEPTH && lines.length >= 6) {
        const mid = Math.ceil(lines.length / 2)
        const halves = [lines.slice(0, mid).join('\n'), lines.slice(mid).join('\n')]
        let bothHalves = true
        for (const halfText of halves) {
          if (halfText.trim()) bothHalves = await processBatch([{ ...batch[0], text: halfText }], depth + 1) && bothHalves
        }
        return bothHalves
      }
      console.error('[extractGenericFacts] batch failed:', e)
      return false
    }

    if (!Array.isArray(parsed)) return true
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
    return true
  }

  // Reports a batch to the caller only if it was really examined — a batch
  // that parsed, even to zero facts, so a document that genuinely holds no
  // facts stops being re-queued. The previous test compared the fact count
  // before and after with `>=`, which is true unconditionally, so every
  // dropped batch was reported as checked.
  let checkedChunks = 0
  async function runBatch(batch: ProcessedChunk[]) {
    if (await processBatch(batch)) {
      checkedChunks += batch.length
      onBatchComplete?.(batch)
    }
  }

  // Batches are cut as workers ask for them, not all up front, so a ceiling
  // lowered by a truncated reply applies to everything still to come.
  let cursor = 0
  function nextBatch(): ProcessedChunk[] | null {
    if (cursor >= usableChunks.length) return null
    const batch: ProcessedChunk[] = []
    let chars = 0
    while (cursor < usableChunks.length) {
      const chunk = usableChunks[cursor]
      if (batch.length && chars + chunk.text.length > batchCharCap) break
      batch.push(chunk)
      chars += chunk.text.length
      cursor++
    }
    return batch
  }

  await Promise.all(
    Array.from({ length: Math.min(GENERIC_FACT_CONCURRENCY, usableChunks.length) }, async () => {
      for (;;) {
        // Checked before taking work, not after: a worker that starts a
        // batch past the deadline burns an allowance that has already
        // shrunk to its floor and fails anyway.
        if (Date.now() > effectiveDeadline) return
        const batch = nextBatch()
        if (!batch) return
        await runBatch(batch)
      }
    }),
  )

  // The deadline loop above breaks silently by design (a document stuck
  // re-hitting the same wall on every retrain is worse than one that
  // finishes with partial facts) — but silent used to mean genuinely
  // invisible: no warning ever reached processing_warnings, so a partially-
  // extracted document looked identical to a fully-extracted one. Surface it
  // explicitly so admins/auto-reprocess have a real signal that some facts
  // (now spread across the whole document, not concentrated at the end —
  // see interleaveForCoverage) were not extracted.
  if (checkedChunks < usableChunks.length) {
    // Explain where the time went. "Time budget reached" on its own tells an
    // administrator nothing actionable: the useful facts are how much of the
    // budget this stage was actually handed (earlier pipeline stages spend
    // the same allowance first), how long it got through, and what that
    // implies about the per-excerpt cost of this particular document.
    const spentMs = Date.now() - startedAt
    const grantedMs = effectiveDeadline - startedAt
    const checked = checkedChunks
    // Per-excerpt cost is wall clock divided by excerpts actually completed,
    // over however many ran at once — so it stays the right number to
    // project the remainder against this same pass budget.
    const perChunkMs = checked > 0 ? Math.round(spentMs / checked) : null
    const remaining = usableChunks.length - checkedChunks
    const projectedMs = perChunkMs != null ? perChunkMs * remaining : null

    const diagnosis =
      grantedMs < MIN_GENERIC_FACTS_BUDGET_MS * 0.9
        ? `Only ${Math.round(grantedMs / 1000)}s of the run's budget was left for fact extraction — earlier stages (text extraction, chunking, embedding) consumed the rest.`
        : `Fact extraction had ${Math.round(grantedMs / 1000)}s and used ${Math.round(spentMs / 1000)}s.`

    const rate = perChunkMs != null
      ? ` This document costs about ${(perChunkMs / 1000).toFixed(1)}s per excerpt${projectedMs != null ? `, so the remaining ${remaining} need roughly ${Math.round(projectedMs / 1000)}s more` : ''}.`
      : ''

    console.warn('[extractGenericFacts] budget exhausted', {
      documentId, checked, remaining, total: usableChunks.length,
      grantedMs, spentMs, perChunkMs, projectedMs,
    })

    onBatchDropped?.({
      reason: `Time budget reached — ${remaining} of ${usableChunks.length} excerpts are still to be checked for facts. ${diagnosis}${rate} The remainder are queued and will be processed automatically; nothing has been lost.`,
      budgetExhausted: true,
    })
  }

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
