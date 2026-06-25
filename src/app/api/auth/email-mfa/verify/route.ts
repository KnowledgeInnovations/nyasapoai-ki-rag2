import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getSessionId } from '@/lib/supabase/server'
import { verifyEmailOtp } from '@/lib/emailMfa'

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

  const { code } = await request.json() as { code?: string }
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  // sessionId is derived server-side from the caller's own already-
  // authenticated cookie session — never accepted from the request body —
  // so a verified result can only ever mark the session making this call.
  const sessionId = await getSessionId()
  const result = await verifyEmailOtp(svc(), user.id, sessionId, code)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ verified: true })
}
