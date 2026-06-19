'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { slugify, validateSubdomainFormat } from '@/lib/tenant'
import { tenantUrl } from '@/lib/domain'

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

  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Authenticated users with no membership land here. If they're not signed
  // in, or already belong to a workspace, send them elsewhere.
  useEffect(() => {
    (async () => {
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

      const { data: membership } = await supabase
        .from('memberships')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (membership) {
        router.replace('/ask')
        return
      }

      const meta = user.user_metadata as { workspace_name?: string; workspace_subdomain?: string } | null
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
        body: JSON.stringify({ name: name.trim(), subdomain }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      // Full navigation (not router.push) — the workspace now lives on its own
      // subdomain. The shared cookie domain (see src/lib/domain.ts) keeps the
      // session valid there.
      window.location.href = tenantUrl(subdomain, '/ask')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-brand">Nyansapo</span>
            <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">AI</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">Create your workspace</h1>
          <p className="mt-2 text-sm text-gray-500">
            This becomes your organization&apos;s private NyasapoAI workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
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
            disabled={submitting || subdomainStatus === 'checking'}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {submitting ? 'Creating workspace…' : 'Create workspace'}
          </button>
        </form>
      </div>
    </div>
  )
}
