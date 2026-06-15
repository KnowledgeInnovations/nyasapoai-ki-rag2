import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { validateSubdomainFormat } from '@/lib/tenant'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Public — lets the signup / setup-workspace forms give live feedback on
// whether a subdomain is well-formed, not reserved, and not already taken.
export async function GET(request: NextRequest) {
  const subdomain = (request.nextUrl.searchParams.get('subdomain') ?? '').trim().toLowerCase()

  const formatError = validateSubdomainFormat(subdomain)
  if (formatError) {
    return NextResponse.json({ available: false, error: formatError })
  }

  const service = svc()
  const { data, error } = await service
    .from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .maybeSingle()

  if (error) {
    console.error('Subdomain check error:', error)
    return NextResponse.json({ error: 'Failed to check subdomain' }, { status: 500 })
  }

  if (data) {
    return NextResponse.json({ available: false, error: 'This subdomain is already taken.' })
  }

  return NextResponse.json({ available: true })
}
