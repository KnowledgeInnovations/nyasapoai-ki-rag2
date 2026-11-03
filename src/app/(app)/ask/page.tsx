import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser, getMembership, getTenant, metaString } from '@/lib/supabase/server'
import { isPlatformTenant } from '@/lib/roles'
import AskInterface from '@/components/app/AskInterface'

export const metadata: Metadata = { title: 'Ask AI — Nyansa AI' }

export default async function AskPage() {
  const user = await getUser()
  const userName = metaString(user, 'name') ?? user?.email?.split('@')[0] ?? 'there'

  const membership = await getMembership()
  const tenant = membership ? await getTenant(membership.tenant_id) : null
  if (isPlatformTenant(tenant)) redirect('/admin/tenants')
  const tenantName = tenant?.name ?? 'Nyansa AI'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AskInterface userName={userName} tenantName={tenantName} />
    </div>
  )
}
