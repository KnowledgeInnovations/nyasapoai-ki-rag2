import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembershipRecord, getTenant, getTenantLogoPath, getWorkspaceStatus, getSessionId, touchLastActive, needsMfaStepUp } from '@/lib/supabase/server'
import { isEmailMfaEnabled } from '@/lib/emailMfaFlag'
import { workspaceAccess } from '@/lib/workspaceStatus'
import { subdomainFromHost, tenantUrlForHost, rootUrlForHost } from '@/lib/domain'
import { isSessionEmailMfaVerified } from '@/lib/emailMfa'
import { publicUrlFor } from '@/lib/tenantLogo'
import AppShell from '@/components/app/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth/login')

  // Defense in depth for 2FA: LoginClient.tsx already forces the step-up
  // client-side (TOTP or email, whichever the account uses), but a session
  // can reach this layout without having completed it if that client-side
  // step was skipped (e.g. the tab closed right after signInWithPassword,
  // then was reopened straight to a protected route with the already-valid
  // cookie).
  if (isEmailMfaEnabled(user)) {
    // Email has no Supabase-native aal concept — checked against our own
    // verified-sessions table instead (see emailMfa.ts).
    const sessionId = await getSessionId()
    const verified = sessionId && await isSessionEmailMfaVerified(
      createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } }),
      sessionId,
    )
    if (!verified) redirect('/auth/mfa-challenge')
  } else if (await needsMfaStepUp()) {
    redirect('/auth/mfa-challenge')
  }

  // The raw record, not getMembership(): this layout makes the access
  // decisions itself so it can send each case to its own page. The gated
  // getMembership() would turn a suspended workspace into "no workspace" and
  // send its members to set up a new one.
  const membership = await getMembershipRecord()
  if (!membership) redirect('/auth/setup-workspace')

  // A workspace that is suspended, unpaid or not yet provisioned is closed to
  // its members. Nothing is deleted — see workspaceAccess() — and access
  // returns the moment it is reactivated. Checked before touchLastActive so a
  // blocked workspace does not register activity it never had.
  const lifecycle = await getWorkspaceStatus(membership.tenant_id)
  if (!workspaceAccess(lifecycle.status, lifecycle.access_until).allowed) {
    redirect('/workspace-unavailable')
  }

  await touchLastActive(user.id, membership.tenant_id)
  const role = membership.role
  const tenant = await getTenant(membership.tenant_id)
  const tenantName = tenant?.name ?? 'Nyansa AI'
  const isPlatformAdmin = role === 'senior' && tenant?.is_platform === true

  // A session is shared across all *.nyansaai.com subdomains (see
  // src/lib/domain.ts). If a signed-in user lands on a different tenant's
  // subdomain, send them to their own workspace's subdomain instead. The
  // platform tenant has no public subdomain of its own, so its members are
  // sent to the root domain.
  const host = (await headers()).get('host')
  const currentSubdomain = subdomainFromHost(host)
  if (tenant && currentSubdomain && currentSubdomain !== tenant.subdomain) {
    redirect(tenant.is_platform ? rootUrlForHost('/admin/tenants', host) : tenantUrlForHost(tenant.subdomain, '/ask', host))
  }

  // The same workspace icon the browser tab uses, shown on the sidebar badge
  // in place of the tenant's initials. Tolerates the column being absent —
  // resolves to null and the badge falls back to initials.
  const logoPath = tenant ? await getTenantLogoPath(tenant.subdomain) : null
  const tenantLogoUrl = logoPath ? publicUrlFor(logoPath) : null

  return (
    <AppShell user={user} role={role} tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} isPlatformAdmin={isPlatformAdmin} isPlatformTenant={tenant?.is_platform === true}>
      {children}
    </AppShell>
  )
}
