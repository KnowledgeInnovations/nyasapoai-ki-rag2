'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, Loader2, Mail } from 'lucide-react'
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
      <div className="py-6 text-center font-editorial-sans">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border border-brand/20 bg-brand-light">
          <Mail className="h-8 w-8 text-brand" />
        </div>
        <h3 className="font-editorial text-xl font-normal text-gray-900">Check your inbox</h3>
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
    <div className="space-y-6 font-editorial-sans">
      <div>
        <h2 className="font-editorial text-2xl font-normal text-gray-900">Welcome back</h2>
        <p className="mt-1 text-sm text-gray-500">Sign in to your {tenant?.name ?? 'Nyansa AI'} workspace</p>
      </div>

      {/* Mode tabs */}
      <div className="flex border-b border-gray-200">
        {(['password', 'magic'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setError('') }}
            className={`-mb-px flex-1 border-b-2 py-2.5 text-xs font-semibold transition ${
              mode === m ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {m === 'password' ? 'Password' : 'Email link'}
          </button>
        ))}
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
              className="w-full border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand sm:text-sm"
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
                className="w-full border border-gray-300 bg-white px-4 py-3 pr-11 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand sm:text-sm"
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 bg-brand py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
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
              className="w-full border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand sm:text-sm"
            />
          </div>
          <p className="text-xs text-gray-500">
            We&apos;ll send a secure sign-in link to your inbox. No password needed.
          </p>
          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 bg-brand py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60">
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
    <div className="flex min-h-screen bg-paper">

      {/* ── Left panel — editorial brand ──────────────────────── */}
      <div className="relative hidden lg:flex lg:w-[44%] xl:w-[40%] flex-col border-r border-gray-200 bg-paper p-12">
        <div className="flex flex-1 flex-col">
          {/* Logo */}
          <a href={HOME_URL} className="font-editorial inline-block text-2xl text-gray-900">
            Nyansa<span className="text-brand">·</span>AI
          </a>
          {tenant && (
            <p className="mt-2 text-sm font-semibold text-gray-500 font-editorial-sans">{tenant.name} workspace</p>
          )}

          {/* Hero copy */}
          <div className="mt-auto font-editorial-sans">
            {tenant ? (
              <>
                <h1 className="font-editorial text-4xl font-normal leading-[1.15] text-gray-900">
                  Welcome to<br />
                  <span className="italic text-brand-dark">{tenant.name}</span>
                </h1>
                <p className="mt-5 text-[15px] leading-relaxed text-gray-500">
                  Sign in to ask questions across your organization&apos;s documents and get cited answers in seconds.
                </p>
              </>
            ) : (
              <>
                <h1 className="font-editorial text-4xl font-normal leading-[1.15] text-gray-900">
                  Every answer.<br />
                  Every source.<br />
                  <span className="italic text-brand-dark">Instantly found.</span>
                </h1>
                <p className="mt-5 text-[15px] leading-relaxed text-gray-500">
                  Ask questions across thousands of project files, contracts, and site reports — get cited answers in seconds.
                </p>
              </>
            )}

            <ul className="mt-8 space-y-3.5">
              {FEATURES.map(f => (
                <li key={f} className="flex items-baseline gap-3 text-sm text-gray-600">
                  <span className="font-editorial italic text-brand">—</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-12 text-[11px] text-gray-400 font-editorial-sans">
            © {new Date().getFullYear()} {tenant?.name ?? 'Nyansa AI'}
          </p>
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">

        {/* Mobile-only logo */}
        <a href={HOME_URL} className="font-editorial mb-8 inline-block text-2xl text-gray-900 lg:hidden">
          Nyansa<span className="text-brand">·</span>AI
        </a>

        {/* Card */}
        <div className="w-full max-w-md">
          <div className="border border-gray-200 bg-white p-8 shadow-[0_24px_60px_-30px_rgba(20,20,20,0.25)]">
            <Suspense fallback={
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            }>
              <LoginForm tenant={tenant} />
            </Suspense>
          </div>

          <p className="mt-5 text-center text-xs text-gray-400 font-editorial-sans">
            Powered by{' '}
            <span className="font-semibold text-gray-500">Nyansa AI</span>
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
