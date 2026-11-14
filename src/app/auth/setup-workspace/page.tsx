'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { slugify, validateSubdomainFormat } from '@/lib/tenant'
import { tenantUrl } from '@/lib/domain'
import { PLANS, PLAN_SIGNUP, normalizePlan, type Plan } from '@/lib/plans'

type SubdomainStatus = 'idle' | 'checking' | 'available' | 'unavailable'

export default function SetupWorkspacePage() {
  const router = useRouter()
  const supabase = createClient()

  const [checking, setChecking] = useState(true)
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subdomainEdited, setSubdomainEdited] = useState(false)
  const [subdomainStatus, setSubdomainStatus] = useState<SubdomainStatus>('idle')
  const [subdomainError, setSubdomainError] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Chosen at signup and carried here in the confirmation link's user
  // metadata. Shown, not editable: changing tier is a billing decision, not
  // a form field on the way in.
  const [plan, setPlan] = useState<Plan>('starter')

  // Set when the app layout sent us here from a particular workspace's
  // subdomain. It means "you are signed in, but not a member of that one",
  // which is a different problem from having no workspace at all, and
  // leading with a create-an-organisation form answers the wrong question.
  const [landedOn, setLandedOn] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Authenticated users with no membership land here. If they're not signed
  // in, or already belong to a workspace, send them elsewhere.
  useEffect(() => {
    (async () => {
      // Read first: the PKCE and implicit-grant branches below both rewrite
      // the URL to its pathname, which would throw this away.
      const from = new URL(window.location.href).searchParams.get('workspace')
      if (from) setLandedOn(from)

      // Signup confirmation links use Supabase's PKCE flow format
      // (?code=...), since createBrowserClient() hardcodes flowType: 'pkce'.
      // Letting the client's own background detectSessionInUrl handle this
      // races against our getUser() call below, so we exchange it explicitly
      // and deterministically first.
      const code = new URL(window.location.href).searchParams.get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
        window.history.replaceState(null, '', window.location.pathname)
      } else {
        // Older invite/recovery-style links may still arrive with tokens in
        // the URL hash using the IMPLICIT grant format. See
        // set-password/page.tsx for why we parse the hash and call
        // setSession() directly rather than relying on automatic detection.
        const hashParams = new URLSearchParams(window.location.hash.slice(1))
        const access_token = hashParams.get('access_token')
        const refresh_token = hashParams.get('refresh_token')
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token })
          window.history.replaceState(null, '', window.location.pathname)
        }
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth/login')
        return
      }
      setEmail(user.email ?? '')

      // limit(1) rather than maybeSingle(): someone in two workspaces is
      // emphatically not someone who needs to create their first one, but
      // maybeSingle() errors on two rows and would have sent them here to
      // make a third.
      const { data: memberships } = await supabase
        .from('memberships')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)

      if (memberships && memberships.length > 0) {
        router.replace('/ask')
        return
      }

      const meta = user.user_metadata as {
        workspace_name?: string; workspace_subdomain?: string; workspace_plan?: string
      } | null
      if (meta?.workspace_plan) setPlan(normalizePlan(meta.workspace_plan))
      if (meta?.workspace_name) setName(meta.workspace_name)
      if (meta?.workspace_subdomain) {
        setSubdomain(meta.workspace_subdomain)
        setSubdomainEdited(true)
      }

      setChecking(false)
    })()
  }, [router, supabase])

  // Keep the subdomain in sync with the org name until the user edits it directly.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!subdomainEdited) setSubdomain(slugify(name))
  }, [name, subdomainEdited])

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const formatError = validateSubdomainFormat(subdomain)
    if (!name.trim()) { setError('Organization name is required'); return }
    if (formatError) { setError(formatError); return }
    if (subdomainStatus === 'unavailable') { setError(subdomainError || 'This subdomain is unavailable'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), subdomain, plan }),
      })
      const data = await res.json() as { error?: string; usable?: boolean }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      // Full navigation (not router.push) — the workspace now lives on its own
      // subdomain. The shared cookie domain (see src/lib/domain.ts) keeps the
      // session valid there.
      //
      // A paid plan opens in payment_required, so /ask would bounce them
      // straight to the unavailable page. Send them there directly rather
      // than through a redirect that looks like something went wrong.
      window.location.href = data.usable === false
        ? tenantUrl(subdomain, '/workspace-unavailable')
        : tenantUrl(subdomain, '/ask')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function signOutAndIn() {
    setSigningOut(true)
    await supabase.auth.signOut()
    // Full navigation, so the sign-in page starts from a clean session on
    // whichever host they are on.
    window.location.href = '/auth/login'
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-12 font-editorial-sans">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link href="/" className="font-editorial inline-block text-2xl text-gray-900">
            Nyansa<span className="text-brand">·</span>AI
          </Link>
          <h1 className="font-editorial mt-6 text-2xl font-normal text-gray-900">
            {landedOn && !showCreate ? 'You are not in this workspace' : 'Create your workspace'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {landedOn && !showCreate
              ? <>You opened <span className="font-semibold text-gray-700">{landedOn}</span>, but the account you are signed in as is not a member of it.</>
              : <>This becomes your organization&apos;s private Nyansa AI workspace.</>}
          </p>
        </div>

        {/* The wrong-account case, which used to be indistinguishable from
            having no workspace at all. Someone who has just opened a
            particular workspace's address almost never wants to create a
            second organisation — they want to get into that one, which
            means signing in as somebody who belongs to it, or being
            invited. So that is what is offered first, and creating a
            workspace stays available one click away rather than being the
            only thing on the page. */}
        {landedOn && !showCreate && (
          <div className="mt-6 space-y-4 border border-gray-200 bg-white px-5 py-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Signed in as</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-900 break-all">{email || 'unknown'}</p>
            </div>
            <p className="text-sm text-gray-600">
              To get into <span className="font-semibold">{landedOn}</span>, sign in with an
              account that belongs to it. If you should have access, ask a Senior
              member of that workspace to invite this address.
            </p>
            <button
              onClick={signOutAndIn}
              disabled={signingOut}
              className="w-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand/90 disabled:opacity-60"
            >
              {signingOut ? 'Signing out…' : 'Sign in as someone else'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="w-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Create a new workspace instead
            </button>
          </div>
        )}

        {(!landedOn || showCreate) && (
          <>
          {/* What they picked at signup, so the plan is not a surprise on the
              other side. A paid plan says plainly that it needs activating
              rather than letting them discover it at the door. */}
          <div className="mt-6 flex items-start justify-between gap-3 border border-gray-200 bg-white px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Plan</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-900">{PLANS[plan].label}</p>
            </div>
            <p className="max-w-[60%] text-right text-xs leading-relaxed text-gray-500">
              {PLAN_SIGNUP[plan].initialStatus === 'active'
                ? 'Ready to use as soon as you finish here.'
                : 'Your workspace will be created now and opens once we have activated it.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4 border border-gray-200 bg-white p-8 shadow-[0_24px_60px_-30px_rgba(20,20,20,0.25)]">
            {error && (
              <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Organization name</label>
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                className="mt-1 w-full border border-gray-300 px-4 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Workspace subdomain</label>
              <div className="mt-1 flex items-center border border-gray-300 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                <input
                  type="text"
                  required
                  value={subdomain}
                  onChange={(e) => { setSubdomain(e.target.value.toLowerCase()); setSubdomainEdited(true) }}
                  placeholder="acme-corp"
                  className="w-full bg-transparent px-4 py-2.5 text-sm outline-none"
                />
                <span className="shrink-0 px-3 text-sm text-gray-400">.nyansaai.com</span>
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
              disabled={submitting || subdomainStatus === 'checking'}
              className="w-full bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {submitting ? 'Creating workspace…' : 'Create workspace'}
            </button>
          </form>
          </>
        )}
      </div>
    </div>
  )
}
