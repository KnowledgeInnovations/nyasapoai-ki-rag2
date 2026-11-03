import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership, invalidateMembership } from '@/lib/supabase/server'
import { validateSubdomainFormat } from '@/lib/tenant'
import { grantablePlan, PLAN_SIGNUP } from '@/lib/plans'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

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

  const { name, subdomain: rawSubdomain, plan: requestedPlan } = await request.json() as {
    name?: string; subdomain?: string; plan?: string
  }

  // Every tier is self-serve, so this grants what was asked for. It still
  // goes through grantablePlan rather than trusting the body directly: that
  // function is the one place deciding what a signup may have, and a tier
  // that is ever restricted again should be restricted there, not here.
  const plan = grantablePlan(requestedPlan)
  const status = PLAN_SIGNUP[plan].initialStatus

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

  // Seed the allowed-invite-domains list from the creator's own email
  // domain — protects a new tenant from day one with no manual setup.
  // A senior admin can add more domains (or none, for unrestricted) later
  // via Settings.
  const creatorDomain = user.email?.split('@')[1]?.toLowerCase()

  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({
      name: orgName,
      subdomain,
      plan,
      status,
      email_domains: creatorDomain ? [creatorDomain] : [],
    })
    .select('id, name, subdomain, plan, status')
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

  // The first entry in every workspace's log: who made it, and on what.
  await recordAudit({
    tenantId: tenant.id,
    userId: user.id,
    action: AUDIT_ACTIONS.WORKSPACE_CREATED,
    resourceType: 'workspace',
    resourceId: tenant.id,
    metadata: { name: tenant.name, subdomain: tenant.subdomain, plan, status, via: 'signup' },
  })

  // `usable` tells the caller whether to open the workspace or explain that
  // it is waiting on activation — the alternative is sending someone who
  // just signed up straight into a redirect they were not expecting.
  return NextResponse.json({ tenant, usable: status === 'active' })
}
