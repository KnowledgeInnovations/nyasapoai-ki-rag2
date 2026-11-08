import { NextRequest, NextResponse } from 'next/server'
import { withRequestUsage } from '@/lib/usageRequest'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { canAccessDashboards } from '@/lib/roles'
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

/** Attributes every model call under this handler — see src/lib/usage.ts. */
export async function GET(request: NextRequest) {
  return withRequestUsage(() => handleGet(request))
}

async function handleGet(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The dashboards page turns Junior users away; the API has to as well,
  // or the page check is only a hidden link.
  if (!canAccessDashboards(membership.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
