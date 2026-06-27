import type { Metadata } from 'next'
import { getUser, getMembership, getTenant } from '@/lib/supabase/server'
import SettingsClient from '@/components/app/SettingsClient'

export const metadata: Metadata = { title: 'Settings — Nyansa AI' }

export default async function SettingsPage() {
  // All served from cache — no extra network calls beyond what layout already did.
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  const tenant = membership ? await getTenant(membership.tenant_id) : null

  return (
    <SettingsClient
      email={user?.email ?? ''}
      name={user?.user_metadata?.name ?? ''}
      role={membership?.role ?? 'junior'}
      emailDomains={tenant?.email_domains ?? []}
      isPlatformTenant={tenant?.is_platform ?? false}
    />
  )
}
