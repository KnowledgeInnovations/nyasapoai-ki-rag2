'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react'

interface Props {
  onVerified: () => void
  onCancel?: () => void
}

// Shared between the inline step-up shown mid-login (LoginClient.tsx) and
// the standalone /auth/mfa-challenge page (the server-side fallback for a
// session that reached a protected route at aal1 without completing this
// step — e.g. the tab was closed right after the password step). Same
// verification call either way: challengeAndVerify() creates and verifies
// the challenge in one round trip, and on success upgrades the current
// session to aal2 in place (no new sign-in required).
export default function TotpChallengeForm({ onVerified, onCancel }: Props) {
  const supabase = createClient()
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors()
      if (listErr) { setError(listErr.message); return }
      const factor = factors?.totp.find(f => f.status === 'verified')
      if (!factor) { setError('No authenticator is set up on this account.'); return }

      const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (verifyErr) { setError('Incorrect code. Please try again.'); return }
      onVerified()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 font-editorial-sans">
      <div>
        <div className="mb-3 flex h-12 w-12 items-center justify-center border border-brand/20 bg-brand-light">
          <ShieldCheck className="h-6 w-6 text-brand" />
        </div>
        <h2 className="font-editorial text-2xl font-normal text-gray-900">Two-factor verification</h2>
        <p className="mt-1 text-sm text-gray-500">Enter the 6-digit code from your authenticator app.</p>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
          className="w-full border border-gray-300 bg-white px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-gray-900 placeholder-gray-300 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
        />

        <button type="submit" disabled={loading || code.length !== 6}
          className="flex w-full items-center justify-center gap-2 bg-brand py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying…</>
            : <>Verify <ArrowRight className="h-4 w-4" /></>}
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
