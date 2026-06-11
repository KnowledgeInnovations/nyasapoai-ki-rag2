/**
 * One-time backfill: re-derives extraction_method='table' financial_facts for
 * every existing document using the new TS table extractor
 * (src/lib/tableExtraction.ts), replacing the old Python/pdfplumber-derived
 * rows. This is the same logic that now runs automatically inside
 * /api/documents/[id]/train for every future upload — running it here just
 * applies it to documents that were trained before the TS port existed.
 *
 * Usage:
 *   npx tsx scripts/backfill_table_facts.mts
 */

import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractTableRecordsFromPdf } from '../src/lib/tableExtraction'
import { tableRecordToFact, runSanityChecks, type FinancialFact } from '../src/lib/factExtraction'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.loadEnvFile(path.join(ROOT, '.env.local'))

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, title, file_path, source, tenant_id')
    .not('file_path', 'is', null)

  if (error) throw error
  const pdfDocs = (docs ?? []).filter(d => path.extname(d.source ?? '').toLowerCase() === '.pdf')
  console.log(`Found ${pdfDocs.length} PDF document(s)`)

  let allFacts: FinancialFact[] = []
  const documentIds: string[] = []

  for (const doc of pdfDocs) {
    process.stdout.write(`${doc.title}... `)
    const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(doc.file_path)
    if (dlErr || !blob) {
      console.log(`skip (download failed: ${dlErr?.message})`)
      continue
    }
    const buffer = Buffer.from(await blob.arrayBuffer())

    try {
      const records = await extractTableRecordsFromPdf(buffer)
      let kept = 0
      for (const record of records) {
        const fact = tableRecordToFact({ ...record, document_id: doc.id }, doc.tenant_id, doc.id)
        if (fact) {
          allFacts.push(fact)
          kept++
        }
      }
      documentIds.push(doc.id)
      console.log(`${kept}/${records.length} records converted`)
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`)
    }
  }

  console.log(`\nConverted ${allFacts.length} facts total — running sanity checks...`)
  allFacts = runSanityChecks(allFacts)

  const validCount = allFacts.filter(f => f.confidence >= 70 && f.flags.length === 0).length
  console.log(`${validCount}/${allFacts.length} facts pass confidence>=70 with no flags (VALIDATED FACTS gate)`)

  console.log(`\nDeleting existing extraction_method='table' facts for ${documentIds.length} document(s)...`)
  const { error: delError } = await supabase
    .from('financial_facts')
    .delete()
    .eq('extraction_method', 'table')
    .in('document_id', documentIds)
  if (delError) throw delError

  const BATCH = 500
  for (let i = 0; i < allFacts.length; i += BATCH) {
    const batch = allFacts.slice(i, i + BATCH)
    const { error: insError } = await supabase.from('financial_facts').insert(batch)
    if (insError) throw insError
    console.log(`  inserted ${Math.min(i + BATCH, allFacts.length)}/${allFacts.length}`)
  }

  console.log('\nDone.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
