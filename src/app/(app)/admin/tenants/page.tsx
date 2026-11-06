import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TenantsClient from '@/components/app/TenantsClient'
import { normalizeStatus } from '@/lib/workspaceStatus'
import PlanPricesClient from '@/components/app/PlanPricesClient'
import { getPlanPrices, PLAN_ORDER } from '@/lib/planPrices'
import AiSwitchClient, { type AiSwitchState } from '@/components/app/AiSwitchClient'
import { getModelSwitches } from '@/lib/modelSwitch'

export const metadata: Metadata = { title: 'Tenants — Nyansa AI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function TenantsPage() {
  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')

  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) redirect('/ask')

  const service = svc()
  const { data: tenants } = await service
    .from('tenants')
    .select('id, name, subdomain, plan, status, created_at, is_platform, memberships(count)')
    .eq('is_platform', false)
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    name: string
    subdomain: string
    plan: string
    status: string | null
    created_at: string
    is_platform: boolean
    memberships: { count: number }[]
  }

  const rows = (tenants ?? []) as unknown as Row[]

  // Spend here is measured, not estimated: every model call records the
  // token counts the provider itself reported (migration 049, src/lib/usage.ts)
  // and the cost it was priced at. This replaced a flat per-question and
  // per-document assumption that could not be reconciled against an invoice.
  //
  // Two consequences worth knowing when reading these figures:
  //   - it only covers calls made since usage recording was deployed;
  //     earlier spend was never recorded and cannot be recovered.
  //   - a call whose model has no rate set contributes tokens but no cost,
  //     so an unpriced model makes this a floor. /admin/usage says so
  //     explicitly and is the place to set rates.
  const USAGE_WINDOW_DAYS = 30
  // Server Component rendered once per request, not memoized/re-invoked
  // like a Client Component — the purity rule has no special case for this.
  // eslint-disable-next-line react-hooks/purity
  const cutoff = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: convRows }, { data: docRows }, { data: memberRows }, { data: usageRows }] = await Promise.all([
    service.from('conversations').select('tenant_id, messages').gte('created_at', cutoff),
    service.from('documents').select('tenant_id').gte('created_at', cutoff),
    // Every membership on the platform, with the person behind it. One query
    // rather than one per tenant: there are tens of these, not thousands, and
    // a request per row would make the page slower than the data warrants.
    service.from('memberships').select('tenant_id, role, users(id, email, name)'),
    // Measured spend. Returns an empty list rather than an error before
    // migration 049 has run, so this page keeps working either way — the
    // column simply reads as no spend recorded.
    service.from('model_usage').select('tenant_id, cost_usd').gte('created_at', cutoff).limit(50_000),
  ])

  const queryCountByTenant = new Map<string, number>()
  for (const c of convRows ?? []) {
    const turns = Math.ceil((Array.isArray(c.messages) ? c.messages.length : 0) / 2)
    queryCountByTenant.set(c.tenant_id, (queryCountByTenant.get(c.tenant_id) ?? 0) + turns)
  }
  const docCountByTenant = new Map<string, number>()
  for (const d of docRows ?? []) {
    docCountByTenant.set(d.tenant_id, (docCountByTenant.get(d.tenant_id) ?? 0) + 1)
  }

  /* ── members per tenant ───────────────────────────────────
   * The embedded `users` relation comes back as an object for a to-one join,
   * but typing it as either shape costs nothing and means a change to the
   * foreign key cannot turn this into a runtime error.
   */
  type MemberJoin = {
    tenant_id: string
    role: string
    users: { id: string; email: string; name: string | null }
         | { id: string; email: string; name: string | null }[]
         | null
  }
  const ROLE_RANK: Record<string, number> = { senior: 0, middle: 1, junior: 2 }
  const membersByTenant = new Map<string, { id: string; email: string; name: string | null; role: string }[]>()
  for (const m of (memberRows ?? []) as unknown as MemberJoin[]) {
    const u = Array.isArray(m.users) ? m.users[0] : m.users
    // A membership whose user row is missing is skipped rather than rendered
    // as a blank line. The count beside the name comes from the database
    // aggregate, so such a row stays visible as a discrepancy instead of
    // disappearing silently.
    if (!u) continue
    const list = membersByTenant.get(m.tenant_id) ?? []
    list.push({ id: u.id, email: u.email, name: u.name, role: m.role })
    membersByTenant.set(m.tenant_id, list)
  }
  for (const list of membersByTenant.values()) {
    list.sort((a, b) =>
      (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) ||
      (a.name ?? a.email).localeCompare(b.name ?? b.email))
  }

  const spendByTenant = new Map<string, { costUsd: number; calls: number; unpriced: number }>()
  for (const u of (usageRows ?? []) as { tenant_id: string | null; cost_usd: string | number | null }[]) {
    if (!u.tenant_id) continue
    const e = spendByTenant.get(u.tenant_id) ?? { costUsd: 0, calls: 0, unpriced: 0 }
    e.calls++
    if (u.cost_usd === null) e.unpriced++
    else e.costUsd += Number(u.cost_usd)
    spendByTenant.set(u.tenant_id, e)
  }
  const usageRecorded = (usageRows ?? []).length > 0

  const tenantRows = rows.map(t => {
    const queryCount30d = queryCountByTenant.get(t.id) ?? 0
    const documentCount30d = docCountByTenant.get(t.id) ?? 0
    return {
      id: t.id,
      name: t.name,
      subdomain: t.subdomain,
      plan: t.plan,
      status: normalizeStatus(t.status),
      createdAt: t.created_at,
      memberCount: t.memberships?.[0]?.count ?? 0,
      members: membersByTenant.get(t.id) ?? [],
      isPlatform: t.is_platform,
      queryCount30d,
      documentCount30d,
      spendUsd30d:   spendByTenant.get(t.id)?.costUsd ?? 0,
      modelCalls30d: spendByTenant.get(t.id)?.calls ?? 0,
      unpricedCalls30d: spendByTenant.get(t.id)?.unpriced ?? 0,
    }
  })

  const prices = await getPlanPrices()

  // The AI switches, with whatever reason was recorded when they last
  // changed. Read fresh (force) rather than from the five-second cache: on
  // the page whose job is to show the switch position, a stale reading is
  // the one thing that cannot be allowed.
  const switches = await getModelSwitches(true)
  const { data: switchRows } = await service
    .from('platform_settings')
    .select('key, note, updated_at, updated_by')
    .in('key', ['ai_training_enabled', 'ai_chat_enabled'])

  const settingRows = switchRows ?? []
  const rowFor = (k: string) => settingRows.find(r => r.key === k)
  const latest = settingRows
    .map(r => r.updated_at as string | null)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null

  // Name rather than uuid: "changed by 7f3a…" tells nobody anything.
  const changerId = settingRows.find(r => r.updated_at === latest)?.updated_by ?? null
  let changedBy: string | null = null
  if (changerId) {
    const { data: who } = await service.from('users').select('name, email').eq('id', changerId).maybeSingle()
    changedBy = who?.name ?? who?.email ?? null
  }

  const aiSwitch: AiSwitchState = {
    training:     switches.training,
    chat:         switches.chat,
    trainingNote: rowFor('ai_training_enabled')?.note ?? null,
    chatNote:     rowFor('ai_chat_enabled')?.note ?? null,
    changedAt:    latest,
    changedBy,
    known:        switches.known,
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-editorial text-2xl font-normal text-gray-900">Tenants</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every workspace on the Nyansa AI platform, with the plan it is on and
          whether it is open. Customers create their own; create one here when
          you are setting it up for them.
        </p>
      </div>

      <AiSwitchClient initial={aiSwitch} />

      <PlanPricesClient initial={PLAN_ORDER.map(p => prices[p])} />

      <TenantsClient tenants={tenantRows} usageRecorded={usageRecorded} windowDays={USAGE_WINDOW_DAYS} />
    </div>
  )
}
