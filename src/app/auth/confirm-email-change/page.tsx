'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, MailCheck, ArrowRight, Loader2 } from 'lucide-react'

type State = 'checking' | 'confirmed' | 'pending-other' | 'error'

export default function ConfirmEmailChangePage() {
  const supabase = createClient()
  const [state, setState] = useState<State>('checking')
  const [detail, setDetail] = useState('')

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
        setState(data.session && !error ? 'confirmed' : 'error')
        window.history.replaceState(null, '', window.location.pathname)
      })
      return
    }

    // With "Secure email change" off, Supabase now issues a PKCE `?code=`
    // instead of hash tokens. createBrowserClient()'s automatic
    // detectSessionInUrl exchange apparently isn't completing it here (most
    // likely because the code verifier it needs lives in localStorage from
    // wherever the change was requested, and this link is opened in a
    // different tab/device) — so the code sits unconsumed and this page
    // never sees a session. Exchange it explicitly instead of relying on
    // auto-detection, and surface the real error if it still fails.
    const queryParamsForCode = new URLSearchParams(window.location.search)
    const code = queryParamsForCode.get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        setState(data.session && !error ? 'confirmed' : 'error')
        if (error) setDetail(error.message)
        window.history.replaceState(null, '', window.location.pathname)
      })
      return
    }

    // When "Secure email change" is enabled, Supabase requires confirming
    // from BOTH the old and new address. Clicking the FIRST link redirects
    // here with no tokens at all — just an informational `message` (no
    // `error`) saying to also confirm the other inbox. Without this branch
    // that case fell through to the generic "expired" state, which is
    // wrong: nothing failed, the user just isn't done yet.
    const queryParams = new URLSearchParams(window.location.search)
    const errorDescription = queryParams.get('error_description') ?? hashParams.get('error_description')
    const message = queryParams.get('message') ?? hashParams.get('message')
    if (errorDescription) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(errorDescription)
      setState('error')
    } else if (message) {
      setDetail(message)
      setState('pending-other')
    } else {
      setState('error')
    }
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
              <p className="text-sm text-gray-500">Your email address has been updated.</p>
              <a href="/settings" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                Back to Settings <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : state === 'pending-other' ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light">
                <MailCheck className="h-7 w-7 text-brand" />
              </div>
              <h2 className="text-xl font-extrabold text-gray-900">Almost there</h2>
              <p className="text-sm text-gray-500">{detail || 'This link was confirmed. Check your other inbox for one more confirmation link to finish the change.'}</p>
              <a href="/settings" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                Back to Settings <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="space-y-3 text-center">
              <h2 className="text-xl font-extrabold text-gray-900">Link expired</h2>
              <p className="text-sm text-gray-500">
                {detail || 'This confirmation link is invalid or has expired. Request the email change again from Settings.'}
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
