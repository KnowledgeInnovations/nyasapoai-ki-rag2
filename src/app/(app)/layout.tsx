import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getUser, getMembership, getTenant } from '@/lib/supabase/server'
import { subdomainFromHost, tenantUrlForHost, rootUrlForHost } from '@/lib/domain'
import AppShell from '@/components/app/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth/login')
  const membership = await getMembership()
  if (!membership) redirect('/auth/setup-workspace')
  const role = membership.role
  const tenant = await getTenant(membership.tenant_id)
  const tenantName = tenant?.name ?? 'NyasapoAI'
  const isPlatformAdmin = role === 'senior' && tenant?.is_platform === true

  // A session is shared across all *.nyasapoai.com subdomains (see
  // src/lib/domain.ts). If a signed-in user lands on a different tenant's
  // subdomain, send them to their own workspace's subdomain instead. The
  // platform tenant has no public subdomain of its own, so its members are
  // sent to the root domain.
  const host = (await headers()).get('host')
  const currentSubdomain = subdomainFromHost(host)
  if (tenant && currentSubdomain && currentSubdomain !== tenant.subdomain) {
    redirect(tenant.is_platform ? rootUrlForHost('/ask', host) : tenantUrlForHost(tenant.subdomain, '/ask', host))
  }

  return <AppShell user={user} role={role} tenantName={tenantName} isPlatformAdmin={isPlatformAdmin}>{children}</AppShell>
}
