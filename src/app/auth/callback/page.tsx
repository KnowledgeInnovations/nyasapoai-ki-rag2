'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, AlertTriangle } from 'lucide-react'

/**
 * Where an emailed sign-in link lands, to turn it into a session.
 *
 * The email sign-in link used to point straight at /ask, which does nothing
 * with the tokens it arrives carrying: the app layout found no session
 * cookie and bounced the person back to the login page. Clicking "Sign in"
 * in an email and arriving at a login form is indistinguishable from the
 * link being broken, so that is what it looked like.
 *
 * Two link shapes have to be handled, because which one arrives depends on
 * the flow the request was made with:
 *
 *   #access_token=…&refresh_token=…   implicit — works from any browser,
 *                                     which is what an emailed link needs
 *   ?code=…                           PKCE — only completes in the browser
 *                                     that asked, which is why the request
 *                                     side now uses the implicit client
 *
 * Both are set through the SSR browser client so the session persists in the
 * cookies the server reads. setSession() is used for the hash rather than
 * relying on detectSessionInUrl, which rejects that shape outright because
 * createBrowserClient() hardcodes PKCE — the same reason set-password parses
 * the hash by hand.
 */
function CallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    // Where to go once signed in. Only a path within this app, never an
    // absolute URL: an open redirect on a sign-in route is how a convincing
    // phishing link gets built.
    const raw = params.get('next') ?? '/ask'
    const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/ask'

    ;(async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const access_token = hash.get('access_token')
      const refresh_token = hash.get('refresh_token')
      const hashError = hash.get('error_description') ?? hash.get('error')
      const code = params.get('code')
      const queryError = params.get('error_description') ?? params.get('error')

      if (hashError || queryError) {
        setError(hashError ?? queryError ?? 'This link is no longer valid.')
        return
      }

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (error) { setError(error.message); return }
        window.history.replaceState(null, '', window.location.pathname)
        router.replace(next)
        return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          // The usual cause: the link was opened somewhere other than the
          // browser that asked for it, so the PKCE verifier is not here.
          setError('This link was opened in a different browser from the one that requested it. Ask for a new link and open it here.')
          return
        }
        router.replace(next)
        return
      }

      // Nothing to work with. Someone may already be signed in — if so, let
      // them through rather than showing an error for no reason.
      const { data } = await supabase.auth.getUser()
      if (data.user) { router.replace(next); return }
      setError('This sign-in link is incomplete. Please request a new one.')
    })()
  }, [params, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 font-editorial-sans">
      <div className="w-full max-w-md border border-gray-200 bg-white p-10 shadow-sm">
        <div className="font-editorial mb-8 text-[21px] text-gray-900">
          Nyansa<span className="text-brand">·</span>AI
        </div>

        {error ? (
          <>
            <div className="mb-5 flex h-11 w-11 items-center justify-center bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <h1 className="font-editorial mb-3 text-[26px] leading-tight text-gray-900">
              We could not sign you in
            </h1>
            <p className="mb-8 text-sm leading-relaxed text-gray-500">{error}</p>
            <Link
              href="/auth/login"
              className="inline-flex w-full items-center justify-center bg-brand px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            Signing you in…
          </div>
        )}
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  )
}
