'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RefreshCw, Search } from 'lucide-react'
import { describeAudit, type AuditRow } from '@/lib/audit'
import { cn } from '@/lib/utils'

interface Workspace { id: string; name: string }

interface Props {
  /** Other workspaces this reader may inspect. Platform admins only. */
  workspaces?: Workspace[]
  currentTenantId: string
  currentTenantName: string
}

/** What kind of thing happened, for colour and filtering. */
function family(action: string): 'document' | 'user' | 'workspace' | 'other' {
  if (action.startsWith('document.')) return 'document'
  if (action.startsWith('user.')) return 'user'
  if (action.startsWith('workspace.')) return 'workspace'
  return 'other'
}

const TONE: Record<string, string> = {
  document:  'border-brand/20 bg-brand-light text-brand',
  user:      'border-emerald-200 bg-emerald-50 text-emerald-700',
  workspace: 'border-amber-200 bg-amber-50 text-amber-700',
  other:     'border-gray-200 bg-gray-50 text-gray-600',
}

function initialsFor(name: string, email: string): string {
  const t = name.trim()
  if (t) {
    const w = t.split(/\s+/).filter(Boolean)
    return w.length === 1 ? w[0].slice(0, 2).toUpperCase() : (w[0][0] + w[1][0]).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

/**
 * Timestamps are formatted on the client only. The first render happens with
 * no entries, so there is nothing in the server HTML for a different locale
 * or timezone to disagree with.
 */
function stamp(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

export default function AuditLogClient({ workspaces, currentTenantId, currentTenantName }: Props) {
  const [tenantId, setTenantId] = useState(currentTenantId)
  const [entries, setEntries] = useState<AuditRow[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  const fetchPage = useCallback(async (before: string | null) => {
    const params = new URLSearchParams()
    if (tenantId !== currentTenantId) params.set('tenantId', tenantId)
    if (before) params.set('before', before)
    const res = await fetch(`/api/audit?${params}`)
    const data = await res.json() as { entries?: AuditRow[]; nextBefore?: string | null; error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Could not load the audit log.')
    return data
  }, [tenantId, currentTenantId])

  // The first page, and again whenever the workspace changes. Nothing is set
  // before the first await, so this does not update state during the effect
  // itself — the buttons below do their own state handling, which is an
  // event and therefore unconstrained.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchPage(null)
        if (cancelled) return
        setEntries(data.entries ?? [])
        setNextBefore(data.nextBefore ?? null)
        setError('')
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fetchPage])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchPage(null)
      setEntries(data.entries ?? [])
      setNextBefore(data.nextBefore ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadOlder() {
    if (!nextBefore) return
    setLoadingMore(true)
    setError('')
    try {
      const data = await fetchPage(nextBefore)
      setEntries(prev => [...prev, ...(data.entries ?? [])])
      setNextBefore(data.nextBefore ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  // Filtering what is already loaded, not a server search: this is for
  // scanning a page, and pretending otherwise would hide older entries that
  // match but have not been fetched.
  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? entries.filter(e =>
        describeAudit(e).toLowerCase().includes(needle) ||
        (e.actor?.email ?? '').toLowerCase().includes(needle) ||
        (e.actor?.name ?? '').toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle))
    : entries

  return (
    <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-800">Audit log</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Who did what in {workspaces?.length ? 'this workspace' : currentTenantName}, newest first.
            Visible to Senior users only.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workspaces && workspaces.length > 0 && (
            <select
              value={tenantId}
              onChange={e => { setEntries([]); setLoading(true); setTenantId(e.target.value) }}
              title="Workspace"
              className="border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none transition focus:border-brand"
            >
              <option value={currentTenantId}>{currentTenantName}</option>
              {workspaces.filter(w => w.id !== currentTenantId).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            title="Refresh"
            className="flex items-center gap-1.5 border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="border-b border-gray-100 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter what is shown — a name, an email, a document"
              className="w-full border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="m-6 border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : shown.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <History className="mx-auto h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            {entries.length === 0
              ? 'Nothing recorded yet. Uploads, invites, role changes and workspace settings will appear here.'
              : 'Nothing loaded matches that.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {shown.map(e => {
            const f = family(e.action)
            return (
              <div key={e.id} className="flex items-start gap-4 px-6 py-4">
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center border text-[11px] font-bold',
                  e.actor ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-gray-200 bg-white text-gray-400',
                )}>
                  {e.actor ? initialsFor(e.actor.name, e.actor.email) : 'SYS'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{describeAudit(e)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {e.actor
                      ? <>{e.actor.name || e.actor.email}{e.actor.name && <span className="text-gray-400"> · {e.actor.email}</span>}</>
                      : <span className="text-gray-400">Nyansa AI — automatic</span>}
                  </p>
                </div>
                <span className={cn(
                  'hidden shrink-0 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-block',
                  TONE[f],
                )}>
                  {f}
                </span>
                <span className="w-40 shrink-0 text-right text-xs tabular-nums text-gray-400">
                  {stamp(e.createdAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {nextBefore && !loading && (
        <div className="border-t border-gray-100 px-6 py-4 text-center">
          <button
            onClick={loadOlder}
            disabled={loadingMore}
            className="border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older entries'}
          </button>
        </div>
      )}
    </section>
  )
}
