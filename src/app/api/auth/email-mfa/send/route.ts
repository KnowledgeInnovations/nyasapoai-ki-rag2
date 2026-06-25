import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { sendEmailOtp } from '@/lib/emailMfa'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Used both for the login step-up challenge (an aal1 session with
// email_mfa_enabled set) and for the Settings setup flow (proving the user
// actually receives codes at their email before turning the method on) —
// getUser() succeeds in both cases since both happen after a real
// password sign-in.
export async function POST() {
  const user = await getUser()
  if (!user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const result = await sendEmailOtp(svc(), user.id, user.email)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 429 })
  return NextResponse.json({ sent: true })
}
