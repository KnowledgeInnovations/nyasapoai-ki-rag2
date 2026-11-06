/**
 * Golden questions, graded, timed, with the real money each one cost.
 *
 * golden_run.mts answers "was it right". That is necessary and it is not
 * sufficient for any change to a time budget, an iteration cap or a model:
 * on a set that already scores 4 of 4, correctness cannot move, so a change
 * that makes every answer three times slower for the same score looks
 * exactly like a change that did nothing. This measures the two things that
 * do move — wall-clock latency and spend — alongside the grade.
 *
 * Cost is read back from model_usage, the rows the pipeline itself writes,
 * so it is the same number /admin/usage shows rather than an estimate made
 * here.
 *
 * Two things it is strict about, both learned the hard way:
 *
 *   - It sends `agentic: true` when asked to. The chat route defaults that
 *     flag to false and the UI always sends true, so a harness that omits
 *     it measures a path no real user takes. golden_run.mts omits it.
 *   - It takes --base. `next dev` moves to 3001/3002 when the port is
 *     taken, and a harness that can only talk to 3000 is one you end up
 *     not running.
 *
 * Usage:
 *   npx tsx scripts/answer_cost_probe.mts --base http://localhost:3002 \
 *     --agentic --label before [--tenant knowledge]
 *
 * Needs a session cookie in test-session-cookie.txt for a user of that
 * workspace (get-test-session.js) and a running server. Every run spends
 * real money — roughly $0.08 per question on the agentic path at the time
 * of writing.
 *
 * One caveat on the cost figure: usage rows are written fire-and-forget,
 * so the settle wait below can miss the last row or two of a slow run. A
 * total that looks impossibly low means the rows had not landed yet, not
 * that the calls were free — check model_usage directly before believing
 * it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { gradeAnswer, type GoldenQuestion } from '../src/lib/goldenSet'

process.loadEnvFile(path.join(process.cwd(), '.env.local'))

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null }
const base = (flag('base') ?? 'http://localhost:3002').replace(/\/$/, '')
const label = flag('label') ?? 'run'
const subdomain = flag('tenant') ?? 'knowledge'
// The UI sends agentic:true; the chat route defaults it to false, so a
// harness that omits it measures a path no real user takes.
const agentic = args.includes('--agentic')

const { data: tenant } = await db.from('tenants').select('id, name').eq('subdomain', subdomain).single()
const { data: questions } = await db
  .from('golden_questions')
  .select('*')
  .eq('tenant_id', tenant!.id)
  .order('id')

const cookie = fs.readFileSync('test-session-cookie.txt', 'utf8').trim()
const startedAt = new Date().toISOString()

interface Row { q: string; ms: number; conf: number; cites: number; chars: number; ok: boolean; correct: boolean; why: string }
const rows: Row[] = []

for (const q of questions ?? []) {
  const t0 = Date.now()
  let conf = 0, cites = 0, answer = '', ok = false
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ query: q.question, newSession: true, agentic }),
    })
    if (!res.ok) throw new Error(`chat returned ${res.status}: ${(await res.text()).slice(0, 120)}`)
    const lines = (await res.text()).split('\n').filter(l => l.startsWith('data: '))
    const last = JSON.parse(lines[lines.length - 1].slice(6))
    answer = String(last.answer ?? '')
    conf = Number(last.confidence_score ?? 0)
    cites = (last.citations ?? []).length
    ok = answer.length > 0
  } catch (e) {
    answer = `FAILED: ${(e as Error).message}`
  }
  const ms = Date.now() - t0
  const graded = ok
    ? gradeAnswer(q as unknown as GoldenQuestion, answer, conf, cites)
    : { correct: false, reason: 'the request failed' }
  rows.push({ q: q.question, ms, conf, cites, chars: answer.length, ok, correct: graded.correct, why: graded.reason })
  console.log(`${graded.correct ? 'OK   ' : 'WRONG'} ${String(ms).padStart(6)}ms  ${String(conf).padStart(3)}%  ${String(cites).padStart(2)} cite  ${q.question.slice(0, 48).padEnd(50)} ${graded.reason}`)
}

// Settle: recordUsage is fire-and-forget, so the last rows may still be in
// flight when the final answer has already been streamed.
await new Promise(r => setTimeout(r, 8000))

const { data: usage } = await db
  .from('model_usage')
  .select('model, operation, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd')
  .eq('tenant_id', tenant!.id)
  .gte('created_at', startedAt)

let cost = 0, inTok = 0, outTok = 0, unpriced = 0
const byOp = new Map<string, { calls: number; cost: number }>()
for (const u of usage ?? []) {
  inTok += (u.input_tokens ?? 0) + (u.cache_read_tokens ?? 0) + (u.cache_write_tokens ?? 0)
  outTok += u.output_tokens ?? 0
  if (u.cost_usd === null) unpriced++
  else cost += Number(u.cost_usd)
  const e = byOp.get(u.operation) ?? { calls: 0, cost: 0 }
  e.calls++; e.cost += Number(u.cost_usd ?? 0)
  byOp.set(u.operation, e)
}

const times = rows.map(r => r.ms).sort((a, b) => a - b)
const median = times[Math.floor(times.length / 2)]
const n = rows.length

console.log('')
console.log(`======== ${label} · ${tenant!.name} · ${n} question(s) · ${agentic ? 'AGENTIC' : 'non-agentic'} ========`)
console.log(`correct             ${rows.filter(r => r.correct).length} of ${n}`)
console.log(`latency  median     ${median}ms`)
console.log(`         slowest    ${times[times.length - 1]}ms`)
console.log(`         mean       ${Math.round(times.reduce((a, b) => a + b, 0) / n)}ms`)
console.log(`model calls         ${(usage ?? []).length}  (${(((usage ?? []).length) / n).toFixed(1)} per question)`)
console.log(`tokens in/out       ${inTok.toLocaleString()} / ${outTok.toLocaleString()}`)
console.log(`cost total          $${cost.toFixed(5)}${unpriced ? `  (${unpriced} unpriced call(s))` : ''}`)
console.log(`cost per question   $${(cost / n).toFixed(5)}`)
console.log('by operation:')
for (const [op, e] of [...byOp.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(`  ${op.padEnd(10)} ${String(e.calls).padStart(3)} call(s)  $${e.cost.toFixed(5)}`)
}

fs.writeFileSync(
  path.join(process.env.TEMP ?? '.', `ws2_${label}.json`),
  JSON.stringify({ label, n, median, times, cost, inTok, outTok, calls: (usage ?? []).length, rows }, null, 1),
)
