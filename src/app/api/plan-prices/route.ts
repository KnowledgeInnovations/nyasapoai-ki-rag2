import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { normalizePlan } from '@/lib/plans'
import { getPlanPrices, PLAN_ORDER } from '@/lib/planPrices'

/**
 * The published price list.
 *
 * GET is public — a price list that needed a login would not be a price
 * list. PATCH is platform admins only: these are Nyansa AI's prices, not a
 * workspace's, so a customer Senior has no business setting them.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET() {
  const prices = await getPlanPrices()
  return NextResponse.json({ prices: PLAN_ORDER.map(p => prices[p]) })
}

export async function PATCH(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { prices } = (body ?? {}) as { prices?: unknown }
  if (!Array.isArray(prices) || prices.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const userId = (await getUser())?.id ?? null
  const service = svc()

  for (const raw of prices) {
    const row = (raw ?? {}) as Record<string, unknown>
    const plan = normalizePlan(typeof row.plan === 'string' ? row.plan : null)
    if (plan !== String(row.plan ?? '').trim().toLowerCase()) {
      return NextResponse.json({ error: `Unknown plan "${row.plan}".` }, { status: 400 })
    }

    // Empty means "no published price", which is a real choice and not the
    // same as zero. Only an actual number becomes an amount.
    let amount: number | null = null
    if (row.amount !== null && row.amount !== undefined && String(row.amount).trim() !== '') {
      const n = Number(row.amount)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `"${row.amount}" is not a valid price.` }, { status: 400 })
      }
      amount = Math.round(n * 100) / 100
    }

    const currency = String(row.currency ?? 'GHS').trim().toUpperCase().slice(0, 8) || 'GHS'
    const period = row.period === 'year' ? 'year' : 'month'
    const unit = typeof row.unit === 'string' && row.unit.trim()
      ? row.unit.trim().slice(0, 60)
      : null

    const { error } = await service
      .from('plan_prices')
      .upsert({ plan, amount, currency, period, unit, updated_at: new Date().toISOString(), updated_by: userId },
              { onConflict: 'plan' })

    if (error) {
      console.error('[prices] update failed:', error.message)
      return NextResponse.json({ error: 'Could not save the prices.' }, { status: 500 })
    }
    console.log(`[prices] ${plan}: ${amount === null ? 'unpublished' : `${currency} ${amount}/${period}`}`)
  }

  const updated = await getPlanPrices()
  return NextResponse.json({ prices: PLAN_ORDER.map(p => updated[p]) })
}
