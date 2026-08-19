'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Loader2, Eye, EyeOff } from 'lucide-react'

interface Props {
  email: string
}

export default function PasswordSettings({ email }: Props) {
  const supabase = createClient()

  const [current, setCurrent]   = useState('')
  const [next, setNext]         = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaved(false)

    if (next.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (next !== confirm) { setError('New passwords do not match.'); return }

    setSaving(true)
    try {
      // Supabase's updateUser() doesn't ask for the current password before
      // changing it — anyone with a live session could otherwise silently
      // change it out from under the real owner. Re-authenticating with the
      // current password first (it's the same account, so this doesn't
      // disturb the existing session) confirms it's really them.
      //
      // Look up the live email instead of trusting the `email` prop: it's
      // passed down from the server-rendered page load, so right after a
      // confirmed email change it can still be the old address until the
      // page is hard-refreshed — reauthenticating against a stale email
      // fails and gets misreported as "wrong password."
      const { data: liveUser } = await supabase.auth.getUser()
      const liveEmail = liveUser.user?.email ?? email
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: liveEmail, password: current })
      if (reauthErr) { setError('Current password is incorrect.'); return }

      const { error: updateErr } = await supabase.auth.updateUser({ password: next })
      if (updateErr) { setError(updateErr.message); return }

      setCurrent(''); setNext(''); setConfirm('')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="overflow-hidden  border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h2 className="text-sm font-bold text-gray-800">Password</h2>
        <p className="mt-0.5 text-xs text-gray-500">Change the password used to sign in.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Current password</label>
          <input
            type={showPwd ? 'text' : 'password'}
            required
            value={current}
            onChange={e => setCurrent(e.target.value)}
            className="mt-1.5 w-full  border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">New password</label>
          <div className="relative mt-1.5">
            <input
              type={showPwd ? 'text' : 'password'}
              required
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full  border border-gray-200 bg-white px-4 py-2.5 pr-11 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
            />
            <button type="button" onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Confirm new password</label>
          <input
            type={showPwd ? 'text' : 'password'}
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="mt-1.5 w-full  border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>

        {error && (
          <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2  border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Password updated successfully.
          </div>
        )}

        <button type="submit" disabled={saving || !current || !next || !confirm}
          className="flex items-center gap-2  bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</> : 'Update password'}
        </button>
      </form>
    </section>
  )
}
