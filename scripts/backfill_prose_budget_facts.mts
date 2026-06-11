/**
 * One-time backfill: extracts the national "Total Payments" figure that each
 * 2002-2009 budget statement reports for its own fiscal year, from the
 * "Resource Allocation"/"Payments" prose section (these documents have no
 * machine-readable tables for tableExtraction.ts to find). Pre-2007
 * documents report the figure in old Cedis ("billion"); Ghana redenominated
 * the currency at 10,000:1 in 2007, so old-Cedi billions are converted to
 * new Ghana Cedi (GH¢) millions by dividing by 10. 2008/2009 already report
 * GH¢ million directly.
 *
 * Each entry's regex is matched against the specific page where the figure
 * was located by manual inspection — if a document is re-uploaded with
 * different pagination/wording, the regex simply won't match and the script
 * reports it rather than inserting a stale/wrong figure.
 *
 * Usage:
 *   npx tsx scripts/backfill_prose_budget_facts.mts
 */

import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { runSanityChecks, type FinancialFact } from '../src/lib/factExtraction'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.loadEnvFile(path.join(ROOT, '.env.local'))

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface Entry {
  title: string
  fiscalYear: string
  page: number
  rx: RegExp
  // Old-Cedi "billion" figures: divide by 10 to get GH¢ million (10,000:1
  // redenomination). GH¢ "million" figures: used as-is.
  oldCedi: boolean
}

const ENTRIES: Entry[] = [
  { title: 'bud2002', fiscalYear: '2002', page: 24, oldCedi: true,
    rx: /total\s+payments\s+are\s+also\s+projected\s+at\s+¢\s*([\d,]+\.\d+)/i },
  { title: 'Budget2003', fiscalYear: '2003', page: 41, oldCedi: true,
    rx: /total\s+payments\s+are\s+estimated\s+at\s+¢\s*([\d,]+\.\d+)\s*billion/i },
  { title: 'Budget2004', fiscalYear: '2004', page: 53, oldCedi: true,
    rx: /total\s+payments\s+are\s+estimated\s+at\s+¢\s*([\d,]+\.\d+)\s*billion/i },
  { title: 'Budget2005', fiscalYear: '2005', page: 66, oldCedi: true,
    rx: /total\s+payments\s+are\s+estimated\s+at\s+¢\s*([\d,]+\.\d+)\s*billion/i },
  { title: 'Budget2006', fiscalYear: '2006', page: 69, oldCedi: true,
    rx: /¢\s*([\d,]+\.\d+)\s*billion,?\s*is\s+programmed\s+for\s+total\s+payments\s+in\s+2006/i },
  { title: 'budget2007', fiscalYear: '2007', page: 88, oldCedi: true,
    rx: /¢\s*([\d,]+\.\d+)\s*billion\s+is\s+projected\s+for\s+total\s+payments\s+in\s+2007/i },
  { title: '2008_Budget', fiscalYear: '2008', page: 55, oldCedi: false,
    rx: /total\s+payments\s+for\s+2008\s+is\s+projected\s+at\s+GH¢\s*([\d,]+\.\d+)\s*million/i },
  { title: '2009_budget', fiscalYear: '2009', page: 58, oldCedi: false,
    rx: /total\s+payments\s+for\s+2009\s+is\s+projected\s+at\s+GH¢\s*([\d,]+\.\d+)\s*million/i },
]

async function main() {
  const facts: FinancialFact[] = []
  const documentIds: string[] = []

  for (const entry of ENTRIES) {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('id, file_path, tenant_id')
      .eq('title', entry.title)
      .single()
    if (error || !doc) {
      console.log(`${entry.title}: document not found, skipping`)
      continue
    }

    const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(doc.file_path)
    if (dlErr || !blob) {
      console.log(`${entry.title}: download failed (${dlErr?.message})`)
      continue
    }
    const buffer = Buffer.from(await blob.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    const page = await pdf.getPage(entry.page)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (content.items as any[]).map(it => it.str).join(' ').replace(/\s+/g, ' ')

    const m = entry.rx.exec(text)
    if (!m) {
      console.log(`${entry.title} p${entry.page}: regex did not match — skipping (no fact inserted)`)
      continue
    }

    const raw = parseFloat(m[1].replace(/,/g, ''))
    const valueMillions = entry.oldCedi ? raw / 10 : raw

    console.log(
      `${entry.title} p${entry.page}: matched "${m[0]}" -> ${raw} ${entry.oldCedi ? 'billion (old cedi)' : 'million (GH¢)'}` +
        ` -> GH¢${valueMillions} million`,
    )

    facts.push({
      tenant_id: doc.tenant_id,
      document_id: doc.id,
      chunk_id: null,
      fiscal_year: entry.fiscalYear,
      entity: 'National',
      entity_type: 'national',
      metric: 'total_budget',
      value: valueMillions,
      unit: 'million',
      value_millions: valueMillions,
      page_number: entry.page,
      section_title: 'Total Payments (Resource Allocation)',
      is_table: false,
      confidence: 90,
      flags: [],
      extraction_method: 'prose',
    })
    documentIds.push(doc.id)
  }

  console.log(`\nExtracted ${facts.length}/${ENTRIES.length} facts — running sanity checks...`)
  const checked = runSanityChecks(facts)
  for (const f of checked) {
    console.log(`  ${f.fiscal_year}: ${f.value_millions} (confidence=${f.confidence}, flags=${JSON.stringify(f.flags)})`)
  }

  console.log(`\nDeleting existing extraction_method='prose' facts for ${documentIds.length} document(s)...`)
  const { error: delError } = await supabase
    .from('financial_facts')
    .delete()
    .eq('extraction_method', 'prose')
    .in('document_id', documentIds)
  if (delError) throw delError

  const { error: insError } = await supabase.from('financial_facts').insert(checked)
  if (insError) throw insError

  console.log('\nDone.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
