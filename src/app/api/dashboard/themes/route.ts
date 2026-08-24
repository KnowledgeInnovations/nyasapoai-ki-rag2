import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getDashboardThemes } from '@/lib/dashboardThemes'
import { DEFAULT_TENANT_DESCRIPTION } from '@/lib/tenant'

export const maxDuration = 30

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const tenant = await getTenant(membership.tenant_id)
  const service = svc()

  try {
    const themes = await getDashboardThemes(
      service, membership.tenant_id,
      tenant?.name ?? 'this organization', tenant?.description ?? DEFAULT_TENANT_DESCRIPTION,
      forceRefresh,
    )
    return NextResponse.json({ themes: themes ?? [] })
  } catch (err) {
    console.error('[Dashboard themes] error:', err)
    return NextResponse.json({ themes: [] })
  }
}
