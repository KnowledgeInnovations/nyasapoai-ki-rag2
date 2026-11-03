import crypto from 'node:crypto'

/**
 * Paystack, for collecting payment in Ghana.
 *
 * Two things about this integration are deliberate and worth knowing before
 * changing anything here.
 *
 * 1. Access is never granted from the browser. The customer's return from
 *    Paystack is a hint that something happened, nothing more — it is
 *    trivially forged. Only a webhook whose signature verifies, and whose
 *    transaction we then re-verify against Paystack ourselves, moves a
 *    workspace to paid.
 *
 * 2. Mobile money cannot recur. Paystack supports reusing a card
 *    authorization to charge again without the customer present; the Pay
 *    with Mobile Money channel has no equivalent. In Ghana most customers
 *    pay by MoMo, so billing here is driven by our own paid_until date and
 *    one-off charges, not by Paystack subscriptions. A card payer gets a
 *    smoother renewal because their authorization can be reused; a MoMo
 *    payer approves each one. The product behaves the same either way.
 */

const API = 'https://api.paystack.co'

export interface PaystackConfig {
  secretKey: string
  publicKey: string
}

/**
 * Null when Paystack is not configured. Every caller must handle that: an
 * unconfigured deployment should decline to take money, politely, rather
 * than crash or — far worse — behave as though payment succeeded.
 */
export function paystackConfig(): PaystackConfig | null {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY ?? ''
  if (!secretKey) return null
  return { secretKey, publicKey }
}

export function isLiveKey(secretKey: string): boolean {
  return secretKey.startsWith('sk_live_')
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const cfg = paystackConfig()
  if (!cfg) return { ok: false, error: 'Paystack is not configured.' }

  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      // A hung payment request must not hold a route open indefinitely.
      signal: AbortSignal.timeout(20_000),
    })
    const json = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: T }
    if (!res.ok || json.status === false) {
      return { ok: false, error: json.message ?? `Paystack returned ${res.status}` }
    }
    return { ok: true, data: json.data as T }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface InitializedTransaction {
  authorization_url: string
  access_code: string
  reference: string
}

/**
 * Starts a payment. `amountMinor` is in the currency's smallest unit —
 * pesewas for GHS — because that is how Paystack counts, and converting in
 * one place is how a factor of a hundred stays out of the ledger.
 */
export async function initializeTransaction(opts: {
  email: string
  amountMinor: number
  currency: string
  reference: string
  callbackUrl: string
  channels?: string[]
  metadata?: Record<string, unknown>
}) {
  return call<InitializedTransaction>('/transaction/initialize', {
    method: 'POST',
    body: {
      email: opts.email,
      amount: opts.amountMinor,
      currency: opts.currency,
      reference: opts.reference,
      callback_url: opts.callbackUrl,
      // Ghana: cards and mobile money. Listed explicitly so a new channel
      // appearing on the account does not silently change what we accept.
      channels: opts.channels ?? ['card', 'mobile_money', 'bank_transfer'],
      metadata: opts.metadata ?? {},
    },
  })
}

export interface VerifiedTransaction {
  status: string
  reference: string
  amount: number
  currency: string
  channel: string | null
  paid_at: string | null
  customer: { email: string; customer_code: string } | null
  authorization: {
    authorization_code: string | null
    reusable: boolean
    channel: string | null
    last4: string | null
    brand: string | null
  } | null
  metadata: Record<string, unknown> | null
}

/**
 * Asks Paystack what actually happened. This is the only statement about a
 * payment that is trusted — not the webhook body, and certainly not the
 * browser.
 */
export async function verifyTransaction(reference: string) {
  return call<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
}

/** Charges a saved card again. Cards only — mobile money has no equivalent. */
export async function chargeAuthorization(opts: {
  email: string
  amountMinor: number
  currency: string
  authorizationCode: string
  reference: string
  metadata?: Record<string, unknown>
}) {
  return call<VerifiedTransaction>('/transaction/charge_authorization', {
    method: 'POST',
    body: {
      email: opts.email,
      amount: opts.amountMinor,
      currency: opts.currency,
      authorization_code: opts.authorizationCode,
      reference: opts.reference,
      metadata: opts.metadata ?? {},
    },
  })
}

/**
 * Is this webhook really from Paystack?
 *
 * HMAC-SHA512 of the raw body with the secret key, compared in constant
 * time. The raw body, not a re-serialised object: re-encoding changes bytes
 * and the signature would never match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const cfg = paystackConfig()
  if (!cfg || !signature) return false
  const expected = crypto.createHmac('sha512', cfg.secretKey).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** A reference that is unique, and readable in a dispute. */
export function paymentReference(tenantId: string): string {
  return `nyansa_${tenantId.slice(0, 8)}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

/** Where paid_until moves to when a payment for `period` succeeds. */
export function extendPaidUntil(current: Date | null, period: 'month' | 'year', now = new Date()): Date {
  // Renewing early should add to what is left, not throw it away. Renewing
  // after expiry starts from today rather than stacking dead time.
  const base = current && current > now ? new Date(current) : new Date(now)
  if (period === 'year') base.setFullYear(base.getFullYear() + 1)
  else base.setMonth(base.getMonth() + 1)
  return base
}
