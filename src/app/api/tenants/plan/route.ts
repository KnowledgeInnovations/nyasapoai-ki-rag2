import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser, invalidateTenant } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/roles'
import { normalizePlan, PLANS, formatBytes, type Plan } from '@/lib/plans'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/**
 * A workspace changing its own plan.
 *
 * Until now a plan could only be changed by a platform admin, which meant an
 * upgrade needed us in the loop for something the customer is perfectly able
 * to decide. This is the self-serve path, and it matches signup: all three
 * tiers are chosen by the customer, so all three can be moved between.
 *
 * Senior users only — the person who created the workspace is Senior by
 * construction, so this covers them, and it does not strand a workspace whose
 * creator has since left.
 *
 * Plan only. Lifecycle status stays with platform admins: a workspace must
 * not be able to lift its own suspension.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * What a workspace already holds that the target plan would not allow.
 *
 * Nothing is deleted or switched off by going over: the limits are checked
 * when something is added, so an over-capacity workspace simply cannot add
 * more. Saying so plainly beats letting them find out at the moment they try.
 */
async function overagesFor(tenantId: string, plan: Plan): Promise<string[]> {
  const limits = PLANS[plan]
  const service = svc()
  const out: string[] = []

  const [{ count: users }, { count: seniors }, { count: documents }] = await Promise.all([
    service.from('memberships').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    service.from('memberships').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'senior'),
    service.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])

  if (limits.maxUsers !== null && (users ?? 0) > limits.maxUsers) {
    out.push(`${users} members, and ${limits.label} allows ${limits.maxUsers}`)
  }
  if (limits.maxSeniorUsers !== null && (seniors ?? 0) > limits.maxSeniorUsers) {
    out.push(`${seniors} Senior users, and ${limits.label} allows ${limits.maxSeniorUsers}`)
  }
  if (limits.maxDocuments !== null && (documents ?? 0) > limits.maxDocuments) {
    out.push(`${documents} documents, and ${limits.label} allows ${limits.maxDocuments}`)
  }

  if (limits.maxStorageBytes !== null) {
    const { data: sizes } = await service
      .from('documents').select('file_size').eq('tenant_id', tenantId)
    const used = (sizes ?? []).reduce((sum, d) => sum + (Number(d.file_size) || 0), 0)
    if (used > limits.maxStorageBytes) {
      out.push(`${formatBytes(used)} stored, and ${limits.label} allows ${formatBytes(limits.maxStorageBytes)}`)
    }
  }

  return out
}

export async function PATCH(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (normalizeRole(membership.role) !== 'senior') {
    return NextResponse.json({
      error: 'Changing the plan is available to Senior users.',
    }, { status: 403 })
  }

  const tenant = await getTenant(membership.tenant_id)
  if (tenant?.is_platform) {
    return NextResponse.json({ error: 'The platform workspace has no plan.' }, { status: 400 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { plan: rawPlan, confirmed } = (body ?? {}) as { plan?: string; confirmed?: boolean }

  // normalizePlan falls back to starter for anything it does not recognise,
  // which would quietly downgrade a workspace on a typo. Only accept a value
  // that survives the round trip.
  const plan = normalizePlan(typeof rawPlan === 'string' ? rawPlan : null)
  if (plan !== String(rawPlan ?? '').trim().toLowerCase()) {
    return NextResponse.json({ error: `Unknown plan "${rawPlan}".` }, { status: 400 })
  }

  const current = normalizePlan(tenant?.plan)
  if (plan === current) {
    return NextResponse.json({ plan: current, unchanged: true })
  }

  // A move that leaves the workspace over its new limits is allowed, but not
  // by accident: the first request returns what would be exceeded and changes
  // nothing. The caller shows that and asks again with confirmed.
  const overages = await overagesFor(membership.tenant_id, plan)
  if (overages.length && !confirmed) {
    return NextResponse.json({ needsConfirmation: true, plan, from: current, overages }, { status: 409 })
  }

  const service = svc()
  const { data: updated, error } = await service
    .from('tenants')
    .update({ plan })
    .eq('id', membership.tenant_id)
    .select('id, plan')
    .single()

  if (error || !updated) {
    console.error('[plan] self-serve change failed:', error?.message)
    return NextResponse.json({ error: 'Could not change the plan.' }, { status: 500 })
  }

  invalidateTenant(membership.tenant_id)

  await recordAudit({
    tenantId: membership.tenant_id,
    userId: (await getUser())?.id ?? null,
    action: AUDIT_ACTIONS.WORKSPACE_PLAN,
    resourceType: 'workspace',
    resourceId: membership.tenant_id,
    metadata: { from: current, to: plan, by: 'workspace' },
  })

  console.log(`[plan] ${tenant?.name ?? membership.tenant_id}: ${current} -> ${plan} (self-serve)`)

  return NextResponse.json({ plan, from: current, overages })
}
