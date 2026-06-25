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
      subject: 'Your NyansapoAI verification code',
      html: `<p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
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
