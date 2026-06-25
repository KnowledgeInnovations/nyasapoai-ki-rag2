'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react'

export default function ConfirmEmailChangePage() {
  const supabase = createClient()
  const [state, setState] = useState<'checking' | 'confirmed' | 'invalid'>('checking')

  useEffect(() => {
    // Same hash-token shape as the recovery/invite links (see
    // /auth/set-password) — createBrowserClient() hardcodes flowType:
    // 'pkce', which rejects this implicit-grant hash, so the session is
    // parsed and set manually rather than relying on detectSessionInUrl.
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const access_token = hashParams.get('access_token')
    const refresh_token = hashParams.get('refresh_token')

    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token }).then(({ data, error }) => {
        setState(data.session && !error ? 'confirmed' : 'invalid')
        window.history.replaceState(null, '', window.location.pathname)
      })
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('invalid')
  }, [supabase])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-gray-200/80 bg-white p-8 shadow-2xl shadow-black/5">
          {state === 'checking' ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : state === 'confirmed' ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-extrabold text-gray-900">Email confirmed</h2>
              <p className="text-sm text-gray-500">
                Your email address has been updated. If your workspace requires confirmation from both
                addresses, check your other inbox too.
              </p>
              <a href="/settings" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                Back to Settings <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="space-y-3 text-center">
              <h2 className="text-xl font-extrabold text-gray-900">Link expired</h2>
              <p className="text-sm text-gray-500">
                This confirmation link is invalid or has expired. Request the email change again from Settings.
              </p>
              <a href="/settings" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                Back to Settings <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
