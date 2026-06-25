'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, Mail } from 'lucide-react'

interface Props {
  email: string
  onVerified: () => void
  onCancel?: () => void
}

const RESEND_COOLDOWN_S = 30

// Shared between the inline login step-up (LoginClient.tsx), the standalone
// /auth/mfa-challenge fallback page, and the Settings setup flow
// (TwoFactorSettings.tsx) — same send/verify API calls in every case, just
// different onVerified behavior.
export default function EmailOtpChallengeForm({ email, onVerified, onCancel }: Props) {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown]   = useState(0)

  async function send() {
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/auth/email-mfa/send', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code.'); return }
      setCooldown(RESEND_COOLDOWN_S)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  // Auto-send on mount — the whole point of this form is "a code is on its
  // way", so the user shouldn't have to click anything first. send() takes
  // no arguments and reads no props/state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { send() }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setVerifying(true)
    try {
      const res = await fetch('/api/auth/email-mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Incorrect code.'); return }
      onVerified()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-light">
          <Mail className="h-6 w-6 text-brand" />
        </div>
        <h2 className="text-2xl font-extrabold text-gray-900">Check your email</h2>
        <p className="mt-1 text-sm text-gray-500">
          We sent a 6-digit code to <span className="font-semibold text-gray-800">{email}</span>.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="••••••"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-gray-900 placeholder-gray-300 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
        />

        <button type="submit" disabled={verifying || code.length !== 6}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-60">
          {verifying
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying…</>
            : <>Verify <ArrowRight className="h-4 w-4" /></>}
        </button>

        <button type="button" onClick={send} disabled={sending || cooldown > 0}
          className="w-full text-center text-sm font-medium text-brand transition hover:text-brand-dark disabled:cursor-default disabled:text-gray-400">
          {sending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>

        {onCancel && (
          <button type="button" onClick={onCancel}
            className="w-full text-center text-sm font-medium text-gray-500 transition hover:text-gray-700">
            Cancel
          </button>
        )}
      </form>
    </div>
  )
}
