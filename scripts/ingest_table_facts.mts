/**
 * Loads python/extract_tables.py's per-document JSON output, converts each
 * record to a FinancialFact via tableRecordToFact(), runs the cross-document
 * sanity checks, and upserts the results into financial_facts
 * (extraction_method='table'). Re-running this script replaces only the
 * 'table'-sourced rows for the documents present in python/output/, so it's
 * safe to re-run after re-extracting tables.
 *
 * Usage:
 *   npx tsx scripts/ingest_table_facts.mts
 */

import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tableRecordToFact, runSanityChecks, type TableFactRecord, type FinancialFact } from '../src/lib/factExtraction'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.loadEnvFile(path.join(ROOT, '.env.local'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const OUTPUT_DIR = path.join(ROOT, 'python', 'output')

async function main() {
  const files = readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'))
  console.log(`Found ${files.length} table-extraction file(s) in ${path.relative(ROOT, OUTPUT_DIR)}`)

  let allFacts: FinancialFact[] = []
  const documentIds: string[] = []

  for (const file of files) {
    const documentId = file.replace(/\.json$/, '')
    const records: TableFactRecord[] = JSON.parse(readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'))
    if (!records.length) continue

    const { data: doc, error } = await supabase
      .from('documents')
      .select('id, tenant_id, title')
      .eq('id', documentId)
      .single()

    if (error || !doc) {
      console.warn(`  skipping ${documentId}: document not found (${error?.message ?? 'no row'})`)
      continue
    }

    documentIds.push(documentId)
    let kept = 0
    for (const record of records) {
      const fact = tableRecordToFact(record, doc.tenant_id, documentId)
      if (fact) {
        allFacts.push(fact)
        kept++
      }
    }
    console.log(`  ${doc.title}: ${kept}/${records.length} table records converted to facts`)
  }

  console.log(`\nConverted ${allFacts.length} facts total — running sanity checks...`)
  allFacts = runSanityChecks(allFacts)

  const validCount = allFacts.filter(f => f.confidence >= 70 && f.flags.length === 0).length
  console.log(`${validCount}/${allFacts.length} facts pass confidence>=70 with no flags (VALIDATED FACTS gate)`)

  if (!documentIds.length) {
    console.log('No documents to update — nothing to do.')
    return
  }

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
    const { error } = await supabase.from('financial_facts').insert(batch)
    if (error) throw error
    console.log(`  inserted ${Math.min(i + BATCH, allFacts.length)}/${allFacts.length}`)
  }

  console.log('\nDone.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
