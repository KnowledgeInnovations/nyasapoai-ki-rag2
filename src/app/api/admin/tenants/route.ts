import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant } from '@/lib/supabase/server'
import { validateSubdomainFormat } from '@/lib/tenant'
import { normalizePlan } from '@/lib/plans'
import { normalizeStatus } from '@/lib/workspaceStatus'

/**
 * Platform-admin provisioning: create a workspace on any plan, with its first
 * Senior user.
 *
 * The public route (/api/tenants) is self-serve and deliberately cannot do
 * this — it refuses anyone who already belongs to a workspace, and it will
 * not grant a plan that is not self-serve. So an Enterprise sale had no path
 * through the product at all: the only way to provision one was to write to
 * the database by hand. This is that path.
 *
 * The admin account can be created two ways, because email delivery is not
 * something to bet a handover on:
 *   - invite: Supabase sends them an invitation to set their own password;
 *   - password: a temporary password is generated and returned ONCE, for the
 *     admin to pass on another way. Nothing stores it.
 */

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Readable, and strong enough to not be the weak link before it is changed. */
function temporaryPassword(): string {
  const words = ['Harbour', 'Lantern', 'Compass', 'Meridian', 'Thicket', 'Bastion', 'Quarry', 'Almanac']
  const w = words[Math.floor(Math.random() * words.length)]
  const n = String(Math.floor(Math.random() * 9000) + 1000)
  const sym = '!@#$%&*'[Math.floor(Math.random() * 7)]
  return `${w}-${n}${sym}`
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actingTenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !actingTenant?.is_platform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const {
    name: rawName, subdomain: rawSubdomain, plan: rawPlan,
    status: rawStatus, adminEmail: rawEmail, adminName: rawAdminName,
    invite,
  } = (body ?? {}) as Record<string, unknown>

  const name = String(rawName ?? '').trim()
  if (!name || name.length > 200) {
    return NextResponse.json({ error: 'A workspace name is required.' }, { status: 400 })
  }

  const subdomain = String(rawSubdomain ?? '').trim().toLowerCase()
  const formatError = validateSubdomainFormat(subdomain)
  if (formatError) return NextResponse.json({ error: formatError }, { status: 400 })

  const plan = normalizePlan(typeof rawPlan === 'string' ? rawPlan : null)
  // An admin creating an Enterprise workspace usually wants it usable
  // immediately — the contract is the gate, not the product. Still explicit.
  const status = typeof rawStatus === 'string' && rawStatus
    ? normalizeStatus(rawStatus)
    : 'active'

  const adminEmail = String(rawEmail ?? '').trim().toLowerCase()
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return NextResponse.json({ error: 'A valid email for the first Senior user is required.' }, { status: 400 })
  }
  const adminName = String(rawAdminName ?? '').trim()
  const useInvite = invite === true

  const service = svc()

  const { data: existing, error: lookupError } = await service
    .from('tenants').select('id').eq('subdomain', subdomain).maybeSingle()
  if (lookupError) {
    console.error('[admin/tenants] subdomain lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Could not create the workspace.' }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({ error: 'That subdomain is already taken.' }, { status: 409 })
  }

  /* ── the workspace ──────────────────────────────────────── */
  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({
      name, subdomain, plan, status,
      // Left unrestricted: an Enterprise workspace often spans several
      // domains (contractors, subsidiaries), and a Senior user can add
      // restrictions later in Settings.
      email_domains: [],
    })
    .select('id, name, subdomain, plan, status')
    .single()

  if (tenantError || !tenant) {
    console.error('[admin/tenants] create failed:', tenantError?.message)
    return NextResponse.json({ error: 'Could not create the workspace.' }, { status: 500 })
  }

  // Anything past this point that fails leaves a workspace with no way in, so
  // each failure rolls the workspace back rather than leaving a half-made one
  // holding its subdomain.
  const rollback = async (reason: string) => {
    await service.from('tenants').delete().eq('id', tenant.id)
    console.error(`[admin/tenants] rolled back "${name}": ${reason}`)
  }

  /* ── the first Senior user ──────────────────────────────── */
  let userId: string | null = null
  let temporary: string | null = null
  let invited = false

  // Reuse an existing account rather than failing: the person may already
  // have signed up, or belong to another workspace.
  let page = 1
  while (!userId) {
    const { data: list, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      await rollback(`could not search existing users: ${error.message}`)
      return NextResponse.json({ error: 'Could not create the workspace.' }, { status: 500 })
    }
    const hit = list.users.find(u => u.email?.toLowerCase() === adminEmail)
    if (hit) { userId = hit.id; break }
    if (list.users.length < 200) break
    page++
  }

  if (!userId) {
    if (useInvite) {
      const { data, error } = await service.auth.admin.inviteUserByEmail(adminEmail, {
        data: adminName ? { name: adminName } : undefined,
      })
      if (error || !data?.user) {
        await rollback(`invite failed: ${error?.message ?? 'no user returned'}`)
        return NextResponse.json({
          error: `Could not invite ${adminEmail}: ${error?.message ?? 'unknown error'}`,
        }, { status: 502 })
      }
      userId = data.user.id
      invited = true
    } else {
      temporary = temporaryPassword()
      const { data, error } = await service.auth.admin.createUser({
        email: adminEmail,
        password: temporary,
        email_confirm: true,
        user_metadata: adminName ? { name: adminName } : undefined,
      })
      if (error || !data?.user) {
        await rollback(`account creation failed: ${error?.message ?? 'no user returned'}`)
        return NextResponse.json({
          error: `Could not create an account for ${adminEmail}: ${error?.message ?? 'unknown error'}`,
        }, { status: 500 })
      }
      userId = data.user.id
    }
  }

  // public.users is filled by the on_auth_user_created trigger, and the
  // membership has a foreign key to it — wait rather than assume.
  for (let i = 0; i < 10; i++) {
    const { data } = await service.from('users').select('id').eq('id', userId).maybeSingle()
    if (data) break
    await new Promise(r => setTimeout(r, 300))
  }

  const { error: membershipError } = await service
    .from('memberships')
    .insert({ user_id: userId, tenant_id: tenant.id, role: 'senior' })

  if (membershipError) {
    await rollback(`membership failed: ${membershipError.message}`)
    return NextResponse.json({ error: 'Could not create the workspace.' }, { status: 500 })
  }

  console.log(`[admin/tenants] created ${tenant.name} (${tenant.subdomain}) on ${plan}/${status}, admin ${adminEmail}`)

  return NextResponse.json({
    tenant,
    admin: {
      email: adminEmail,
      // Returned once and never stored. The caller shows it, then it is gone.
      temporaryPassword: temporary,
      invited,
    },
  })
}
