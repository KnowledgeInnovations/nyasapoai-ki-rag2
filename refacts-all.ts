import fs from 'node:fs'
import { createClient, type PostgrestSingleResponse } from '@supabase/supabase-js'
import type { ProcessedChunk } from './src/lib/documentProcess'
import { extractFactsFromChunk, tableRecordToFact, aiEnhanceTableFacts, runSanityChecks, runCrossDocumentCorroboration, supersedeForwardProjections, looksLikeBudgetDocument, type FinancialFact } from './src/lib/factExtraction'
import { extractTableRecordsFromPdf } from './src/lib/tableExtraction'
import { isNetworkError } from './src/lib/claude'

// Retries a Supabase call on a transient network failure (fetch failed,
// ECONNRESET, DNS lookup failure, etc.) with growing backoff — without this,
// a connectivity blip mid-run gets misread as real data ("document not
// found", a clean empty result) instead of "couldn't reach the database",
// silently skipping documents that genuinely exist. Non-network errors
// (a real Postgres error, a bad query) are not retried — they won't fix
// themselves by waiting.
const RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000]
async function withRetry<T>(fn: () => PromiseLike<PostgrestSingleResponse<T> | { data: unknown; error: unknown }>, label: string): Promise<{ data: unknown; error: unknown }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fn()
      if (res.error && isNetworkError(res.error) && attempt <= RETRY_BACKOFF_MS.length) {
        console.error(`  [${label}] network error, retrying:`, (res.error as Error).message)
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]))
        continue
      }
      return res
    } catch (e) {
      if (isNetworkError(e) && attempt <= RETRY_BACKOFF_MS.length) {
        console.error(`  [${label}] network error, retrying:`, (e as Error).message)
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]))
        continue
      }
      throw e
    }
  }
}

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}
process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const TENANT_ID = 'f1f12b56-b0bb-488b-b931-61431c1f8245'

