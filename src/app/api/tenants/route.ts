import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership, invalidateMembership } from '@/lib/supabase/server'
import { validateSubdomainFormat } from '@/lib/tenant'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Self-provisioning: an authenticated user with no existing membership
// creates a new tenant and becomes its first ("senior") member.
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const membership = await getMembership()
  if (membership) {
    return NextResponse.json({ error: 'You already belong to a workspace' }, { status: 400 })
  }

  const { name, subdomain: rawSubdomain } = await request.json() as { name?: string; subdomain?: string }

  const orgName = (name ?? '').trim()
  if (!orgName || orgName.length > 200) {
    return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
  }

  const subdomain = (rawSubdomain ?? '').trim().toLowerCase()
  const formatError = validateSubdomainFormat(subdomain)
  if (formatError) {
    return NextResponse.json({ error: formatError }, { status: 400 })
  }

  const service = svc()

  const { data: existing, error: lookupError } = await service
    .from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .maybeSingle()

  if (lookupError) {
    console.error('Tenant lookup error:', lookupError)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({ error: 'This subdomain is already taken.' }, { status: 409 })
  }

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({ name: orgName, subdomain })
    .select('id, name, subdomain')
    .single()

  if (tenantError || !tenant) {
    console.error('Tenant create error:', tenantError)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }

  const { error: membershipError } = await service
    .from('memberships')
    .insert({ user_id: user.id, tenant_id: tenant.id, role: 'senior' })

  if (membershipError) {
    console.error('Membership create error:', membershipError)
    // Roll back the orphaned tenant so a retry doesn't collide on the subdomain.
    await service.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }

  invalidateMembership(user.id)

  return NextResponse.json({ tenant })
}
