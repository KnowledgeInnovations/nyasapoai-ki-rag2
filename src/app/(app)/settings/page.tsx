import type { Metadata } from 'next'
import { getUser, getMembership } from '@/lib/supabase/server'
import SettingsClient from '@/components/app/SettingsClient'

export const metadata: Metadata = { title: 'Settings — NyasapoAI' }

export default async function SettingsPage() {
  // Both served from cache — no extra network calls beyond what layout already did.
  const [user, membership] = await Promise.all([getUser(), getMembership()])

  return (
    <SettingsClient
      email={user?.email ?? ''}
      name={user?.user_metadata?.name ?? ''}
      role={membership?.role ?? 'junior'}
    />
  )
}
