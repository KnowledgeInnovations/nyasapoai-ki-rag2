'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-brand">Nyansapo</span>
            <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="mt-2 text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/auth/login" className="font-medium text-brand hover:underline">Sign in</Link>
          </p>
        </div>

        {done ? (
          <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="font-medium text-green-800">Check your email</p>
            <p className="mt-1 text-sm text-green-600">We sent a confirmation link to <strong>{email}</strong></p>
          </div>
        ) : (
          <form onSubmit={handleSignup} className="mt-8 space-y-4">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Full name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Work email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              />
              <p className="mt-1 text-xs text-gray-400">Minimum 8 characters</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>

            <p className="text-center text-xs text-gray-400">
              By signing up you agree to our{' '}
              <Link href="/terms" className="underline">Terms</Link> and{' '}
              <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
