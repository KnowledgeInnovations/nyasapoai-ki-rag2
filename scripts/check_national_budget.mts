import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.loadEnvFile(path.join(ROOT, '.env.local'))

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await supabase
  .from('financial_facts')
  .select('fiscal_year, value_millions, confidence, flags, document_id')
  .eq('entity_type', 'national')
  .eq('metric', 'total_budget')
  .gte('confidence', 70)
  .order('fiscal_year')

if (error) throw error

const byYear = new Map<string, { value_millions: number; confidence: number; flags: string[] }[]>()
for (const r of data ?? []) {
  if (!r.fiscal_year || !/^(19|20)\d{2}$/.test(r.fiscal_year)) continue
  if (!byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, [])
  byYear.get(r.fiscal_year)!.push(r)
}

for (let y = 1999; y <= 2026; y++) {
  const rows = byYear.get(String(y)) ?? []
  const validated = rows.filter(r => r.flags.length === 0)
  if (validated.length) {
    console.log(`${y}: ${validated.map(r => r.value_millions).join(', ')}`)
  } else if (rows.length) {
    console.log(`${y}: (only flagged) ${rows.map(r => `${r.value_millions} [${r.flags.join(',')}]`).join(', ')}`)
  } else {
    console.log(`${y}: NO DATA`)
  }
}