async function downloadWithRetry(filePath: string, attempts = 4): Promise<Buffer> {
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

async function refactsOne(id: string) {
  const docRes = await withRetry(() => svc.from('documents').select('id, title, source, file_path, tenant_id').eq('id', id).single(), 'fetch document')
  if (docRes.error) { console.error(`SKIP ${id} — document fetch failed:`, (docRes.error as Error).message); return }
  const doc = docRes.data as { id: string; title: string; source: string; file_path: string; tenant_id: string }
  if (!doc) { console.log(`SKIP ${id} — not found`); return }

  const countRes = await withRetry(() => svc.from('financial_facts').select('id', { count: 'exact', head: true }).eq('document_id', id), 'count existing facts')
  if (countRes.error) { console.error(`SKIP ${doc.title} (${id}) — fact-count check failed:`, (countRes.error as Error).message); return }
  const existingCount = (countRes as unknown as { count: number | null }).count
  if (existingCount && existingCount > 0) { console.log(`SKIP ${doc.title} (${id}) — already has ${existingCount} facts`); return }

  console.log(`=== ${doc.title} (${id}) ===`)

  const chunkRes = await withRetry(() => svc.from('document_chunks')
    .select('id, chunk_text, metadata')
    .eq('document_id', id)
    .order('chunk_index'), 'fetch chunks')
  if (chunkRes.error) { console.error('  SKIP — chunk fetch failed:', (chunkRes.error as Error).message); return }
  const chunkRows = chunkRes.data as { id: string; chunk_text: string; metadata: unknown }[]
  if (!chunkRows?.length) { console.log('  SKIP — no stored chunks'); return }

  const chunks: ProcessedChunk[] = chunkRows.map(r => ({
    text: r.chunk_text,
    page_number: (r.metadata as Record<string, unknown>)?.page_number as number | null ?? null,
    section_title: (r.metadata as Record<string, unknown>)?.section_title as string | null ?? null,
    fiscal_year: (r.metadata as Record<string, unknown>)?.fiscal_year as string | null ?? null,
    ministry: (r.metadata as Record<string, unknown>)?.ministry as string | null ?? null,
    sector: (r.metadata as Record<string, unknown>)?.sector as string | null ?? null,
    is_table: !!(r.metadata as Record<string, unknown>)?.is_table,
  }))

  const delRes = await withRetry(() => svc.from('financial_facts').delete().eq('document_id', id), 'delete old facts')
  if (delRes.error) { console.error('  DELETE FAILED, aborting to avoid mixing old+new facts:', (delRes.error as Error).message); return }

  const allFacts: FinancialFact[] = []
  // Reconstruct chunk rows for the regex pass, using the REAL stored chunk id
  // (not a synthetic placeholder) — chunk_id is a uuid column with an FK to
  // document_chunks, so anything else fails the insert for the whole batch.
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    allFacts.push(...extractFactsFromChunk({
      id: chunkRows[i].id, document_id: id, tenant_id: doc.tenant_id, chunk_text: c.text,
      metadata: { page_number: c.page_number, section_title: c.section_title, fiscal_year: c.fiscal_year, ministry: c.ministry, sector: c.sector, is_table: c.is_table },
    }))
  }

  const docYearMatch = doc.title.match(/\b(19|20)\d{2}\b/)
  const docFiscalYear = docYearMatch ? docYearMatch[0] : null

  const budgetSignal = looksLikeBudgetDocument(chunks.map(c => c.text).join('\n'))
  if (budgetSignal && doc.source.toLowerCase().endsWith('.pdf')) {
    try {
      const buffer = await downloadWithRetry(doc.file_path)
      const tableRecords = await extractTableRecordsFromPdf(buffer)
      for (const record of tableRecords) {
        const fact = tableRecordToFact({ ...record, document_id: id }, doc.tenant_id, id, docFiscalYear)
        if (fact) allFacts.push(fact)
      }
    } catch (err) { console.error('  table extraction failed', err) }
  }

  if (budgetSignal) {
    try {
      // No Vercel maxDuration here (standalone script) — give network
      // retries a generous 10-minute window per document instead of the
      // route's tighter budget.
      const aiFacts = await aiEnhanceTableFacts(chunks, doc.tenant_id, id, docFiscalYear, () => {}, Date.now() + 600_000)
      if (aiFacts.length) allFacts.push(...aiFacts)
    } catch (err) { console.error('  AI table fact extraction failed', err) }
  }

  runSanityChecks(allFacts)
  if (allFacts.length) {
    const BATCH = 500
    for (let i = 0; i < allFacts.length; i += BATCH) {
      const batch = allFacts.slice(i, i + BATCH)
      const insRes = await withRetry(() => svc.from('financial_facts').insert(batch), `insert batch ${i}-${i + batch.length}`)
      if (insRes.error) console.error(`  INSERT FAILED (batch ${i}-${i + batch.length}):`, (insRes.error as Error).message)
    }
  }

  const finalCountRes = await withRetry(() => svc.from('financial_facts').select('id', { count: 'exact', head: true }).eq('document_id', id), 'verify final count')
  const finalCount = (finalCountRes as unknown as { count: number | null }).count
  console.log(`  ${allFacts.length} facts attempted, ${finalCount ?? 0} verified persisted (budgetSignal=${budgetSignal})`)
  if ((finalCount ?? 0) !== allFacts.length) console.error(`  MISMATCH: attempted ${allFacts.length}, persisted ${finalCount}`)
}

async function main() {
  const { data: docs } = await svc.from('documents').select('id, title').eq('tenant_id', TENANT_ID).order('title')
  for (const d of docs ?? []) {
    if (d.title.startsWith('Test:')) continue
    await refactsOne(d.id)
  }

  console.log('\n=== cross-document corroboration ===')
  const { data: allNational } = await svc.from('financial_facts').select('*')
    .eq('tenant_id', TENANT_ID).eq('entity_type', 'national').eq('metric', 'total_budget')
  const changed = runCrossDocumentCorroboration((allNational ?? []) as (FinancialFact & { id: string })[])
  for (const f of changed) {
    await svc.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
  }
  console.log(`updated ${changed.length} rows via cross-document corroboration`)

  console.log('\n=== forward-projection supersession (ministry/sector) ===')
  const { data: allMinistrySector } = await svc.from('financial_facts').select('*')
    .eq('tenant_id', TENANT_ID).in('entity_type', ['ministry', 'sector'])
  const superseded = supersedeForwardProjections((allMinistrySector ?? []) as (FinancialFact & { id: string })[])
  for (const f of superseded) {
    await svc.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
  }
  console.log(`superseded ${superseded.length} stale forward-projection rows`)
  console.log('=== DONE ===')
}

main()
