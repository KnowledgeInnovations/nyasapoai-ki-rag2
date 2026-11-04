/**
 * Outbound transactional email via Outlook/Microsoft 365 SMTP. Used directly
 * for the 2FA code email, and also by src/app/api/auth/send-email-hook —
 * Supabase's auth emails (magic link, invite, password reset, etc.) are
 * intercepted by that hook and sent through here too, instead of Supabase's
 * own mailer, so everything goes out through the same relay.
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
  const err = e as { responseCode?: number; code?: string; message?: string }
  const code = Number(err?.responseCode)
  if (code >= 400 && code < 500) return true            // 4xx: try later
  const sys = String(err?.code ?? '')
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EENVELOPE'].includes(sys)) return true
  return /concurrent connections|too many|throttl|try again/i.test(String(err?.message ?? ''))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

/** How many goes a message gets before it is declared lost. */
const MAX_ATTEMPTS = 4

export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailOptions): Promise<void> {
  const recipient = Array.isArray(to) ? to.join(', ') : to

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await getTransporter().sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
        text,
        replyTo,
      })
      console.log(
        `[email] sent "${subject}" to ${recipient} — messageId: ${info.messageId}` +
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
