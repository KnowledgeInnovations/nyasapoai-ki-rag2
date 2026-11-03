import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizePlan, type Plan } from '@/lib/plans'

/**
 * Published prices, one per plan.
 *
 * A null amount is not zero and not an error — it means no price has been
 * published for that plan, and the page should say to get in touch. Showing
 * "GHS 0" instead would be the one answer that is actively wrong.
 */
export interface PlanPrice {
  plan: Plan
  amount: number | null
  currency: string
  period: 'month' | 'year'
  unit: string | null
}

export const PLAN_ORDER: Plan[] = ['starter', 'professional', 'enterprise']

// The pricing page is rendered on every visit, and before migration 046 has
// run every one of those would log the same failure. Worth saying, not worth
// saying hundreds of times — so it is said once per process and then kept
// quiet, which is enough to find it without burying everything else.
let warnedOnce = false

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Every plan, always all three, whatever the table holds. */
export async function getPlanPrices(): Promise<Record<Plan, PlanPrice>> {
  const blank = (plan: Plan): PlanPrice =>
    ({ plan, amount: null, currency: 'GHS', period: 'month', unit: null })

  const out: Record<Plan, PlanPrice> = {
    starter: blank('starter'),
    professional: blank('professional'),
    enterprise: blank('enterprise'),
  }

  try {
    const { data, error } = await svc()
      .from('plan_prices').select('plan, amount, currency, period, unit')
    // Tolerates migration 046 not having run: an unpriced page is a smaller
    // problem than a pricing page that fails to render.
    if (error) {
      if (!warnedOnce) {
        warnedOnce = true
        console.error(
          `[prices] could not read plan prices, showing "Talk to us" for every plan: ${error.message}`,
        )
      }
      return out
    }
    for (const row of data ?? []) {
      const plan = normalizePlan(row.plan)
      out[plan] = {
        plan,
        amount: row.amount === null ? null : Number(row.amount),
        currency: row.currency ?? 'GHS',
        period: (row.period === 'year' ? 'year' : 'month'),
        unit: row.unit ?? null,
      }
    }
  } catch (e) {
    if (!warnedOnce) {
      warnedOnce = true
      console.error('[prices] could not read plan prices:', (e as Error).message)
    }
  }
  return out
}

/**
 * "GHS 1,200" — the amount with its currency, grouped. Returns null when
 * there is no published price, so callers must decide what to say instead
 * rather than being handed a misleading string.
 */
export function formatPrice(price: PlanPrice): string | null {
  if (price.amount === null) return null
  const amount = price.amount % 1 === 0
    ? price.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : price.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${price.currency} ${amount}`
}

/** "per month", "a year" — the bit that follows the amount. */
export function periodLabel(price: PlanPrice): string {
  return price.period === 'year' ? 'per year' : 'per month'
}
