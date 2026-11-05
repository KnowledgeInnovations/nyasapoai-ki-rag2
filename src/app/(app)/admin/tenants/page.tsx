import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TenantsClient from '@/components/app/TenantsClient'
import { normalizeStatus } from '@/lib/workspaceStatus'
import PlanPricesClient from '@/components/app/PlanPricesClient'
import { getPlanPrices, PLAN_ORDER } from '@/lib/planPrices'

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

  // No real token-usage logging exists yet, so this is a model-based
  // estimate, not measured billing: average cost per chat turn and per
  // uploaded document, derived from typical Claude/OpenAI call sizes in the
  // chat and document-processing pipelines (embedding + rerank + AI
  // verification + 1-5 agentic Claude rounds per question; a Claude
  // table-cleaning pass per document with tables). Good enough for a budget
  // ballpark; swap for real per-call usage logging once that exists.
  const AVG_COST_PER_QUERY_USD = 0.10
  const AVG_COST_PER_DOCUMENT_USD = 0.20
  const USAGE_WINDOW_DAYS = 30
  // Server Component rendered once per request, not memoized/re-invoked
  // like a Client Component — the purity rule has no special case for this.
  // eslint-disable-next-line react-hooks/purity
  const cutoff = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: convRows }, { data: docRows }, { data: memberRows }] = await Promise.all([
    service.from('conversations').select('tenant_id, messages').gte('created_at', cutoff),
    service.from('documents').select('tenant_id').gte('created_at', cutoff),
    // Every membership on the platform, with the person behind it. One query
    // rather than one per tenant: there are tens of these, not thousands, and
    // a request per row would make the page slower than the data warrants.
    service.from('memberships').select('tenant_id, role, users(id, email, name)'),
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
      estimatedMonthlyCostUsd: queryCount30d * AVG_COST_PER_QUERY_USD + documentCount30d * AVG_COST_PER_DOCUMENT_USD,
    }
  })

  const prices = await getPlanPrices()

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

      <PlanPricesClient initial={PLAN_ORDER.map(p => prices[p])} />

      <TenantsClient tenants={tenantRows} />
    </div>
  )
}
