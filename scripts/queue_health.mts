/**
 * What work the platform has promised and not finished.
 *
 * Fact extraction is time-boxed: a pass gets as far as it gets, records how
 * many excerpts remain, and the nightly job is supposed to finish the rest.
 * Nothing checked that it did. Five documents sat with queued excerpts for
 * two and a half days, four of them never touched, and the only visible
 * symptom was a badge nobody could interpret — the owner's question was
 * "what does ready warnings mean?", and the honest answer needed a database
 * query.
 *
 * So: one command that answers "is anything stuck, and for how long".
 * Read-only.
 *
 *   npx tsx scripts/queue_health.mts
 *   npx tsx scripts/queue_health.mts --verbose   (per-excerpt detail)
 *
 * Exits non-zero when anything has been outstanding beyond STALE_HOURS, so
 * it can be wired into a check that fails rather than a report nobody runs.
 */
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile(path.join(process.cwd(), '.env.local'))

const verbose = process.argv.includes('--verbose')

/** Beyond this, "it continues automatically" has stopped being true. */
const STALE_HOURS = 24

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: tenants } = await db.from('tenants').select('id, name')
const tenantName = new Map((tenants ?? []).map(t => [t.id, t.name]))

const { data: docs, error } = await db
  .from('documents')
  .select('id, title, tenant_id, status, status_detail, created_at, auto_reprocess_count, last_auto_reprocess_at')
  .in('status', ['ready', 'processing'])

if (error) {
  console.error('could not read documents:', error.message)
  process.exit(2)
}

interface Stuck {
  title: string
  tenant: string
  pending: number
  total: number
  ageHours: number
  attempts: number
  lastTouch: string
}

const stuck: Stuck[] = []
let processingForever = 0

for (const d of docs ?? []) {
  // A document left in 'processing' has no resumer at all — nothing picks
  // these up, so it is stuck by definition however long it has been.
  if (d.status === 'processing') {
    const ageHours = (Date.now() - new Date(d.created_at).getTime()) / 3_600_000
    if (ageHours > 1) {
      processingForever++
      console.log(`STILL PROCESSING  ${tenantName.get(d.tenant_id) ?? '?'} / ${d.title} — ${ageHours.toFixed(1)}h`)
    }
    continue
  }

  if (!/still queued/i.test(d.status_detail ?? '')) continue

  const { count: pending } = await db
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', d.id)
    .is('facts_extracted_at', null)
  const { count: total } = await db
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', d.id)

  stuck.push({
    title: d.title,
    tenant: tenantName.get(d.tenant_id) ?? '?',
    pending: pending ?? 0,
    total: total ?? 0,
    ageHours: (Date.now() - new Date(d.created_at).getTime()) / 3_600_000,
    attempts: d.auto_reprocess_count ?? 0,
    lastTouch: d.last_auto_reprocess_at ?? 'never',
  })
}

stuck.sort((a, b) => b.ageHours - a.ageHours)

if (!stuck.length && !processingForever) {
  console.log('Nothing outstanding. Every ready document has been fully read.')
  process.exit(0)
}

console.log(`${stuck.length} document(s) with excerpts still queued:`)
console.log('')
for (const s of stuck) {
  const done = s.total - s.pending
  const pct = s.total ? Math.round((done / s.total) * 100) : 0
  console.log(
    `  ${s.tenant.slice(0, 20).padEnd(21)} ${s.title.slice(0, 30).padEnd(31)} ` +
    `${String(done).padStart(4)}/${String(s.total).padEnd(4)} read (${String(pct).padStart(3)}%)  ` +
    `age ${s.ageHours.toFixed(0).padStart(4)}h  attempts ${s.attempts}  last ${s.lastTouch === 'never' ? 'never' : s.lastTouch.slice(0, 16)}`,
  )
  if (verbose) console.log(`      ${s.pending} excerpt(s) still to read`)
}

const stale = stuck.filter(s => s.ageHours > STALE_HOURS)
console.log('')
if (stale.length) {
  console.log(`${stale.length} of them outstanding for more than ${STALE_HOURS}h — "it continues automatically" is not true for these.`)
  process.exit(1)
}
console.log(`None outstanding beyond ${STALE_HOURS}h.`)
