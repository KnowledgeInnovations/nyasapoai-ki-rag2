/**
 * Shared per-document fact re-extraction — clears a document's
 * financial_facts and rebuilds them from its already-stored
 * document_chunks (no re-embedding, no re-upload needed). Extracted from
 * refacts-all.ts so the same hardened logic (real chunk ids, batched
 * inserts with verification, network retries) can be called both by that
 * standalone corpus-maintenance script AND by the auto-reprocess trigger
 * (autoReprocess.ts) — the trigger needs to FORCE re-extraction on a
 * document that already has facts (that's the whole point: the existing
 * facts are suspected stale/wrong), which is the opposite of
 * refacts-all.ts's own default "skip if already populated" behavior.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProcessedChunk } from './documentProcess'
import { extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks, looksLikeBudgetDocument, type FinancialFact } from './factExtraction'
import { extractTableRecordsFromPdf } from './tableExtraction'
import { withRetry } from './claude'

async function downloadWithRetry(svc: SupabaseClient, filePath: string, attempts = 4): Promise<Buffer> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await svc.storage.from('documents').download(filePath)
      if (error || !data) throw new Error(error?.message ?? 'no data')
      return Buffer.from(await data.arrayBuffer())
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, (i + 1) * 2000))
    }
  }
  throw lastErr
}

export interface ReExtractResult {
  skipped: boolean
  reason?: string
  factsAttempted: number
  factsPersisted: number
}

export async function reExtractDocumentFacts(
  svc: SupabaseClient, documentId: string,
  opts: { force?: boolean; aiDeadlineMs?: number } = {},
): Promise<ReExtractResult> {
  const docRes = await withRetry(() => svc.from('documents').select('id, title, source, file_path, tenant_id').eq('id', documentId).single(), 'fetch document')
  if (docRes.error || !docRes.data) return { skipped: true, reason: 'document not found', factsAttempted: 0, factsPersisted: 0 }
  const doc = docRes.data as { id: string; title: string; source: string; file_path: string; tenant_id: string }

  if (!opts.force) {
    const countRes = await withRetry(() => svc.from('financial_facts').select('id', { count: 'exact', head: true }).eq('document_id', documentId), 'count existing facts')
    const existingCount = (countRes as unknown as { count: number | null }).count
    if (existingCount && existingCount > 0) return { skipped: true, reason: `already has ${existingCount} facts`, factsAttempted: 0, factsPersisted: 0 }
  }

  const chunkRes = await withRetry(() => svc.from('document_chunks')
    .select('id, chunk_text, metadata')
    .eq('document_id', documentId)
    .order('chunk_index'), 'fetch chunks')
  if (chunkRes.error) return { skipped: true, reason: `chunk fetch failed: ${(chunkRes.error as Error).message}`, factsAttempted: 0, factsPersisted: 0 }
  const chunkRows = chunkRes.data as { id: string; chunk_text: string; metadata: unknown }[]
  if (!chunkRows?.length) return { skipped: true, reason: 'no stored chunks', factsAttempted: 0, factsPersisted: 0 }

  const chunks: ProcessedChunk[] = chunkRows.map(r => ({
    text: r.chunk_text,
    page_number: (r.metadata as Record<string, unknown>)?.page_number as number | null ?? null,
    section_title: (r.metadata as Record<string, unknown>)?.section_title as string | null ?? null,
    fiscal_year: (r.metadata as Record<string, unknown>)?.fiscal_year as string | null ?? null,
    ministry: (r.metadata as Record<string, unknown>)?.ministry as string | null ?? null,
    sector: (r.metadata as Record<string, unknown>)?.sector as string | null ?? null,
    is_table: !!(r.metadata as Record<string, unknown>)?.is_table,
  }))

  const delRes = await withRetry(() => svc.from('financial_facts').delete().eq('document_id', documentId), 'delete old facts')
  if (delRes.error) return { skipped: true, reason: `delete failed, aborted to avoid mixing old+new facts: ${(delRes.error as Error).message}`, factsAttempted: 0, factsPersisted: 0 }

  const allFacts: FinancialFact[] = []
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    allFacts.push(...extractFactsFromChunk({
      id: chunkRows[i].id, document_id: documentId, tenant_id: doc.tenant_id, chunk_text: c.text,
      metadata: { page_number: c.page_number, section_title: c.section_title, fiscal_year: c.fiscal_year, ministry: c.ministry, sector: c.sector, is_table: c.is_table },
    }))
  }

  const docYearMatch = doc.title.match(/\b(19|20)\d{2}\b/)
  const docFiscalYear = docYearMatch ? docYearMatch[0] : null

  const budgetSignal = looksLikeBudgetDocument(chunks.map(c => c.text).join('\n'))
  if (budgetSignal && doc.source.toLowerCase().endsWith('.pdf')) {
    try {
      const buffer = await downloadWithRetry(svc, doc.file_path)
      const tableRecords = await extractTableRecordsFromPdf(buffer)
      for (const record of tableRecords) {
        const fact = tableRecordToFact({ ...record, document_id: documentId }, doc.tenant_id, documentId, docFiscalYear)
        if (fact) allFacts.push(fact)
      }
    } catch { /* table extraction failed — regex/AI passes still run below */ }
  }

  if (budgetSignal) {
    try {
      const aiFacts = await aiEnhanceTableFacts(chunks, doc.tenant_id, documentId, docFiscalYear, () => {}, Date.now() + (opts.aiDeadlineMs ?? 240_000))
      if (aiFacts.length) allFacts.push(...aiFacts)
    } catch { /* AI enhancement failed — regex/table facts still persist below */ }
  }

  runSanityChecks(allFacts)
  if (allFacts.length) {
    const BATCH = 500
    for (let i = 0; i < allFacts.length; i += BATCH) {
      const batch = allFacts.slice(i, i + BATCH)
      await withRetry(() => svc.from('financial_facts').insert(batch), `insert batch ${i}-${i + batch.length}`)
    }
  }

  const finalCountRes = await withRetry(() => svc.from('financial_facts').select('id', { count: 'exact', head: true }).eq('document_id', documentId), 'verify final count')
  const finalCount = (finalCountRes as unknown as { count: number | null }).count ?? 0
  return { skipped: false, factsAttempted: allFacts.length, factsPersisted: finalCount }
}
