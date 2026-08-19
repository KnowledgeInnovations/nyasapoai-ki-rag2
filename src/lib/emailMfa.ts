/**
 * Custom email-based second factor — Supabase's native MFA only supports
 * totp/phone/webauthn, so there's no built-in "email" factor to enroll.
 * This is a parallel verification system: a short-lived code emailed via
 * the existing sendEmail() transport, hashed at rest, and a per-session
 * "verified" marker (email_mfa_verified_sessions) that stands in for the
 * aal2 upgrade Supabase's own challengeAndVerify() would normally produce.
 * Used only for users who chose email over an authenticator app (mutually
 * exclusive — see TwoFactorSettings.tsx).
 */

import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'

const CODE_TTL_MS        = 10 * 60 * 1000
const VERIFIED_TTL_MS    = 12 * 60 * 60 * 1000
const MAX_ATTEMPTS       = 5
const RESEND_COOLDOWN_MS = 30 * 1000

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export async function sendEmailOtp(svc: SupabaseClient, userId: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const { data: recent } = await svc.from('email_otp_codes')
    .select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, error: 'Please wait a moment before requesting another code.' }
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const { error } = await svc.from('email_otp_codes').insert({
    user_id: userId,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) return { ok: false, error: 'Failed to generate code.' }

  try {
    await sendEmail({
      to: email,
      subject: 'Your Nyansa AI verification code',
      html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your verification code</title></head>
<body style="margin:0;padding:0;background-color:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);max-width:480px;">
        <tr><td style="background-color:#2029bd;padding:28px 32px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:400;color:#ffffff;letter-spacing:-0.2px;">Nyansa<span style="color:#14caf4;">&middot;</span>AI</span>
        </td></tr>
        <tr><td style="padding:36px 32px 16px 32px;">
          <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#0f172a;">Your verification code</h1>
          <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;">Enter this code to finish signing in.</p>
          <div style="text-align:center;margin:0 0 20px 0;">
            <span style="display:inline-block;padding:14px 28px;background-color:#e8fbff;border-radius:12px;font-size:30px;font-weight:800;letter-spacing:8px;color:#2029bd;">${code}</span>
          </div>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This code expires in 10 minutes.</p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #f1f5f9;">
          <p style="margin:0;font-size:11px;color:#cbd5e1;">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    })
  } catch {
    return { ok: false, error: 'Failed to send the email. Please try again.' }
  }
  return { ok: true }
}

export async function verifyEmailOtp(
  svc: SupabaseClient, userId: string, sessionId: string | null, code: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await svc.from('email_otp_codes')
    .select('id, code_hash, expires_at, attempts')
    .eq('user_id', userId).is('consumed_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!row) return { ok: false, error: 'No active code. Request a new one.' }
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'Code expired. Request a new one.' }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many attempts. Request a new one.' }

  if (hashCode(code.trim()) !== row.code_hash) {
    await svc.from('email_otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return { ok: false, error: 'Incorrect code.' }
  }

  await svc.from('email_otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)

  if (sessionId) {
    await svc.from('email_mfa_verified_sessions').upsert({
      session_id: sessionId,
      user_id: userId,
      verified_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + VERIFIED_TTL_MS).toISOString(),
    })
  }
  return { ok: true }
}

export async function isSessionEmailMfaVerified(svc: SupabaseClient, sessionId: string): Promise<boolean> {
  const { data } = await svc.from('email_mfa_verified_sessions').select('expires_at').eq('session_id', sessionId).maybeSingle()
  if (!data) return false
  return new Date(data.expires_at).getTime() > Date.now()
}
