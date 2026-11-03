import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyWebhookSignature, verifyTransaction, extendPaidUntil, paystackConfig } from '@/lib/paystack'
import { invalidateTenant } from '@/lib/supabase/server'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'
import { normalizePlan } from '@/lib/plans'

/**
 * Paystack's webhook. The only thing in this application that turns a
 * payment into access.
 *
 * Three checks, in this order, and none of them is optional:
 *
 *   1. The signature. HMAC-SHA512 of the RAW body with our secret key.
 *      Without this anyone who knows the URL can grant themselves a
 *      workspace.
 *   2. Paystack's own account of the transaction, fetched by us. A valid
 *      signature proves the message came from Paystack, not that its
 *      contents say what we assume; re-verifying costs one request and
 *      removes a whole class of mistake.
 *   3. The amount. A verified payment of 1 pesewa is still a verified
 *      payment, and must not buy a month of Professional.
 *
 * Paystack retries a webhook it believes failed, so this has to be safe to
 * run twice. The payments.reference unique constraint plus a status check
 * make a repeat a no-op rather than a second month.
 */

// Paystack expects a prompt 200; verification adds one round trip.
export const maxDuration = 25

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(request: NextRequest) {
  if (!paystackConfig()) {
    console.error('[billing] webhook arrived but Paystack is not configured')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // The raw text, not a parsed-and-reserialised object: re-encoding changes
  // bytes and the signature would never match.
  const raw = await request.text()
  if (!verifyWebhookSignature(raw, request.headers.get('x-paystack-signature'))) {
    console.error('[billing] REJECTED a webhook with a bad signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { event?: string; data?: { reference?: string } }
  try { event = JSON.parse(raw) } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Acknowledged so Paystack stops retrying; anything we do not act on is
  // simply not acted on.
  if (event.event !== 'charge.success') {
    return NextResponse.json({ received: true })
  }

  const reference = event.data?.reference
  if (!reference) return NextResponse.json({ received: true })

  const service = svc()
  const { data: payment } = await service
    .from('payments')
    .select('id, tenant_id, plan, amount_minor, currency, period, status')
    .eq('reference', reference)
    .maybeSingle()

  if (!payment) {
    // A real Paystack payment we have no record of. Not ours to apply, and
    // worth knowing about: it means somebody paid and we cannot say for what.
    console.error(`[billing] UNKNOWN REFERENCE on a verified webhook: ${reference}`)
    return NextResponse.json({ received: true })
  }

  if (payment.status === 'success') {
    // Already applied. Paystack retries; this is the retry.
    return NextResponse.json({ received: true, duplicate: true })
  }

  // Ask Paystack directly rather than believing the body.
  const verified = await verifyTransaction(reference)
  if (!verified.ok) {
    console.error(`[billing] could not verify ${reference}: ${verified.error}`)
    // 500 so Paystack retries — a transient failure here must not silently
    // lose someone's payment.
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }

  const tx = verified.data
  if (tx.status !== 'success') {
    await service.from('payments')
      .update({ status: 'failed', provider_response: tx as unknown as Record<string, unknown> })
      .eq('id', payment.id)
    return NextResponse.json({ received: true })
  }

  // What was actually paid, against what was asked for.
  if (tx.amount < payment.amount_minor || tx.currency !== payment.currency) {
    console.error(
      `[billing] UNDERPAID ${reference}: got ${tx.currency} ${tx.amount}, ` +
      `expected ${payment.currency} ${payment.amount_minor} — not granting access`,
    )
    await service.from('payments')
      .update({ status: 'failed', provider_response: tx as unknown as Record<string, unknown> })
      .eq('id', payment.id)
    return NextResponse.json({ received: true })
  }

  const { data: tenant } = await service
    .from('tenants').select('id, name, plan, status, paid_until').eq('id', payment.tenant_id).maybeSingle()
  if (!tenant) {
    console.error(`[billing] payment ${reference} is for a workspace that no longer exists`)
    return NextResponse.json({ received: true })
  }

  const period = payment.period === 'year' ? 'year' : 'month'
  const paidUntil = extendPaidUntil(tenant.paid_until ? new Date(tenant.paid_until) : null, period)

  // A card authorization can be charged again without the customer; mobile
  // money cannot, so only a reusable one is kept. Storing a MoMo
  // authorization would make renewal look automatic when it is not.
  const reusable = tx.authorization?.reusable === true && tx.authorization.authorization_code
    ? tx.authorization.authorization_code
    : null

  const { error: updateError } = await service
    .from('tenants')
    .update({
      plan: normalizePlan(payment.plan),
      status: 'active',
      paid_until: paidUntil.toISOString(),
      access_until: null,
      paystack_customer_code: tx.customer?.customer_code ?? null,
      ...(reusable ? { paystack_authorization_code: reusable } : {}),
      paystack_channel: tx.channel ?? null,
    })
    .eq('id', tenant.id)

  if (updateError) {
    console.error(`[billing] PAID BUT NOT APPLIED ${reference}: ${updateError.message}`)
    return NextResponse.json({ error: 'Could not apply payment' }, { status: 500 })
  }

  await service.from('payments').update({
    status: 'success',
    channel: tx.channel ?? null,
    paid_at: tx.paid_at ?? new Date().toISOString(),
    provider_response: tx as unknown as Record<string, unknown>,
  }).eq('id', payment.id)

  invalidateTenant(tenant.id)

  await recordAudit({
    tenantId: tenant.id,
    // Nobody is signed in on a webhook. Attributing it to a person would be
    // a guess; this genuinely was the system.
    userId: null,
    action: AUDIT_ACTIONS.WORKSPACE_STATUS,
    resourceType: 'workspace',
    resourceId: tenant.id,
    metadata: {
      from: tenant.status, to: 'active',
      by: 'payment',
      amount: `${tx.currency} ${(tx.amount / 100).toLocaleString()}`,
      channel: tx.channel,
      paid_until: paidUntil.toISOString(),
    },
  })

  console.log(
    `[billing] ${tenant.name}: paid ${tx.currency} ${tx.amount / 100} by ${tx.channel ?? 'unknown'}, ` +
    `${payment.plan} active until ${paidUntil.toISOString().slice(0, 10)}`,
  )

  return NextResponse.json({ received: true })
}
