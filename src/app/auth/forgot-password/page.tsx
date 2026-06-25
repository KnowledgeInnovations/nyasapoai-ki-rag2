'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, ArrowLeft, Loader2, Mail } from 'lucide-react'

export default function ForgotPasswordPage() {
  const supabase = createClient()

  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // resetPasswordForEmail() never reports whether the address is
      // registered — always show the same "check your inbox" confirmation
      // regardless of the result, so this page can't be used to enumerate
      // which emails have accounts.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/set-password`,
      })
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-gray-200/80 bg-white p-8 shadow-2xl shadow-black/5">
          {sent ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
                <Mail className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-extrabold text-gray-900">Check your inbox</h2>
              <p className="text-sm text-gray-500">
                If an account exists for <span className="font-semibold text-gray-800">{email}</span>,
                we&apos;ve sent a link to reset your password.
              </p>
              <a href="/auth/login" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </a>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-extrabold text-gray-900">Forgot your password?</h2>
                <p className="mt-1 text-sm text-gray-500">Enter your work email and we&apos;ll send you a reset link.</p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Work email</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 sm:text-sm"
                  />
                </div>

                <button type="submit" disabled={loading || !email.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-60">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending link…</>
                    : <>Send reset link <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>

              <a href="/auth/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-gray-700">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
