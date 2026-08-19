import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership, getTenant, createClient, getSessionId, touchLastActive } from '@/lib/supabase/server'
import { subdomainFromHost, tenantUrlForHost, rootUrlForHost } from '@/lib/domain'
import { isSessionEmailMfaVerified } from '@/lib/emailMfa'
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
  if (user.user_metadata?.email_mfa_enabled) {
    // Email has no Supabase-native aal concept — checked against our own
    // verified-sessions table instead (see emailMfa.ts).
    const sessionId = await getSessionId()
    const verified = sessionId && await isSessionEmailMfaVerified(
      createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } }),
      sessionId,
    )
    if (!verified) redirect('/auth/mfa-challenge')
  } else {
    // getAuthenticatorAssuranceLevel() reads the already-fetched session
    // locally — no extra Auth API round trip.
    const supabase = await createClient()
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/auth/mfa-challenge')
  }

  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')
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

  return (
    <AppShell user={user} role={role} tenantName={tenantName} isPlatformAdmin={isPlatformAdmin} isPlatformTenant={tenant?.is_platform === true}>
      {children}
    </AppShell>
  )
}
