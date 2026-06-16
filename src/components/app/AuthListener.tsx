'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Detects when the browser-side Supabase client loses its session
// (e.g. stale refresh token from a cookie-domain migration) and redirects
// to login immediately instead of letting the UI silently break.
export default function AuthListener() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/auth/login')
      }
    })
    return () => subscription.unsubscribe()
  }, [router])

  return null
}
