import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { runCrossDocumentCorroboration, supersedeForwardProjections, applyLearnedHeuristics, type FinancialFact } from './src/lib/factExtraction'
import { reExtractDocumentFacts } from './src/lib/reExtract'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}
process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const TENANT_ID = 'f1f12b56-b0bb-488b-b931-61431c1f8245'

async function main() {
  const { data: docs } = await svc.from('documents').select('id, title').eq('tenant_id', TENANT_ID).order('title')
  for (const d of docs ?? []) {
    if (d.title.startsWith('Test:')) continue
    console.log(`=== ${d.title} (${d.id}) ===`)
    const result = await reExtractDocumentFacts(svc, d.id, { aiDeadlineMs: 600_000 })
    if (result.skipped) {
      console.log(`  SKIP — ${result.reason}`)
      continue
    }
    console.log(`  ${result.factsAttempted} facts attempted, ${result.factsPersisted} verified persisted`)
    if (result.factsPersisted !== result.factsAttempted) console.error(`  MISMATCH: attempted ${result.factsAttempted}, persisted ${result.factsPersisted}`)
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

  console.log('\n=== learned heuristics (no-op unless a pattern is confirmed) ===')
  const { data: allFacts } = await svc.from('financial_facts').select('*').eq('tenant_id', TENANT_ID)
  const learned = await applyLearnedHeuristics(svc, TENANT_ID, (allFacts ?? []) as (FinancialFact & { id: string })[])
  for (const f of learned) {
    await svc.from('financial_facts').update({ flags: f.flags, confidence: f.confidence }).eq('id', f.id)
  }
  console.log(`demoted ${learned.length} rows via confirmed learned heuristics`)
  console.log('=== DONE ===')
}

main()
