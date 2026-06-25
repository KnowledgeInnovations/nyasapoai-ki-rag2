'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createImplicitClient } from '@/lib/supabase/implicitClient'
import { CheckCircle2, Loader2 } from 'lucide-react'

interface Props {
  email: string
}

// Same re-authenticate-before-changing-something-sensitive pattern as
// PasswordSettings.tsx. Kept as its own component (not folded into the
// Profile display-name form) because it has its own multi-step state:
// request -> pending confirmation -> (eventually) reflected once the user
// clicks the email Supabase sends.
export default function EmailSettings({ email }: Props) {
  const supabase = createClient()

  const [newEmail, setNewEmail]   = useState('')
  const [password, setPassword]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [pending, setPending]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPending(false)

    const trimmed = newEmail.trim()
    if (!trimmed || trimmed.toLowerCase() === email.toLowerCase()) {
      setError('Enter a different email address.')
      return
    }

    setSaving(true)
    try {
      // Same reasoning as PasswordSettings.tsx: updateUser() alone doesn't
      // require proving you are who you say you are, and changing the
      // email is just as sensitive as changing the password (it's the
      // account's login identity).
      //
      // Look up the live email instead of trusting the `email` prop: it's
      // passed down from the server-rendered page load, so right after a
      // confirmed email change it can still be the old address until the
      // page is hard-refreshed — reauthenticating against a stale email
      // fails and gets misreported as "wrong password."
      const { data: liveUser } = await supabase.auth.getUser()
      const liveEmail = liveUser.user?.email ?? email
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: liveEmail, password })
      if (reauthErr) { setError('Current password is incorrect.'); return }

      // updateUser() must run on an implicit-flow client, not the app's
      // normal PKCE one: a PKCE-issued confirmation link can only be
      // completed in the same browser that requested it (the code verifier
      // lives in its cookies), but this link is delivered by email and
      // realistically gets opened on a different device. Carry the current
      // session over to a throwaway implicit client just for this call.
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) { setError('Your session has expired. Refresh the page and try again.'); return }
      const implicit = createImplicitClient()
      await implicit.auth.setSession({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      })
      const { error: updateErr } = await implicit.auth.updateUser(
        { email: trimmed },
        { emailRedirectTo: `${window.location.origin}/auth/confirm-email-change` },
      )
      if (updateErr) { setError(updateErr.message); return }

      setPassword('')
      setPending(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h2 className="text-sm font-bold text-gray-800">Email address</h2>
        <p className="mt-0.5 text-xs text-gray-500">Change the email used to sign in.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Current email</label>
          <input type="email" value={email} disabled
            className="mt-1.5 w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400" />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">New email</label>
          <input
            type="email"
            required
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="you@company.com"
            className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Current password</label>
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        )}
        {pending && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              We&apos;ve sent a confirmation link to <span className="font-semibold">{newEmail.trim()}</span>.
              Depending on your workspace&apos;s security settings, you may need to confirm from your current
              inbox too before the change takes effect.
            </span>
          </div>
        )}

        <button type="submit" disabled={saving || !newEmail.trim() || !password}
          className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : 'Change email'}
        </button>
      </form>
    </section>
  )
}
