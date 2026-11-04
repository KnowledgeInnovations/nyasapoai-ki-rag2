/**
 * Outbound transactional email. Used directly for the 2FA code email, and by
 * src/app/api/auth/send-email-hook — Supabase's auth emails (magic link,
 * invite, password reset) are intercepted by that hook and sent through here
 * too, so everything leaves by one route.
 *
 * Two ways out, chosen by which configuration is present:
 *
 *   RESEND_API_KEY set  → Resend's HTTP API. Preferred.
 *   otherwise           → Microsoft 365 SMTP, as before.
 *
 * The switch is a credential, not a deploy. Add the key and the next email
 * goes over HTTP; remove it and it falls straight back to SMTP. That matters
 * for a change to the one path that carries invites and password resets: it
 * can be undone from a dashboard in the minute somebody notices, without a
 * build.
 *
 * Why move at all: SMTP client submission counts simultaneous connections
 * per mailbox and refuses past a handful with "432 Concurrent connections
 * limit exceeded". Supabase calls the hook once per email, so twenty invites
 * are twenty connections — measured here as one lost outright and a 52
 * second tail. Connection pooling only bounds that inside one process, which
 * a serverless deployment does not have. An HTTP API has no connections to
 * run out of, so the limit simply stops existing.
 */

import nodemailer from 'nodemailer'

let cachedTransporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter
  const port = Number(process.env.SMTP_PORT ?? 465)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // Microsoft 365 client submission allows only a handful of simultaneous
    // connections per mailbox, and answers the rest with
    // "432 4.3.2 Concurrent connections limit exceeded". Measured: twenty
    // sends fired at once lost one outright and took a median of 25 seconds
    // each, the slowest 52. Pooling keeps one instance to two connections
    // and paces them.
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    rateDelta: 1000,
    rateLimit: 4,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  })
  cachedTransporter = transporter
  return transporter
}

/**
 * Errors worth trying again. A concurrency or throttling refusal means "not
 * now", not "never" — the message is fine and the mailbox is fine, there was
 * simply no free connection. Treating that as a permanent failure is how an
 * invite disappears.
 */
function isTransient(e: unknown): boolean {
  const err = e as { responseCode?: number; code?: string; message?: string; isHttp?: boolean }
  const code = Number(err?.responseCode)

  if (err?.isHttp) {
    // Only 429 and 5xx are worth repeating. A 400 or 422 from Resend is a
    // rejected address or an unverified sending domain: it will fail the
    // same way every time, and retrying only delays the error.
    return code === 429 || (code >= 500 && code < 600)
  }

  // SMTP, where a 4xx reply is by definition "try again later".
  if (code >= 400 && code < 500) return true
  const sys = String(err?.code ?? '')
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EENVELOPE'].includes(sys)) return true
  return /concurrent connections|too many|throttl|try again/i.test(String(err?.message ?? ''))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ── Resend ───────────────────────────────────────────────────
 * Called over plain fetch rather than through the SDK: one POST with a
 * bearer token is not worth a dependency, and a dependency in the auth-email
 * path is a dependency that can break sign-in.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface ResendError extends Error {
  responseCode?: number
  /**
   * Marks this as an HTTP status rather than an SMTP reply code. The two
   * share the 4xx range and mean opposite things there: an SMTP 4xx is
   * explicitly "try again later", while an HTTP 422 is "this will never
   * work". Without the flag the SMTP rule swallows the HTTP case and a
   * rejected address gets retried four times before failing anyway.
   */
  isHttp?: true
}

async function sendViaResend(opts: SendEmailOptions): Promise<string> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
    // A hung send must not hold a serverless function open to its limit.
    signal: AbortSignal.timeout(15_000),
  })

  const body = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string }

  if (!res.ok) {
    const err = new Error(body.message ?? `Resend returned ${res.status}`) as ResendError
    // 429 is rate limiting and 5xx is their side having a moment: both mean
    // "not now". Anything else — a rejected address, an unverified sending
    // domain — will fail identically however many times it is retried.
    err.responseCode = res.status
    err.isHttp = true
    throw err
  }

  return body.id ?? '(no id)'
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

/** How many goes a message gets before it is declared lost. */
const MAX_ATTEMPTS = 4

/** Which way out is configured. Resend wins when both are. */
export function emailTransport(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.SMTP_HOST) return 'smtp'
  return 'none'
}

export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailOptions): Promise<void> {
  const recipient = Array.isArray(to) ? to.join(', ') : to

  const transport = emailTransport()
  if (transport === 'none') {
    // Say so rather than throwing something that reads like a network fault.
    const err = new Error('No email transport is configured (set RESEND_API_KEY, or the SMTP_* variables).')
    console.error(`[email] cannot send "${subject}" to ${recipient}: ${err.message}`)
    throw err
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const id = transport === 'resend'
        ? await sendViaResend({ to, subject, html, text, replyTo })
        : (await getTransporter().sendMail({
            from: process.env.EMAIL_FROM,
            to,
            subject,
            html,
            text,
            replyTo,
          })).messageId

      console.log(
        `[email] sent "${subject}" to ${recipient} via ${transport} — id: ${id}` +
        (attempt > 1 ? ` (attempt ${attempt})` : ''),
      )
      return
    } catch (e) {
      const last = attempt === MAX_ATTEMPTS
      if (last || !isTransient(e)) {
        console.error(
          `[email] FAILED to send "${subject}" to ${recipient} after ${attempt} attempt(s): ${(e as Error).message}`,
        )
        throw e
      }
      // Backoff with jitter. Every invite in a batch is its own invocation
      // racing for the same few connections, so they must not all come back
      // at the same moment — without the jitter they would collide again.
      const wait = Math.round((2 ** (attempt - 1)) * 1500 * (0.5 + Math.random()))
      console.warn(
        `[email] "${subject}" to ${recipient} deferred (${(e as Error).message.slice(0, 60)}); ` +
        `retrying in ${wait}ms, attempt ${attempt + 1} of ${MAX_ATTEMPTS}`,
      )
      await sleep(wait)
    }
  }
}
