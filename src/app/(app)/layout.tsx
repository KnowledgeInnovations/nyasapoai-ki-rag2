import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembershipRecord, getHomeMembership, getTenant, getTenantLogoPath, getWorkspaceStatus, getSessionId, touchLastActive, needsMfaStepUp } from '@/lib/supabase/server'
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
  if (!membership) {
    // Not a member of the workspace whose subdomain this is. That is not
    // the same as having no workspace, and the two used to share an
    // answer: both were sent to /auth/setup-workspace, which offers to
    // create an organisation and pick a subdomain. Someone who had just
    // opened a colleague's subdomain, or a demo one, was being asked to
    // build a second workspace they did not want — and the code lower in
    // this file that exists to send them to their own could never run,
    // because this redirect fired first.
    const host = (await headers()).get('host')
    const landedOn = subdomainFromHost(host)
    const home = await getHomeMembership()

    if (home) {
      const homeTenant = await getTenant(home.tenant_id)
      if (homeTenant) {
        // The platform workspace has no public subdomain of its own, so
        // its members go to the root domain.
        redirect(homeTenant.is_platform
          ? rootUrlForHost('/admin/tenants', host)
          : tenantUrlForHost(homeTenant.subdomain, '/ask', host))
      }
    }

    // Signed in and a member of nothing. Creating a workspace is the right
    // offer — but if they arrived at a particular workspace's subdomain,
    // say so first, because the likeliest truth is that they are signed in
    // as the wrong person rather than that they need a new organisation.
    redirect(landedOn
      ? `/auth/setup-workspace?workspace=${encodeURIComponent(landedOn)}`
      : '/auth/setup-workspace')
  }

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

  // Landing on another workspace's subdomain is handled above, where the
  // membership lookup comes back empty.
  //
  // It used to be handled here, and could not be: getMembershipRecord()
  // resolves membership BY the subdomain being visited, so by the time
  // execution reached this point tenant.subdomain always equalled the
  // host's — the condition was never true, and the real case had already
  // been redirected to "create a workspace" twenty lines earlier.

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
