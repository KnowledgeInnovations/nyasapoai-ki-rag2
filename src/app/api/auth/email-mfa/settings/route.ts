import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getSessionId } from '@/lib/supabase/server'
import { isSessionEmailMfaVerified } from '@/lib/emailMfa'

/**
 * Turn email two-factor on or off for the signed-in account.
 *
 * This replaces the browser writing user_metadata.email_mfa_enabled itself,
 * which let a password-only session switch the second factor off (see
 * src/lib/emailMfaFlag.ts). The flag is written to app_metadata, which only
 * the service role can change, and only by a session that has just proven it
 * receives the codes:
 *
 *   - turning it ON follows the settings screen's verification step, which
 *     marks this session verified (POST /api/auth/email-mfa/verify);
 *   - turning it OFF needs the same, so a session that never passed the email
 *     check — the one the factor exists to stop — cannot remove it.
 *
 * user_metadata is mirrored so older clients reading it keep showing the right
 * state; it is never what the server enforces on.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { enabled?: unknown }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
  }

  const service = svc()
  const sessionId = await getSessionId()
  const verified = !!sessionId && await isSessionEmailMfaVerified(service, sessionId)
  if (!verified) {
    return NextResponse.json({
      error: 'Confirm a code sent to your email first.',
      needsVerification: true,
    }, { status: 403 })
  }

  const { error } = await service.auth.admin.updateUserById(user.id, {
    app_metadata: { email_mfa_enabled: body.enabled },
    user_metadata: { email_mfa_enabled: body.enabled },
  })
  if (error) {
    console.error('[email-mfa] could not change the setting:', error.message)
    return NextResponse.json({ error: 'Could not change two-factor settings.' }, { status: 500 })
  }

  return NextResponse.json({ enabled: body.enabled })
}
