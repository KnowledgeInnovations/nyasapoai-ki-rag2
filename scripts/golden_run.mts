/**
 * Asks a tenant's golden questions, grades the answers against the known
 * correct ones, and reports accuracy and confidence calibration.
 *
 * This is the measurement the pipeline did not have. The existing
 * regression suite scores an answer on confidence and citation presence and
 * stores no expected answer, so it cannot tell a right answer from a wrong
 * one — see ACCURACY_LOOP_PROMPT.md ground rule 1.
 *
 * Usage:
 *   npx tsx scripts/golden_run.mts --seed <tenant-subdomain>   # load the seed set
 *   npx tsx scripts/golden_run.mts --list <tenant-subdomain>
 *   npx tsx scripts/golden_run.mts <tenant-subdomain> [--repeat 2]
 *
 * Running needs a session cookie in test-session-cookie.txt for a user of
 * that tenant (get-test-session.js) and a server on localhost:3000.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { gradeAnswer, calibration, miscalibrated, type GoldenQuestion, type GradedAnswer } from '../src/lib/goldenSet'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : null
}
const seedFor = flag('seed')
const listFor = flag('list')
const subdomain = seedFor ?? listFor ?? args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--repeat')
const repeat = Number(flag('repeat') ?? 1)

if (!subdomain) {
  console.error('usage: tsx scripts/golden_run.mts <tenant-subdomain> [--repeat n] | --seed <sub> | --list <sub>')
  process.exit(1)
}

const { data: tenant } = await svc.from('tenants').select('id, name, subdomain').eq('subdomain', subdomain).maybeSingle()
if (!tenant) {
  console.error(`no tenant with subdomain "${subdomain}"`)
  process.exit(1)
}

if (seedFor) {
  const seedPath = path.join(import.meta.dirname, 'golden_seed.json')
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as {
    questions: {
      document: string | null
      source_page: number | null
      question: string
      expected_answer: string
      expected_kind: GoldenQuestion['expected_kind']
      expected_value: GoldenQuestion['expected_value']
      notes?: string
    }[]
  }

  const { data: docs } = await svc.from('documents').select('id, title').eq('tenant_id', tenant.id)
  let inserted = 0
  let skipped = 0
  for (const q of seed.questions) {
    const doc = q.document ? (docs ?? []).find(d => (d.title ?? '').includes(q.document!)) : null
    if (q.document && !doc) {
      console.log(`skipped (no document matching "${q.document}"): ${q.question}`)
      skipped++
      continue
    }
    // Keyed on the question text so re-seeding does not duplicate.
    const { data: existing } = await svc.from('golden_questions')
      .select('id').eq('tenant_id', tenant.id).eq('question', q.question).maybeSingle()
    if (existing) { skipped++; continue }
    const { error } = await svc.from('golden_questions').insert({
      tenant_id: tenant.id,
      document_id: doc?.id ?? null,
      source_page: q.source_page,
      question: q.question,
      expected_answer: q.expected_answer,
      expected_kind: q.expected_kind,
      expected_value: q.expected_value,
      verified_by: 'checked against the cited page of the source document',
      verified_at: new Date().toISOString(),
      notes: q.notes ?? null,
    })
    if (error) { console.error(`insert failed: ${error.message}`); skipped++ } else inserted++
  }
  console.log(`seeded ${tenant.name}: ${inserted} added, ${skipped} skipped`)
  process.exit(0)
}

// Confirmed questions only, matching what /api/golden-questions/run does.
// This script graded drafts too, and reported them as failures — which made
// its number meaningless, because a draft is a guess about what the right
// answer is. Drafts are counted and named instead.
const { data: questions, error: qError } = await svc
  .from('golden_questions')
  .select('id, question, expected_answer, expected_kind, expected_value, source_page, document_id, notes')
  .eq('tenant_id', tenant.id)
  .not('verified_at', 'is', null)
  .order('created_at')

const { count: draftCount } = await svc
  .from('golden_questions')
  .select('*', { count: 'exact', head: true })
  .eq('tenant_id', tenant.id)
  .is('verified_at', null)

if (qError) {
  console.error(`could not read the golden set: ${qError.message}`)
  console.error('If this says the table does not exist, migration 040 has not been applied.')
  process.exit(1)
}
if (draftCount) {
  console.log(`${draftCount} draft question(s) not counted — confirm them in the app first.`)
}
if (!questions?.length) {
  console.error(`no confirmed golden questions for ${tenant.name}. Seed them first: --seed ${subdomain}`)
  process.exit(1)
}

if (listFor) {
  for (const q of questions as GoldenQuestion[]) {
    console.log(`[${q.expected_kind}] ${q.question}\n    → ${q.expected_answer}${q.source_page ? ` (p${q.source_page})` : ''}`)
  }
  process.exit(0)
}

const cookie = fs.readFileSync('test-session-cookie.txt', 'utf8').trim()

async function ask(query: string): Promise<{ answer: string; confidence: number; citations: number }> {
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, newSession: true }),
  })
  if (!res.ok) throw new Error(`chat returned ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n').filter(l => l.startsWith('data: '))
  const last = JSON.parse(lines[lines.length - 1].slice(6))
  return {
    answer: String(last.answer ?? ''),
    confidence: Number(last.confidence_score ?? 0),
    citations: (last.citations ?? []).length,
  }
}

const allResults: GradedAnswer[][] = []

for (let round = 1; round <= repeat; round++) {
  const results: GradedAnswer[] = []
  if (repeat > 1) console.log(`\n──────── round ${round} of ${repeat} ────────`)
  for (const q of questions as GoldenQuestion[]) {
    let graded: GradedAnswer
    try {
      const { answer, confidence, citations } = await ask(q.question)
      graded = gradeAnswer(q, answer, confidence, citations)
    } catch (e) {
      graded = {
        id: q.id, question: q.question, correct: false,
        reason: `the request failed: ${(e as Error).message}`,
        confidence: 0, citations: 0, answer: '',
      }
    }
    results.push(graded)
    console.log(
      `${graded.correct ? 'OK  ' : 'WRONG'} ${String(graded.confidence).padStart(3)}%  ` +
      `${graded.citations} cite  ${q.question.slice(0, 62).padEnd(64)} ${graded.reason}`,
    )
  }
  allResults.push(results)
}

const flat = allResults.flat()
const correct = flat.filter(r => r.correct).length
console.log(`\n=== ${tenant.name}: ${correct}/${flat.length} correct (${Math.round((correct / flat.length) * 100)}%) over ${repeat} round(s) ===`)

console.log('\nCALIBRATION — was the confidence deserved?')
for (const band of calibration(flat)) {
  console.log(`  ${band.label.padEnd(16)} ${String(band.answers).padStart(3)} answer(s)  ` +
    (band.accuracy == null ? 'n/a' : `${band.accuracy}% correct`))
}

const { confidentlyWrong, needlesslyDoubted } = miscalibrated(flat)
if (confidentlyWrong.length) {
  console.log(`\nCONFIDENTLY WRONG (${confidentlyWrong.length}) — the damaging failure:`)
  for (const r of confidentlyWrong) console.log(`  ${r.confidence}%  ${r.question}\n      ${r.reason}`)
}
if (needlesslyDoubted.length) {
  console.log(`\nRIGHT BUT DOUBTED (${needlesslyDoubted.length}) — the same bug, other direction:`)
  for (const r of needlesslyDoubted) console.log(`  ${r.confidence}%  ${r.question}\n      ${r.reason}`)
}

// Stability, when asked for: the same question answered differently across
// rounds is a defect in its own right, separate from being wrong.
if (repeat > 1) {
  const unstable = (questions as GoldenQuestion[]).filter(q => {
    const verdicts = new Set(allResults.map(r => r.find(x => x.id === q.id)?.correct))
    return verdicts.size > 1
  })
  console.log(`\nUNSTABLE across rounds: ${unstable.length}`)
  for (const q of unstable) console.log(`  ${q.question}`)
}

process.exit(flat.some(r => !r.correct) ? 1 : 0)
