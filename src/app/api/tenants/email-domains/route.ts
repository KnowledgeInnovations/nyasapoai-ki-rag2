import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, invalidateTenant, getUser } from '@/lib/supabase/server'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Only letters/digits/hyphens/dots, can't start or end with a dot/hyphen —
// rejects anything that isn't a plausible domain (e.g. a full email by
// mistake, or stray whitespace) rather than silently storing garbage that
// would just never match a real invite.
const DOMAIN_RX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

// Senior-only: changes who can be invited into this workspace, scoped to
// the caller's own tenant (never an arbitrary id — no path param here on
// purpose, so a senior admin can't target another tenant by guessing IDs).
export async function PATCH(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || membership.role !== 'senior') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { domains } = await request.json().catch(() => ({})) as { domains?: string[] }
  if (!Array.isArray(domains)) {
    return NextResponse.json({ error: 'domains must be an array' }, { status: 400 })
  }

  const cleaned = [...new Set(domains.map(d => d.trim().toLowerCase()).filter(Boolean))]
  const invalid = cleaned.filter(d => !DOMAIN_RX.test(d))
  if (invalid.length) {
    return NextResponse.json({ error: `Not a valid domain: ${invalid.join(', ')}` }, { status: 400 })
  }

  const service = svc()
  const { error } = await service
    .from('tenants')
    .update({ email_domains: cleaned })
    .eq('id', membership.tenant_id)

  if (error) {
    console.error('Update email_domains error:', error)
    return NextResponse.json({ error: 'Failed to update allowed domains' }, { status: 500 })
  }

  invalidateTenant(membership.tenant_id)

  await recordAudit({
    tenantId: membership.tenant_id,
    userId: (await getUser())?.id ?? null,
    action: AUDIT_ACTIONS.WORKSPACE_DOMAINS,
    resourceType: 'workspace',
    resourceId: membership.tenant_id,
    metadata: { domains: cleaned },
  })

  return NextResponse.json({ domains: cleaned })
}
