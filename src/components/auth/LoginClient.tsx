'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, CheckCircle2, Loader2, Mail } from 'lucide-react'
import TotpChallengeForm from './TotpChallengeForm'
import EmailOtpChallengeForm from './EmailOtpChallengeForm'

const HOME_URL = '/'

const FEATURES = [
  'Ask anything across all your project files and contracts',
  'Every answer cites the exact source document',
  'Role-based access — executives to site managers',
]

export interface SubdomainTenant {
  id: string
  name: string
  subdomain: string
}

interface FormProps {
  tenant: SubdomainTenant | null
}

function LoginForm({ tenant }: FormProps) {
  const router = useRouter()

  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [showPwd, setShowPwd]       = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [magicSent, setMagicSent]   = useState(false)
  const [mode, setMode]             = useState<'password' | 'magic'>('password')
  const [needsMfa, setNeedsMfa]     = useState(false)
  const [needsEmailMfa, setNeedsEmailMfa] = useState(false)

  const supabase = createClient()

  // Shared by the direct-success path and the post-MFA-verification path —
  // signInWithPassword() already returns a valid (aal1) session, but a user
  // with a verified authenticator factor isn't actually done until they've
  // stepped up to aal2 (handled by the caller before this runs).
  async function finishLogin() {
    if (tenant) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: membership } = await supabase
        .from('memberships')
        .select('tenant_id')
        .eq('user_id', user!.id)
        .maybeSingle()

      if (membership?.tenant_id !== tenant.id) {
        await supabase.auth.signOut()
        setError(`This account isn't part of the ${tenant.name} workspace.`)
        return
      }
    }
    router.push('/ask')
  }

  async function handlePassword(e: React.SyntheticEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); return }

      // Email-based 2FA is a custom mechanism Supabase's own aal system has
      // no knowledge of (see emailMfa.ts) — checked via user_metadata, set
      // when the user chose "Email" over an authenticator app in Settings.
      // Mutually exclusive with TOTP, so only one of these two branches
      // should ever apply for a given account.
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.user_metadata?.email_mfa_enabled) {
        setNeedsEmailMfa(true)
        return
      }

      // A verified TOTP factor means nextLevel is aal2 while the session
      // signInWithPassword just created is only aal1 — the user isn't
      // actually signed in yet until they clear that step-up.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        setNeedsMfa(true)
        return
      }

      await finishLogin()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMagic(e: React.SyntheticEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/ask` },
      })
      if (error) setError(error.message)
      else setMagicSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (needsMfa) {
    return (
      <TotpChallengeForm
        onVerified={finishLogin}
        onCancel={async () => { await supabase.auth.signOut(); setNeedsMfa(false); setPassword('') }}
      />
    )
  }

  if (needsEmailMfa) {
    return (
      <EmailOtpChallengeForm
        email={email}
        onVerified={finishLogin}
        onCancel={async () => { await supabase.auth.signOut(); setNeedsEmailMfa(false); setPassword('') }}
      />
    )
  }

  if (magicSent) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
          <Mail className="h-8 w-8 text-emerald-600" />
        </div>
        <h3 className="text-lg font-bold text-gray-900">Check your inbox</h3>
        <p className="mt-2 text-sm text-gray-500">
          We sent a secure sign-in link to
          <br />
          <span className="font-semibold text-gray-800">{email}</span>
        </p>
        <button onClick={() => { setMagicSent(false); setMode('password') }}
          className="mt-6 text-sm font-medium text-brand transition hover:text-brand-dark">
          ← Back to sign in
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900">Welcome back</h2>
        <p className="mt-1 text-sm text-gray-500">Sign in to your {tenant?.name ?? 'NyasapoAI'} workspace</p>
      </div>

      {/* Mode tabs */}
      <div className="flex rounded-xl border border-gray-200 bg-gray-100 p-1">
        {(['password', 'magic'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setError('') }}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {m === 'password' ? 'Password' : 'Email link'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === 'password' ? (
        <form onSubmit={handlePassword} className="space-y-4">
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-gray-700">Password</label>
              <a href="/auth/forgot-password" className="text-xs font-medium text-brand transition hover:text-brand-dark">
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                required
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
          </div>

          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-60">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
              : <>Sign in <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>
      ) : (
        <form onSubmit={handleMagic} className="space-y-4">
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
          <p className="text-xs text-gray-500">
            We&apos;ll send a secure sign-in link to your inbox. No password needed.
          </p>
          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-60">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending link…</>
              : <><Mail className="h-4 w-4" /> Send sign-in link</>}
          </button>
        </form>
      )}
    </div>
  )
}

interface Props {
  tenant: SubdomainTenant | null
}

export default function LoginClient({ tenant }: Props) {
  return (
    <div className="flex min-h-screen">

      {/* ── Left panel — light brand ─────────────────────────── */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-[44%] xl:w-[40%] flex-col bg-brand-light border-r border-brand/10 p-12">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
          <div className="absolute bottom-1/4 left-0 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col">
          {/* Logo */}
          <a href={HOME_URL} className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-brand">Nyansapo</span>
            <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
          </a>
          {tenant && (
            <p className="mt-2 text-sm font-semibold text-gray-500">{tenant.name} workspace</p>
          )}

          {/* Hero copy */}
          <div className="mt-auto">
            {tenant ? (
              <>
                <h1 className="text-4xl font-extrabold leading-[1.15] text-gray-900">
                  Welcome to<br />
                  <span className="bg-gradient-to-r from-brand to-gold bg-clip-text text-transparent">
                    {tenant.name}
                  </span>
                </h1>
                <p className="mt-5 text-[15px] leading-relaxed text-gray-500">
                  Sign in to ask questions across your organization&apos;s documents and get cited answers in seconds.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-4xl font-extrabold leading-[1.15] text-gray-900">
                  Every answer.<br />
                  Every source.<br />
                  <span className="bg-gradient-to-r from-brand to-gold bg-clip-text text-transparent">
                    Instantly found.
                  </span>
                </h1>
                <p className="mt-5 text-[15px] leading-relaxed text-gray-500">
                  Ask questions across thousands of project files, contracts, and site reports — get cited answers in seconds.
                </p>
              </>
            )}

            <ul className="mt-8 space-y-3.5">
              {FEATURES.map(f => (
                <li key={f} className="flex items-start gap-3 text-sm text-gray-600">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand/60" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-12 text-[11px] text-gray-400">
            © {new Date().getFullYear()} {tenant?.name ?? 'NyasapoAI'}
          </p>
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#f8f9fb] px-6 py-12">

        {/* Mobile-only logo */}
        <a href={HOME_URL} className="mb-8 inline-flex items-center gap-2 lg:hidden">
          <span className="text-2xl font-bold text-brand">Nyansapo</span>
          <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
        </a>

        {/* Card */}
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-gray-200/80 bg-white p-8 shadow-2xl shadow-black/5">
            <Suspense fallback={
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            }>
              <LoginForm tenant={tenant} />
            </Suspense>
          </div>

          <p className="mt-5 text-center text-xs text-gray-400">
            Powered by{' '}
            <span className="font-semibold text-gray-500">NyasapoAI</span>
            {' · '}
            <a href={HOME_URL} className="text-brand hover:underline transition">
              Back to home
            </a>
          </p>
        </div>
      </div>

    </div>
  )
}
