export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { getTenantBySubdomain } from '@/lib/supabase/server'
import { subdomainFromHost } from '@/lib/domain'
import LoginClient from '@/components/auth/LoginClient'

export default async function LoginPage() {
  const host = (await headers()).get('host')
  const subdomain = subdomainFromHost(host)
  const tenant = subdomain ? await getTenantBySubdomain(subdomain) : null

  return <LoginClient tenant={tenant} />
}
