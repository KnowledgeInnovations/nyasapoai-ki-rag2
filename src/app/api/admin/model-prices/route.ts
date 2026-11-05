import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { invalidatePriceCache } from '@/lib/usage'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/**
 * The model rate card — what Anthropic and OpenAI charge per million tokens.
 *
 * Platform admins only, and not public even for reading: unlike plan_prices,
 * which the marketing page shows to anyone, this is Nyansa AI's own cost base.
 *
 * Rates are stored but never applied retroactively. Each usage row keeps the
 * cost that was computed when the call happened, so correcting a rate today
 * cannot rewrite last month's reported spend — which is the behaviour anyone
 * reconciling against an invoice needs.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function requirePlatformAdmin() {
  const membership = await getMembership()
  if (!membership) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { membership, tenant }
}

export async function GET() {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return gate.error

  const { data, error } = await svc()
    .from('model_prices')
    .select('*')
    .order('provider')
    .order('model')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prices: data ?? [] })
}

/** A rate per million tokens: a non-negative number, or null to unset it. */
function rate(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  if (v === undefined) return undefined          // absent means "leave alone"
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

export async function PATCH(request: NextRequest) {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return gate.error
  const user = await getUser()

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { prices } = (body ?? {}) as { prices?: unknown }
  if (!Array.isArray(prices) || prices.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const service = svc()
  const updated: string[] = []

  for (const raw of prices) {
    const p = (raw ?? {}) as Record<string, unknown>
    const model = String(p.model ?? '').trim()
    if (!model) continue

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: user?.id ?? null }
    const map: [string, string][] = [
      ['input', 'input_usd_per_mtok'],
      ['output', 'output_usd_per_mtok'],
      ['cacheWrite', 'cache_write_usd_per_mtok'],
      ['cacheRead', 'cache_read_usd_per_mtok'],
    ]
    for (const [from, col] of map) {
      const v = rate(p[from])
      if (v !== undefined) patch[col] = v
    }
    // Setting a rate is the moment someone takes responsibility for it being
    // right, so that is when it counts as confirmed. Clearing both headline
    // rates drops the confirmation with them.
    if (p.confirmed === true) patch.confirmed_at = new Date().toISOString()
    if (p.confirmed === false) patch.confirmed_at = null

    const { error } = await service.from('model_prices').update(patch).eq('model', model)
    if (error) return NextResponse.json({ error: `Could not update ${model}: ${error.message}` }, { status: 500 })
    updated.push(model)
  }

  // The recorder caches the rate card for a few minutes; without this an edit
  // would appear on the page while new calls kept being priced at the old rate.
  invalidatePriceCache()

  if (updated.length) {
    await recordAudit({
      tenantId:     gate.tenant!.id,
      userId:       user?.id ?? null,
      action:       AUDIT_ACTIONS.MODEL_PRICES,
      resourceType: 'model_prices',
      metadata:     { models: updated },
    })
  }

  return NextResponse.json({ ok: true, updated })
}
