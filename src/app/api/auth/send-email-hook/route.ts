import { NextResponse, after } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendEmail } from '@/lib/email'
import { buildAuthEmail } from '@/lib/authEmailTemplates'

// Supabase's "Send Email" Auth Hook: every auth email (signup, magic link,
// password reset, invite, email change, reauthentication, and the security
// notification emails) gets POSTed here instead of being sent by Supabase's
// own mailer, so all of them go out through the same Microsoft 365 relay
// (sendEmail()) that already reliably lands the 2FA code email in inbox.
//
// Payload is signed per the Standard Webhooks spec — verify before trusting
// anything in it. SEND_EMAIL_HOOK_SECRET must match hook_send_email_secrets
// configured on the Supabase project (the `whsec_...` part, no `v1,` prefix).

// after() runs inside the route's max duration, so leave the post-response
// SMTP send room to finish rather than being cut off at the platform default.
export const maxDuration = 30

interface HookUser {
  email: string
  new_email?: string
}

interface HookEmailData {
  token?: string
  token_hash?: string
  redirect_to?: string
  email_action_type: string
  site_url?: string
  token_new?: string
  token_hash_new?: string
}

interface HookPayload {
  user: HookUser
  email_data: HookEmailData
}

function verifyTypeFor(actionType: string): string {
  return actionType.startsWith('email_change') ? 'email_change' : actionType
}

export async function POST(req: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET
  if (!secret) {
    console.error('[send-email-hook] SEND_EMAIL_HOOK_SECRET is not set')
    return NextResponse.json({ error: 'Hook not configured' }, { status: 500 })
  }

  const body = await req.text()
  // Supabase displays/stores hook secrets as "v1,whsec_..." (Svix-style
  // versioned-secret format) but the standardwebhooks library only strips
  // the "whsec_" prefix itself — strip the version prefix here too.
  const wh = new Webhook(secret.replace(/^v\d+,/, ''))
  let payload: HookPayload
  try {
    payload = wh.verify(body, {
      'webhook-id': req.headers.get('webhook-id') ?? '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': req.headers.get('webhook-signature') ?? '',
    }) as HookPayload
  } catch (e) {
    console.error('[send-email-hook] signature verification failed:', (e as Error).message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { user, email_data } = payload
  const actionType = email_data.email_action_type

  // Link to our own interstitial rather than straight to Supabase's one-time
  // verify endpoint. Corporate mail scanners (Microsoft Defender Safe Links
  // and friends) fetch every URL in an incoming message; against the verify
  // endpoint that fetch consumes the token, confirms the address and creates a
  // session, so the real recipient's click later fails as an expired link.
  // Measured on the Devtraco tenant: invitees confirmed and signed in 20-51
  // seconds after the invite was created, before any of them opened the app.
  //
  // The interstitial renders harmlessly for a scanner and redeems the token
  // only on a real click. See src/app/auth/accept-invite/page.tsx.
  // Host the interstitial on the same origin the link ultimately lands on —
  // redirect_to already carries the tenant's own subdomain, so the invitee
  // stays on their workspace's host the whole way through.
  let appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  try {
    if (email_data.redirect_to) appOrigin = new URL(email_data.redirect_to).origin
  } catch {
    // redirect_to absent or malformed — fall back to the configured app URL.
  }

  const confirmationURL = email_data.token_hash && appOrigin
    ? `${appOrigin}/auth/accept-invite?token_hash=${encodeURIComponent(email_data.token_hash)}&type=${encodeURIComponent(verifyTypeFor(actionType))}&redirect_to=${encodeURIComponent(email_data.redirect_to ?? '')}`
    : undefined

  const email = buildAuthEmail(actionType, { confirmationURL, token: email_data.token })
  if (!email) {
    console.error('[send-email-hook] unrecognized email_action_type:', actionType)
    return NextResponse.json({ error: 'Unrecognized email_action_type' }, { status: 400 })
  }

  const recipient = actionType.startsWith('email_change') ? (user.new_email ?? user.email) : user.email

  // Supabase gives this hook 5 seconds to respond before giving up with
  // "Failed to reach hook within maximum time of 5.000000 seconds" — and the
  // auth action itself then fails, after the user record has already been
  // created. Awaiting the SMTP send before responding did not fit that
  // budget: a cold start on this route alone measures ~3s (verified against
  // production), and the Microsoft 365 relay needs several seconds more to
  // connect, authenticate and hand off the message. Invites hit this hardest
  // — they're infrequent enough that the function is nearly always cold.
  //
  // So acknowledge the hook first and send afterwards; after() keeps the
  // function alive once the response has flushed. The trade-off is that a
  // send failure can no longer be reported back to Supabase, so it surfaces
  // only in this route's logs (sendEmail logs the recipient and subject).
  after(async () => {
    try {
      await sendEmail({ to: recipient, subject: email.subject, html: email.html, text: email.text })
    } catch {
      // Already logged by sendEmail; caught so the post-response task does
      // not end in an unhandled rejection.
    }
  })

  return NextResponse.json({})
}
