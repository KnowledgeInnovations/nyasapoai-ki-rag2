'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { purgeAppStorage } from '@/lib/clientStore'

// Detects when the browser-side Supabase client loses its session
// (e.g. stale refresh token from a cookie-domain migration) and redirects
// to login immediately instead of letting the UI silently break.
export default function AuthListener() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Cached answers and conversation snapshots are this account's, and
        // the next person to sign in on this browser is not it. Scoping the
        // keys is what actually keeps them apart (src/lib/clientStore.ts);
        // this is so the data does not sit there at all.
        purgeAppStorage()
        router.replace('/auth/login')
      }
    })
    return () => subscription.unsubscribe()
  }, [router])

  return null
}
