import { NextResponse } from 'next/server'
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

  const confirmationURL = email_data.token_hash
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify?token=${email_data.token_hash}&type=${verifyTypeFor(actionType)}&redirect_to=${encodeURIComponent(email_data.redirect_to ?? '')}`
    : undefined

  const email = buildAuthEmail(actionType, { confirmationURL, token: email_data.token })
  if (!email) {
    console.error('[send-email-hook] unrecognized email_action_type:', actionType)
    return NextResponse.json({ error: 'Unrecognized email_action_type' }, { status: 400 })
  }

  const recipient = actionType.startsWith('email_change') ? (user.new_email ?? user.email) : user.email

  await sendEmail({ to: recipient, subject: email.subject, html: email.html, text: email.text })
  return NextResponse.json({})
}
