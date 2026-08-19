'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Loader2, ShieldCheck, ShieldOff, KeyRound, Mail } from 'lucide-react'
import EmailOtpChallengeForm from '@/components/auth/EmailOtpChallengeForm'

type Status = 'loading' | 'disabled' | 'choosing' | 'enrolling-totp' | 'enrolling-email' | 'enabled'
type Method = 'totp' | 'email'

export default function TwoFactorSettings() {
  const supabase = createClient()
  const [status, setStatus]       = useState<Status>('loading')
  const [activeMethod, setActiveMethod] = useState<Method | null>(null)
  const [email, setEmail]         = useState('')
  const [factorId, setFactorId]   = useState<string | null>(null)
  const [qrCode, setQrCode]       = useState('')
  const [secret, setSecret]       = useState('')
  const [code, setCode]           = useState('')
  const [error, setError]         = useState('')
  const [working, setWorking]     = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [justEnabled, setJustEnabled]       = useState(false)

  async function refresh() {
    const { data: { user } } = await supabase.auth.getUser()
    setEmail(user?.email ?? '')

    if (user?.user_metadata?.email_mfa_enabled) {
      setActiveMethod('email')
      setStatus('enabled')
      return
    }

    const { data, error: err } = await supabase.auth.mfa.listFactors()
    if (err) { setError(err.message); setStatus('disabled'); return }
    const verified = data?.totp.find(f => f.status === 'verified')
    if (verified) {
      setFactorId(verified.id)
      setActiveMethod('totp')
      setStatus('enabled')
    } else {
      setStatus('disabled')
    }
  }

  // Only runs once on mount — refresh() takes no arguments and reads no
  // props/state, so there's nothing meaningful to add to the dependency list.
  // Its setState calls are all behind awaited calls, not actually
  // synchronous, but the lint rule doesn't trace through a named async
  // function to see that.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [])

  async function startTotpEnroll() {
    setError('')
    setWorking(true)
    try {
      // Clean up any abandoned enrollment from a previous attempt (e.g. the
      // user closed the tab mid-setup) before starting fresh, so unverified
      // factors don't pile up indefinitely.
      const { data: existing } = await supabase.auth.mfa.listFactors()
      for (const f of existing?.all.filter(t => t.factor_type === 'totp' && t.status === 'unverified') ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }

      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Nyansa AI' })
      if (err) { setError(err.message); return }
      setFactorId(data.id)
      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setStatus('enrolling-totp')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  async function verifyTotpEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setError('')
    setWorking(true)
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
      if (err) { setError('Incorrect code. Please try again.'); return }
      setCode('')
      setActiveMethod('totp')
      setStatus('enabled')
      setJustEnabled(true)
      setTimeout(() => setJustEnabled(false), 4000)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  async function cancelTotpEnroll() {
    if (factorId) await supabase.auth.mfa.unenroll({ factorId })
    setFactorId(null); setQrCode(''); setSecret(''); setCode(''); setError('')
    setStatus('disabled')
  }

  async function emailEnrollVerified() {
    await supabase.auth.updateUser({ data: { email_mfa_enabled: true } })
    setActiveMethod('email')
    setStatus('enabled')
    setJustEnabled(true)
    setTimeout(() => setJustEnabled(false), 4000)
  }

  async function disable() {
    setError('')
    setWorking(true)
    try {
      if (activeMethod === 'totp' && factorId) {
        const { error: err } = await supabase.auth.mfa.unenroll({ factorId })
        if (err) { setError(err.message); return }
        setFactorId(null)
      } else if (activeMethod === 'email') {
        const { error: err } = await supabase.auth.updateUser({ data: { email_mfa_enabled: false } })
        if (err) { setError(err.message); return }
      }
      setActiveMethod(null)
      setConfirmDisable(false)
      setStatus('disabled')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="overflow-hidden  border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h2 className="text-sm font-bold text-gray-800">Two-Factor Authentication</h2>
        <p className="mt-0.5 text-xs text-gray-500">Require a second step — an authenticator app or an emailed code — when signing in.</p>
      </div>

      <div className="p-6">
        {status === 'loading' && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        )}

        {status === 'disabled' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center  bg-gray-100">
                <ShieldOff className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Disabled</p>
                <p className="text-xs text-gray-500">Your account doesn&apos;t require a second factor yet.</p>
              </div>
            </div>

            {error && (
              <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={startTotpEnroll} disabled={working}
                className="flex flex-1 items-center justify-center gap-2  border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                <KeyRound className="h-4 w-4" /> Use an authenticator app
              </button>
              <button onClick={() => setStatus('enrolling-email')} disabled={working}
                className="flex flex-1 items-center justify-center gap-2  border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                <Mail className="h-4 w-4" /> Use email
              </button>
            </div>
          </div>
        )}

        {status === 'enrolling-totp' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {qrCode && (
                <div className="shrink-0  border border-gray-200 bg-white p-3">
                  {/* qr_code from enroll() is already a complete data: URI, not raw SVG — don't re-wrap or re-encode it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- transient data: URI, not a static asset next/image is meant for */}
                  <img src={qrCode} alt="Authenticator QR code" className="h-36 w-36" />
                </div>
              )}
              <div className="space-y-1.5 text-sm text-gray-600">
                <p>1. Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc).</p>
                <p>2. Or enter this code manually:</p>
                <code className="block break-all  bg-gray-100 px-3 py-1.5 font-mono text-xs text-gray-700">{secret}</code>
                <p>3. Enter the 6-digit code it generates below.</p>
              </div>
            </div>

            {error && (
              <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
            )}

            <form onSubmit={verifyTotpEnroll} className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Verification code</label>
                <input
                  type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="mt-1.5 w-full  border border-gray-200 bg-white px-4 py-2.5 text-center text-lg font-bold tracking-[0.4em] text-gray-900 placeholder-gray-300 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <button type="submit" disabled={working || code.length !== 6}
                className="flex items-center gap-2  bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & enable'}
              </button>
            </form>
            <button type="button" onClick={cancelTotpEnroll} disabled={working}
              className="text-sm font-medium text-gray-500 transition hover:text-gray-700">
              Cancel
            </button>
          </div>
        )}

        {status === 'enrolling-email' && (
          <EmailOtpChallengeForm
            email={email}
            onVerified={emailEnrollVerified}
            onCancel={() => setStatus('disabled')}
          />
        )}

        {status === 'enabled' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center  bg-emerald-50">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    Enabled — {activeMethod === 'totp' ? 'authenticator app' : 'email'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {activeMethod === 'totp'
                      ? "You'll need a code from your authenticator app to sign in."
                      : "You'll need a code emailed to you to sign in."}
                  </p>
                </div>
              </div>
              <button onClick={() => setConfirmDisable(true)} disabled={working}
                className="shrink-0  border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Disable
              </button>
            </div>
            {justEnabled && (
              <div className="flex items-center gap-2  border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Two-factor authentication is now enabled.
              </div>
            )}
            {error && (
              <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
            )}
          </div>
        )}
      </div>

      {confirmDisable && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm  border border-gray-200 bg-white p-6 shadow-2xl shadow-black/10">
            <div className="mb-1 flex h-10 w-10 items-center justify-center  border border-red-200 bg-red-50">
              <ShieldOff className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">Disable two-factor authentication?</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Your account will only require a password to sign in.
            </p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setConfirmDisable(false)} disabled={working}
                className="flex-1  border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={disable} disabled={working}
                className="flex-1  bg-red-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition hover:bg-red-600 disabled:opacity-50">
                {working ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
