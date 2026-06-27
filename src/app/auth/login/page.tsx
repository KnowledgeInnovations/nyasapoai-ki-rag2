export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTenantBySubdomain } from '@/lib/supabase/server'
import { subdomainFromHost, rootUrlForHost } from '@/lib/domain'
import LoginClient from '@/components/auth/LoginClient'

export default async function LoginPage() {
  const host = (await headers()).get('host')
  const subdomain = subdomainFromHost(host)
  const tenant = subdomain ? await getTenantBySubdomain(subdomain) : null

  // A subdomain that doesn't match any tenant — most likely one that's been
  // deleted from the platform admin's Tenants page — should not present a
  // working-looking (if generically-branded) login form. Bounce to the main
  // site's own login instead of letting visitors believe this workspace
  // still exists.
  if (subdomain && !tenant) redirect(rootUrlForHost('/auth/login', host))

  return <LoginClient tenant={tenant} />
}
