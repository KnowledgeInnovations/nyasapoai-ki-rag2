'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'

export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [checking, setChecking] = useState(true)
  const [validSession, setValidSession] = useState(false)
  const [linkType, setLinkType]   = useState<string | null>(null)
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [done, setDone]           = useState(false)

  useEffect(() => {
    // Supabase invite/recovery links redirect with the session tokens in the
    // URL hash using the IMPLICIT grant format (#access_token=...&refresh_token=...).
    // createBrowserClient() hardcodes flowType: 'pkce', which makes the
    // built-in detectSessionInUrl handling in _initialize() reject this hash
    // shape with "Not a valid PKCE flow url." and silently skip saving the
    // session. So we parse the hash ourselves and set the session directly —
    // setSession() isn't subject to that flow-type check, and still persists
    // via the same cookie storage the SSR middleware reads.
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const access_token = hashParams.get('access_token')
    const refresh_token = hashParams.get('refresh_token')
    // Supabase tags both invite and password-recovery links with the same
    // hash shape, distinguished only by `type` — used below to show
    // "reset your password" copy instead of "set up your account" copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinkType(hashParams.get('type'))

    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token }).then(({ data, error }) => {
        setValidSession(!!data.session && !error)
        setChecking(false)
        window.history.replaceState(null, '', window.location.pathname)
      })
      return
    }

    // No tokens in the URL — fall back to verifying an existing session.
    // getUser() contacts the Auth server to confirm authenticity, appropriate
    // for a sensitive password-reset flow.
    supabase.auth.getUser().then(({ data }) => {
      setValidSession(!!data.user)
      setChecking(false)
    })
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) { setError(err.message); return }
      // Sign out the temporary invite session so the user signs in fresh
      // with their new password on the login page.
      await supabase.auth.signOut()
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => router.push('/auth/login'), 2500)
    return () => clearTimeout(t)
  }, [done, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-gray-200/80 bg-white p-8 shadow-2xl shadow-black/5">
          {checking ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : done ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-extrabold text-gray-900">Password {linkType === 'recovery' ? 'reset' : 'set'}</h2>
              <p className="text-sm text-gray-500">
                Your password has been {linkType === 'recovery' ? 'reset' : 'set'}. Redirecting you to sign in…
              </p>
              <a href="/auth/login" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                Go to sign in <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : !validSession ? (
            <div className="space-y-3 text-center">
              <h2 className="text-xl font-extrabold text-gray-900">{linkType === 'recovery' ? 'Reset link expired' : 'Invite link expired'}</h2>
              <p className="text-sm text-gray-500">
                {linkType === 'recovery'
                  ? 'This password reset link is invalid or has expired. Request a new one from the sign-in page.'
                  : 'This invitation link is invalid or has expired. Ask your workspace admin to send a new invite, or sign in if you already have a password.'}
              </p>
              <a href={linkType === 'recovery' ? '/auth/forgot-password' : '/auth/login'} className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                {linkType === 'recovery' ? 'Request a new link' : 'Go to sign in'} <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-extrabold text-gray-900">{linkType === 'recovery' ? 'Reset your password' : 'Set your password'}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {linkType === 'recovery' ? 'Choose a new password for your account.' : 'Choose a password to finish setting up your account.'}
                </p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Password</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      required
                      autoFocus
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-11 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 sm:text-sm"
                    />
                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">Minimum 8 characters</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Confirm password</label>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    required
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••••"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 sm:text-sm"
                  />
                </div>

                <button type="submit" disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-60">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {linkType === 'recovery' ? 'Resetting password…' : 'Setting password…'}</>
                    : linkType === 'recovery' ? <>Reset password <ArrowRight className="h-4 w-4" /></> : <>Set password & continue <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
