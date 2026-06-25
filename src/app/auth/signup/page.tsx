'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createImplicitClient } from '@/lib/supabase/implicitClient'
import { slugify, validateSubdomainFormat } from '@/lib/tenant'

type SubdomainStatus = 'idle' | 'checking' | 'available' | 'unavailable'
type Step = 'account' | 'workspace'

export default function SignupPage() {
  const [step, setStep] = useState<Step>('account')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [orgName, setOrgName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subdomainEdited, setSubdomainEdited] = useState(false)
  const [subdomainStatus, setSubdomainStatus] = useState<SubdomainStatus>('idle')
  const [subdomainError, setSubdomainError] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Implicit flow, not the app's normal PKCE client: the confirmation link
  // is delivered by email and realistically opened on a different
  // browser/device than this one — see src/lib/supabase/implicitClient.ts.
  const supabase = createImplicitClient()
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleAccountNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setStep('workspace')
  }

  // Keep the subdomain in sync with the org name until the user edits it directly.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!subdomainEdited) setSubdomain(slugify(orgName))
  }, [orgName, subdomainEdited])

  // Debounced live availability check.
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current)

    if (!subdomain) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubdomainStatus('idle')
      setSubdomainError('')
      return
    }

    const formatError = validateSubdomainFormat(subdomain)
    if (formatError) {
      setSubdomainStatus('unavailable')
      setSubdomainError(formatError)
      return
    }

    setSubdomainStatus('checking')
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenants/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`)
        const data = await res.json() as { available: boolean; error?: string }
        setSubdomainStatus(data.available ? 'available' : 'unavailable')
        setSubdomainError(data.error ?? '')
      } catch {
        setSubdomainStatus('idle')
      }
    }, 400)

    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [subdomain])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const formatError = validateSubdomainFormat(subdomain)
    if (!orgName.trim()) { setError('Organization name is required'); return }
    if (formatError) { setError(formatError); return }
    if (subdomainStatus === 'unavailable') { setError(subdomainError || 'This subdomain is unavailable'); return }

    setLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name, workspace_name: orgName.trim(), workspace_subdomain: subdomain },
          emailRedirectTo: `${window.location.origin}/auth/setup-workspace`,
        },
      })
      if (error) setError(error.message)
      else setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-brand">Nyansapo</span>
            <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            {done ? 'Create your account' : step === 'account' ? 'Create your account' : 'Create your workspace'}
          </h1>
          {!done && (
            <p className="mt-2 text-sm text-gray-500">
              {step === 'account' ? (
                <>Already have an account?{' '}
                  <Link href="/auth/login" className="font-medium text-brand hover:underline">Sign in</Link>
                </>
              ) : (
                'This becomes your organization’s private NyasapoAI workspace.'
              )}
            </p>
          )}
        </div>

        {done ? (
          <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="font-medium text-green-800">Check your email</p>
            <p className="mt-1 text-sm text-green-600">We sent a confirmation link to <strong>{email}</strong></p>
          </div>
        ) : step === 'account' ? (
          <form onSubmit={handleAccountNext} className="mt-8 space-y-4">
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
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              Continue
            </button>

            <p className="text-center text-xs text-gray-400">
              By signing up you agree to our{' '}
              <Link href="/terms" className="underline">Terms</Link> and{' '}
              <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="mt-8 space-y-4">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Organization name</label>
              <input
                type="text"
                required
                autoFocus
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Corp"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Workspace subdomain</label>
              <div className="mt-1 flex items-center rounded-xl border border-gray-300 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-light">
                <input
                  type="text"
                  required
                  value={subdomain}
                  onChange={(e) => { setSubdomain(e.target.value.toLowerCase()); setSubdomainEdited(true) }}
                  placeholder="acme-corp"
                  className="w-full rounded-l-xl bg-transparent px-4 py-2.5 text-sm outline-none"
                />
                <span className="shrink-0 px-3 text-sm text-gray-400">.nyasapoai.com</span>
              </div>
              {subdomainStatus === 'checking' && (
                <p className="mt-1 text-xs text-gray-400">Checking availability…</p>
              )}
              {subdomainStatus === 'available' && (
                <p className="mt-1 text-xs text-green-600">Available</p>
              )}
              {subdomainStatus === 'unavailable' && subdomainError && (
                <p className="mt-1 text-xs text-red-600">{subdomainError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || subdomainStatus === 'checking'}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => setStep('account')}
              className="w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
