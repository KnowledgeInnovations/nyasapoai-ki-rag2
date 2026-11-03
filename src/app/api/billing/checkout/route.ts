import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/roles'
import { normalizePlan, PLANS } from '@/lib/plans'
import { getPlanPrices } from '@/lib/planPrices'
import { paystackConfig, initializeTransaction, paymentReference } from '@/lib/paystack'

/**
 * Starts a payment for a plan.
 *
 * This route grants nothing. It records an attempt and hands back a Paystack
 * URL; the workspace only becomes paid when the webhook arrives, its
 * signature verifies, and the transaction re-verifies against Paystack. A
 * customer who completes checkout and closes the tab still gets what they
 * paid for, because the webhook is what counts — and a customer who forges a
 * return to the callback URL gets nothing.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (normalizeRole(membership.role) !== 'senior') {
    return NextResponse.json({ error: 'Paying for the workspace is available to Senior users.' }, { status: 403 })
  }

  const cfg = paystackConfig()
  if (!cfg) {
    // Configured or not, never pretend. A workspace that cannot pay must be
    // told so, not quietly granted access.
    return NextResponse.json({
      error: 'Online payment is not set up yet. Please get in touch and we will arrange it.',
    }, { status: 503 })
  }

  const tenant = await getTenant(membership.tenant_id)
  if (!tenant || tenant.is_platform) {
    return NextResponse.json({ error: 'This workspace cannot be billed.' }, { status: 400 })
  }

  let body: unknown
  try { body = await request.json() } catch { body = {} }
  const { plan: rawPlan } = (body ?? {}) as { plan?: string }

  // Default to what they are already on: the common case is renewing.
  const plan = rawPlan ? normalizePlan(rawPlan) : normalizePlan(tenant.plan)
  if (rawPlan && plan !== String(rawPlan).trim().toLowerCase()) {
    return NextResponse.json({ error: `Unknown plan "${rawPlan}".` }, { status: 400 })
  }

  const prices = await getPlanPrices()
  const price = prices[plan]
  if (price.amount === null || price.amount <= 0) {
    // No published price is a deliberate state (see migration 046). Such a
    // plan is not something to take money for on a form.
    return NextResponse.json({
      error: `${PLANS[plan].label} has no published price. Get in touch and we will arrange it with you.`,
      contact: '/contact?plan=enterprise',
    }, { status: 400 })
  }

  const user = await getUser()
  const email = user?.email
  if (!email) return NextResponse.json({ error: 'No email on your account.' }, { status: 400 })

  // Paystack counts in the smallest unit — pesewas for GHS. Rounded here,
  // once, so a fractional price cannot become a fractional pesewa.
  const amountMinor = Math.round(price.amount * 100)
  const reference = paymentReference(tenant.id)
  const service = svc()

  // The attempt is recorded before Paystack is called, so a payment that
  // succeeds while our response is lost still has a row the webhook can
  // find.
  const { error: insertError } = await service.from('payments').insert({
    tenant_id: tenant.id,
    reference,
    plan,
    amount_minor: amountMinor,
    currency: price.currency,
    period: price.period,
    status: 'pending',
    initiated_by: user?.id ?? null,
  })
  if (insertError) {
    console.error('[billing] could not record the attempt:', insertError.message)
    return NextResponse.json({ error: 'Could not start the payment.' }, { status: 500 })
  }

  const origin = request.nextUrl.origin
  const result = await initializeTransaction({
    email,
    amountMinor,
    currency: price.currency,
    reference,
    callbackUrl: `${origin}/settings/workspace?payment=${encodeURIComponent(reference)}`,
    metadata: {
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      plan,
      period: price.period,
    },
  })

  if (!result.ok) {
    await service.from('payments')
      .update({ status: 'failed', provider_response: { error: result.error } })
      .eq('reference', reference)
    console.error('[billing] initialize failed:', result.error)
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 })
  }

  console.log(
    `[billing] ${tenant.name}: started ${price.currency} ${price.amount} for ${plan}/${price.period}` +
    `${cfg.secretKey.startsWith('sk_test_') ? ' (TEST MODE)' : ''} ref=${reference}`,
  )

  return NextResponse.json({
    authorizationUrl: result.data.authorization_url,
    reference,
    amount: price.amount,
    currency: price.currency,
    period: price.period,
    plan,
  })
}
