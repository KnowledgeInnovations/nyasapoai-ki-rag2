import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

/**
 * The public contact form, including the Enterprise "Talk to us" route off
 * the pricing page.
 *
 * Before this existed the form had no handler, no named fields and no route:
 * pressing "Send message" reloaded the page, the fields cleared, and the
 * enquiry went nowhere while the page promised a reply within one business
 * day.
 *
 * Two things happen with every enquiry, in this order:
 *   1. the row is written, because that is the record;
 *   2. the email is sent after the response, because that is the notification
 *      and it is the part that can fail.
 *
 * Unauthenticated by design — it is a public form on a marketing page.
 */

// The notification goes to the workspace's own mailbox. Overridable so this
// does not need a deploy to redirect, but it has a working default.
const NOTIFY = process.env.CONTACT_NOTIFY_EMAIL || 'no-reply@nyansaai.com'

export const maxDuration = 20

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ))
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const {
    firstName, lastName, email, organisation, message, source, company,
  } = (body ?? {}) as Record<string, unknown>

  // Honeypot: a field hidden from people and irresistible to bots. Answered as
  // success so a bot has nothing to learn from the response, and nothing is
  // stored or sent.
  if (clean(company, 200)) {
    return NextResponse.json({ ok: true })
  }

  const cleaned = {
    first_name:   clean(firstName, 100),
    last_name:    clean(lastName, 100),
    email:        clean(email, 254).toLowerCase(),
    organisation: clean(organisation, 200),
    message:      clean(message, 5000),
    source:       clean(source, 60) || 'contact',
  }

  if (!cleaned.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email)) {
    return NextResponse.json({ error: 'Please enter a valid work email address.' }, { status: 400 })
  }
  if (!cleaned.message) {
    return NextResponse.json({ error: 'Please tell us a little about what you need.' }, { status: 400 })
  }

  // Stored first: this is the durable record, and it is what makes a failed
  // send recoverable. Tolerant of migration 044 not having been applied yet —
  // the enquiry must still reach the inbox in that case, so a failure here is
  // logged loudly and the send proceeds.
  let stored = false
  try {
    const { error } = await svc().from('contact_enquiries').insert(cleaned)
    if (error) {
      console.error('[contact] could not store the enquiry (continuing to email it):', error.message)
    } else {
      stored = true
    }
  } catch (e) {
    console.error('[contact] could not store the enquiry (continuing to email it):', (e as Error).message)
  }

  const name = [cleaned.first_name, cleaned.last_name].filter(Boolean).join(' ') || 'Someone'
  const who = cleaned.organisation ? `${name} (${cleaned.organisation})` : name
  const isEnterprise = cleaned.source === 'pricing_enterprise'
  const subject = isEnterprise
    ? `Enterprise enquiry — ${cleaned.organisation || name}`
    : `Website enquiry — ${cleaned.organisation || name}`

  const rows: [string, string][] = [
    ['Name', name],
    ['Email', cleaned.email],
    ['Organisation', cleaned.organisation || '—'],
    ['Came from', isEnterprise ? 'Pricing page — Enterprise plan' : 'Contact page'],
  ]

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#2029bd;padding:20px 24px;">
      <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Nyansa<span style="color:#14caf4;">&middot;</span>AI</span>
      <div style="margin-top:4px;font-size:12px;color:#c7cbf0;">${isEnterprise ? 'Enterprise enquiry' : 'Website enquiry'}</div>
    </td></tr>
    <tr><td style="padding:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;color:#334155;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:6px 0;color:#94a3b8;width:120px;">${k}</td>
          <td style="padding:6px 0;font-weight:600;">${escapeHtml(v)}</td>
        </tr>`).join('')}
      </table>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Message</div>
        <div style="font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHtml(cleaned.message)}</div>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
        Reply to this email to answer ${escapeHtml(cleaned.email)} directly.${stored ? '' : ' (Not saved to the database — see the server logs.)'}
      </p>
    </td></tr>
  </table>
</body></html>`

  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Message:',
    cleaned.message,
  ].join('\n')

  const notify = () => sendEmail({
    to: NOTIFY,
    subject,
    html,
    text,
    // The notification arrives in a mailbox called no-reply, so Reply would
    // otherwise go to ourselves. Pointing it at the enquirer makes replying
    // from the inbox do the obvious thing.
    replyTo: cleaned.email,
  })

  console.log(`[contact] ${isEnterprise ? 'enterprise' : 'website'} enquiry from ${who} <${cleaned.email}>, stored=${stored}`)

  if (!stored) {
    // The row did not get written, so this email is now the only record of the
    // enquiry. That makes it worth waiting for and worth being honest about:
    // answering "received" when nothing was stored AND nothing was sent is the
    // very failure this endpoint exists to end. Measured at ~1.6s locally, and
    // only on this path.
    try {
      await notify()
    } catch {
      console.error(`[contact] LOST ENQUIRY from <${cleaned.email}> — neither stored nor emailed. Body: ${JSON.stringify(cleaned)}`)
      return NextResponse.json({
        error: 'We could not record your message just now. Please email us directly at hello@nyansaai.com and we will come straight back to you.',
      }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  }

  // The row is written, so the enquiry is safe. The notification can go after
  // the response, like every other send in this app: the relay needs several
  // seconds and the person should not wait on it.
  after(async () => {
    try {
      await notify()
    } catch {
      // Logged by sendEmail. Caught so the post-response task does not end in
      // an unhandled rejection; the enquiry is in contact_enquiries either way.
      console.error(`[contact] notification failed for <${cleaned.email}> — the enquiry is stored, so it is recoverable from contact_enquiries`)
    }
  })

  return NextResponse.json({ ok: true })
}
