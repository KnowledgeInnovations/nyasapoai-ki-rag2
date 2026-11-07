import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AlertTriangle, Database } from 'lucide-react'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import ModelPricesClient from '@/components/app/ModelPricesClient'
import UsageTables, { type TenantUsageRow, type ModelUsageRow, type PersonUsageRow } from '@/components/app/UsageTables'
import { getModelPrices } from '@/lib/usage'
import { builtinRate, RATES_AS_OF } from '@/lib/modelRates'

export const metadata: Metadata = { title: 'Model usage — Nyansa AI' }
export const dynamic = 'force-dynamic'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * How many usage rows a single view will read before it stops.
 *
 * Aggregation happens here rather than in SQL, which is fine at this volume
 * — a question writes a handful of rows — and will stop being fine. The cap
 * means the page degrades into "showing the most recent N" with a visible
 * warning rather than quietly timing out, and the fix when it bites is a
 * grouped view in Postgres, not a bigger number here.
 */
const ROW_CAP = 50_000

const WINDOWS = [7, 30, 90] as const

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')
  const actingTenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !actingTenant?.is_platform) redirect('/ask')

  const { days: daysParam } = await searchParams
  const days = WINDOWS.includes(Number(daysParam) as 7 | 30 | 90) ? Number(daysParam) : 30

  const service = svc()
  // eslint-disable-next-line react-hooks/purity -- Server Component, rendered once per request
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: rows, error: usageError }, { data: priceRows }, { data: tenantRows }] = await Promise.all([
    service
      .from('model_usage')
      .select('tenant_id, tenant_label, user_id, provider, model, operation, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP),
    service
      .from('model_prices')
      .select('model, provider, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok, confirmed_at')
      .order('provider')
      .order('model'),
    service.from('tenants').select('id, name, subdomain'),
  ])

  // Migration 049 not applied yet: say so plainly instead of rendering an
  // empty page that looks like "no usage".
  if (usageError) {
    return (
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="font-editorial text-2xl font-normal text-gray-900">Model usage</h1>
        </div>
        <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-5 py-4">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Usage recording is not set up yet.</p>
            <p className="mt-1 leading-relaxed">
              Apply migration <code className="bg-amber-100 px-1">049_model_usage.sql</code> to
              the database, then come back. Until it runs, token usage is not being
              recorded anywhere and this page has nothing to show.
            </p>
            <p className="mt-1.5 text-xs text-amber-800">Reported error: {usageError.message}</p>
          </div>
        </div>
      </div>
    )
  }

  type Row = {
    tenant_id: string | null
    tenant_label: string | null
    user_id: string | null
    provider: string
    model: string
    operation: string
    input_tokens: number
    output_tokens: number
    cache_write_tokens: number
    cache_read_tokens: number
    cost_usd: string | number | null
  }
  const usage = (rows ?? []) as Row[]
  const nameById = new Map((tenantRows ?? []).map(t => [t.id, t.name as string]))

  // Who spent it. A uuid in a cost report is useless to the person reading
  // it, so the ids present in this window are resolved to names in one
  // query rather than one per row.
  const userIds = [...new Set(usage.map(r => r.user_id).filter((v): v is string => !!v))]
  const personById = new Map<string, string>()
  if (userIds.length) {
    const { data: userRows } = await service
      .from('users')
      .select('id, name, email')
      .in('id', userIds)
    for (const u of userRows ?? []) personById.set(u.id, (u.name as string) || (u.email as string) || 'Unknown user')
  }

  /* ── aggregate ─────────────────────────────────────────── */
  let totalCost = 0
  let totalTokens = 0
  let unpricedCalls = 0
  const byTenant = new Map<string, TenantUsageRow>()
  const byModel = new Map<string, ModelUsageRow>()
  const byOperation = new Map<string, { calls: number; cost: number; priced: boolean }>()
  const byPerson = new Map<string, PersonUsageRow>()

  for (const r of usage) {
    const tokens = r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens
    const cost = r.cost_usd === null ? null : Number(r.cost_usd)
    totalTokens += tokens
    if (cost === null) unpricedCalls++
    else totalCost += cost

    // A deleted workspace keeps its spend, under the name it had at the time.
    const key = r.tenant_id ?? `label:${r.tenant_label ?? 'unattributed'}`
    const label = r.tenant_id
      ? (nameById.get(r.tenant_id) ?? r.tenant_label ?? 'Unknown workspace')
      : (r.tenant_label ? `${r.tenant_label} (deleted)` : 'Unattributed')
    const t = byTenant.get(key) ?? {
      key, label, deleted: !r.tenant_id,
      calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, unpriced: 0,
    }
    t.calls++
    t.inputTokens  += r.input_tokens
    t.outputTokens += r.output_tokens
    t.cachedTokens += r.cache_write_tokens + r.cache_read_tokens
    if (cost === null) t.unpriced++; else t.costUsd += cost
    byTenant.set(key, t)

    const m = byModel.get(r.model) ?? {
      model: r.model, provider: r.provider,
      calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, unpriced: 0,
    }
    m.calls++
    m.inputTokens  += r.input_tokens
    m.outputTokens += r.output_tokens
    m.cachedTokens += r.cache_write_tokens + r.cache_read_tokens
    if (cost === null) m.unpriced++; else m.costUsd += cost
    byModel.set(r.model, m)

    // Work with no user attached is not anonymous — it is work nobody
    // asked for: the nightly retry, a resumed extraction pass, a scheduled
    // job. Grouping it under one honest heading per workspace is more
    // useful than hiding it, because it is the spend no one is watching.
    const personKey = r.user_id ?? `auto:${r.tenant_id ?? 'none'}`
    const p = byPerson.get(personKey) ?? {
      key: personKey,
      label: r.user_id ? (personById.get(r.user_id) ?? 'Unknown user') : 'Background jobs',
      workspace: label,
      automated: !r.user_id,
      calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, unpriced: 0,
    }
    p.calls++
    p.inputTokens  += r.input_tokens
    p.outputTokens += r.output_tokens
    p.cachedTokens += r.cache_write_tokens + r.cache_read_tokens
    if (cost === null) p.unpriced++; else p.costUsd += cost
    byPerson.set(personKey, p)

    const o = byOperation.get(r.operation) ?? { calls: 0, cost: 0, priced: true }
    o.calls++
    if (cost === null) o.priced = false; else o.cost += cost
    byOperation.set(r.operation, o)
  }

  const tenants = [...byTenant.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
  const models  = [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
  const people  = [...byPerson.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
  const operations = [...byOperation.entries()]
    .map(([operation, v]) => ({ operation, ...v }))
    .sort((a, b) => b.cost - a.cost || b.calls - a.calls)

  // The effective rate card: published rates from code, overridden by any
  // stored rate. This is what actually priced the calls above.
  const effective = await getModelPrices(true)

  const prices = (priceRows ?? []).map(p => {
    const model = p.model as string
    const b = builtinRate(model)
    const eff = effective.get(model)
    return {
      model,
      provider: p.provider as string,
      // Only a deliberate override is pre-filled; the published rate shows
      // as a placeholder, so a blank field means "use the published rate".
      input:      p.input_usd_per_mtok === null ? null : Number(p.input_usd_per_mtok),
      output:     p.output_usd_per_mtok === null ? null : Number(p.output_usd_per_mtok),
      cacheWrite: p.cache_write_usd_per_mtok === null ? null : Number(p.cache_write_usd_per_mtok),
      cacheRead:  p.cache_read_usd_per_mtok === null ? null : Number(p.cache_read_usd_per_mtok),
      confirmedAt: (p.confirmed_at as string | null) ?? null,
      builtinInput:      b?.input ?? null,
      builtinOutput:     b?.output ?? null,
      builtinCacheWrite: b?.cacheWrite ?? null,
      builtinCacheRead:  b?.cacheRead ?? null,
      source: (eff?.source ?? 'builtin') as 'builtin' | 'override',
    }
  })

  // Models used in this window that the effective rate card cannot price at
  // all — neither a published rate in code nor a stored override. With
  // published rates shipped this should normally be empty, and when it is not
  // it means a new model reached production before its rate did.
  const unpricedUsedModels = models
    .filter(m => {
      const e = effective.get(m.model)
      return !e || e.inputUsdPerMTok === null
    })
    .map(m => m.model)
  const capped = usage.length >= ROW_CAP

  const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
  const fmtInt = (n: number) => n.toLocaleString('en-US')
  const compact = (n: number) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

  return (
    <div className="max-w-5xl space-y-6">
      {/* ── header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl font-normal text-gray-900">Model usage</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Token counts as reported by Anthropic and OpenAI on every call, grouped by
            workspace, priced automatically at the providers&apos; published rates
            (checked {RATES_AS_OF}). Each call keeps the cost it was priced at, so a
            later rate change affects future spend only and never rewrites a figure you
            have already read. Override a rate below only if you are charged something
            other than list price.
          </p>
        </div>
        <nav className="flex shrink-0 border border-gray-200">
          {WINDOWS.map(w => (
            <a
              key={w}
              href={`/admin/usage?days=${w}`}
              aria-current={w === days ? 'page' : undefined}
              className={
                'px-3.5 py-2 text-xs font-semibold transition ' +
                (w === days
                  ? 'bg-brand text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50')
              }
            >
              {w}d
            </a>
          ))}
        </nav>
      </div>

      {/* ── honesty banners ────────────────────────────── */}
      {unpricedUsedModels.length > 0 && (
        <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">
              Cost is incomplete: {unpricedUsedModels.length} model
              {unpricedUsedModels.length === 1 ? '' : 's'} used in this window have no rate set.
            </p>
            <p className="mt-1 leading-relaxed">
              {unpricedUsedModels.join(', ')} — their tokens are counted below but
              contribute nothing to the totals. This means a model reached production
              before its published rate was added to src/lib/modelRates.ts. Add it
              there, or set a rate in the rate card below.
            </p>
          </div>
        </div>
      )}

      {capped && (
        <p className="border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
          Showing the most recent {fmtInt(ROW_CAP)} calls in this window — there were more.
          Totals below are therefore a floor, not the whole window.
        </p>
      )}

      {/* ── the headline numbers ───────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: `Spend, last ${days} days`, value: fmtUsd(totalCost), hint: unpricedCalls ? `${fmtInt(unpricedCalls)} calls unpriced` : 'all calls priced' },
          { label: 'Tokens', value: compact(totalTokens), hint: `${fmtInt(totalTokens)} exactly` },
          { label: 'API calls', value: fmtInt(usage.length), hint: `${operations.length} kinds of work` },
          { label: 'Workspaces billed', value: fmtInt(tenants.filter(t => t.calls > 0).length), hint: `of ${fmtInt((tenantRows ?? []).length)} total` },
        ].map(k => (
          <div key={k.label} className="border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k.label}</p>
            <p className="mt-1.5 font-editorial text-2xl font-normal text-gray-900">{k.value}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{k.hint}</p>
          </div>
        ))}
      </section>

      <UsageTables
        tenants={tenants}
        people={people}
        models={models}
        operations={operations}
        totalCost={totalCost}
        days={days}
      />

      <ModelPricesClient initial={prices} />
    </div>
  )
}
