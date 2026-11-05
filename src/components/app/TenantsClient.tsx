'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Plus, Loader2, CheckCircle2, Copy, X, Search, ChevronRight, ChevronDown } from 'lucide-react'
import { slugify, validateSubdomainFormat } from '@/lib/tenant'
import { STATUS_LABELS, type WorkspaceStatus } from '@/lib/workspaceStatus'
import { cn } from '@/lib/utils'

export interface TenantMember {
  id:    string
  email: string
  name:  string | null
  role:  string
}

export interface TenantRow {
  id:         string
  name:       string
  subdomain:  string
  plan:       string
  status:     WorkspaceStatus
  createdAt:  string
  memberCount: number
  members:    TenantMember[]
  isPlatform: boolean
  queryCount30d: number
  documentCount30d: number
  estimatedMonthlyCostUsd: number
}

interface Props {
  tenants: TenantRow[]
}

/** How many members a workspace shows before asking to be expanded. */
const MEMBER_PREVIEW = 5

const PLANS = ['starter', 'professional', 'enterprise'] as const
const STATUSES: WorkspaceStatus[] = ['active', 'payment_required', 'past_due', 'pending', 'suspended']

// Status carries consequence — a suspended workspace is shut to its members —
// so it is coloured rather than left as one more grey dropdown.
const STATUS_TONE: Record<WorkspaceStatus, string> = {
  active:           'border-emerald-200 bg-emerald-50 text-emerald-700',
  payment_required: 'border-amber-200 bg-amber-50 text-amber-700',
  past_due:         'border-amber-200 bg-amber-50 text-amber-700',
  pending:          'border-gray-200 bg-gray-50 text-gray-600',
  suspended:        'border-red-200 bg-red-50 text-red-700',
}

export default function TenantsClient({ tenants }: Props) {
  const router = useRouter()
  const [list, setList] = useState(tenants)
  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  /* -- finding a workspace, or a person -----------------------
   * One box searches both, because the question is usually "which workspace
   * is this person in?" and the answer is otherwise a manual scan of every
   * tenant. A member match pulls its workspace into the results and shows
   * only the people who matched; a workspace match shows the workspace with
   * its member list collapsed as usual.
   */
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState<Set<string>>(new Set())

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!q) return list.map(t => ({ t, matched: null as TenantMember[] | null }))
    const out: { t: TenantRow; matched: TenantMember[] | null }[] = []
    for (const t of list) {
      const hits = t.members.filter(m =>
        m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
      if (hits.length) { out.push({ t, matched: hits }); continue }
      if (t.name.toLowerCase().includes(q) || t.subdomain.toLowerCase().includes(q)) {
        out.push({ t, matched: null })
      }
    }
    return out
  }, [list, q])

  const memberHits = visible.reduce((acc, v) => acc + (v.matched?.length ?? 0), 0)

  /* ── creating a workspace ─────────────────────────────────
   * The public signup route cannot do this: it refuses anyone who already
   * has a workspace, and it will not grant a plan that is not self-serve.
   * So without this form an Enterprise sale ended in someone editing the
   * database by hand. */
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subdomainEdited, setSubdomainEdited] = useState(false)
  const [plan, setPlan] = useState<string>('enterprise')
  const [status, setStatus] = useState<WorkspaceStatus>('active')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const [invite, setInvite] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [created, setCreated] = useState<{
    name: string; subdomain: string; email: string
    temporaryPassword: string | null; invited: boolean
  } | null>(null)

  function resetForm() {
    setName(''); setSubdomain(''); setSubdomainEdited(false)
    setPlan('enterprise'); setStatus('active')
    setAdminEmail(''); setAdminName(''); setInvite(false)
    setCreateError('')
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError('')
    const slug = (subdomain || slugify(name)).trim().toLowerCase()
    const formatError = validateSubdomainFormat(slug)
    if (!name.trim()) { setCreateError('A workspace name is required.'); return }
    if (formatError)  { setCreateError(formatError); return }

    setCreating(true)
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), subdomain: slug, plan, status,
          adminEmail: adminEmail.trim(), adminName: adminName.trim(), invite,
        }),
      })
      const data = await res.json() as {
        error?: string
        tenant?: { id: string; name: string; subdomain: string; plan: string; status: string }
        admin?: { email: string; temporaryPassword: string | null; invited: boolean }
      }
      if (!res.ok || !data.tenant) {
        setCreateError(data.error ?? 'Could not create the workspace.')
        return
      }
      setCreated({
        name: data.tenant.name,
        subdomain: data.tenant.subdomain,
        email: data.admin?.email ?? adminEmail.trim(),
        temporaryPassword: data.admin?.temporaryPassword ?? null,
        invited: data.admin?.invited ?? false,
      })
      setOpen(false)
      resetForm()
      router.refresh()
    } catch {
      setCreateError('Could not create the workspace.')
    } finally {
      setCreating(false)
    }
  }

  /* ── changing a plan or status ────────────────────────── */
  async function patchTenant(t: TenantRow, change: { plan?: string; status?: WorkspaceStatus }) {
    setBusyId(t.id)
    setRowError(null)
    // Optimistic, then corrected from the response — the dropdown should not
    // sit on the old value while the request is in flight.
    const previous = { plan: t.plan, status: t.status }
    setList(prev => prev.map(x => x.id === t.id ? { ...x, ...change } : x))
    try {
      const res = await fetch(`/api/tenants/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const data = await res.json() as { error?: string; tenant?: { plan: string; status: string } }
      if (!res.ok || !data.tenant) {
        setList(prev => prev.map(x => x.id === t.id ? { ...x, ...previous } : x))
        setRowError({ id: t.id, message: data.error ?? 'Could not update the workspace.' })
        return
      }
      router.refresh()
    } catch {
      setList(prev => prev.map(x => x.id === t.id ? { ...x, ...previous } : x))
      setRowError({ id: t.id, message: 'Could not update the workspace.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/tenants/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        setList(prev => prev.filter(t => t.id !== deleteTarget.id))
        setDeleteTarget(null)
        router.refresh()
      } else {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Failed to delete tenant')
      }
    } catch {
      setError('Failed to delete tenant')
    }
    setDeleting(false)
  }

  const selectClass = 'border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand/20 disabled:opacity-50'
  const fieldClass = 'mt-1.5 w-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10'
  const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-gray-500'

  return (
    <>
      {/* ── the credentials, shown once ───────────────────── */}
      {created && (
        <section className="border border-emerald-200 bg-emerald-50/60 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-gray-900">
                {created.name} is ready at {created.subdomain}.nyansaai.com
              </h2>
              {created.invited ? (
                <p className="mt-2 text-sm text-gray-600">
                  An invitation has been sent to{' '}
                  <span className="font-semibold text-gray-900">{created.email}</span> to set
                  their own password.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-gray-600">
                    Sign-in details for{' '}
                    <span className="font-semibold text-gray-900">{created.email}</span>. This
                    password is shown once and is not stored anywhere — copy it now.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <code className="border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900">
                      {created.temporaryPassword}
                    </code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(created.temporaryPassword ?? '')}
                      className="flex items-center gap-1.5 border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Ask them to change it after their first sign-in.
                  </p>
                </>
              )}
            </div>
            <button onClick={() => setCreated(null)} className="shrink-0 text-gray-400 transition hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ── create ────────────────────────────────────────── */}
      <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Create a workspace</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              For setting one up on a customer&apos;s behalf. They can also sign up themselves on any plan.
            </p>
          </div>
          <button
            onClick={() => { setOpen(o => !o); setCreateError('') }}
            className="flex shrink-0 items-center gap-2 bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> {open ? 'Cancel' : 'New workspace'}
          </button>
        </div>

        {open && (
          <form onSubmit={handleCreate} className="space-y-5 p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Organisation</label>
                <input
                  value={name}
                  onChange={e => {
                    setName(e.target.value)
                    if (!subdomainEdited) setSubdomain(slugify(e.target.value))
                  }}
                  placeholder="Devtraco Group"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>Subdomain</label>
                <div className="mt-1.5 flex items-center">
                  <input
                    value={subdomain}
                    onChange={e => { setSubdomainEdited(true); setSubdomain(e.target.value.toLowerCase()) }}
                    placeholder="devtraco"
                    className="w-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                  />
                  <span className="shrink-0 border border-l-0 border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">
                    .nyansaai.com
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Plan</label>
                <select value={plan} onChange={e => setPlan(e.target.value)} className={fieldClass}>
                  {PLANS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as WorkspaceStatus)} className={fieldClass}>
                  {STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                </select>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={labelClass}>First Senior user — email</label>
                <input
                  type="email" required value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  placeholder="admin@theircompany.com"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>Their name (optional)</label>
                <input
                  value={adminName}
                  onChange={e => setAdminName(e.target.value)}
                  placeholder="Ama Mensah"
                  className={fieldClass}
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-sm text-gray-600">
              <input
                type="checkbox" checked={invite}
                onChange={e => setInvite(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Email them an invitation instead of generating a password.
                <span className="mt-0.5 block text-xs text-gray-400">
                  Leave this off to get a temporary password you can hand over yourself —
                  safer when email delivery is not certain.
                </span>
              </span>
            </label>

            {createError && (
              <p className="border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{createError}</p>
            )}

            <button
              type="submit" disabled={creating}
              className="flex items-center gap-2 bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create workspace'}
            </button>
          </form>
        )}
      </section>

      {/* ── the list ──────────────────────────────────────── */}
      <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Workspaces</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {q
                  ? `${visible.length} ${visible.length === 1 ? 'workspace' : 'workspaces'}`
                    + (memberHits ? ` - ${memberHits} matching ${memberHits === 1 ? 'member' : 'members'}` : '')
                  : `${list.length} ${list.length === 1 ? 'tenant' : 'tenants'} total.`}
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search workspace or member..."
                aria-label="Search workspaces and members"
                className="w-full border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 transition hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {visible.map(({ t, matched }) => {
            // A member match is its own reason to show the list, so a search
            // does not also require a click to see what matched.
            const isOpen = matched !== null || expanded.has(t.id)
            const source = matched ?? t.members
            const capped = !matched && !showAll.has(t.id)
            const shown  = capped ? source.slice(0, MEMBER_PREVIEW) : source
            const hidden = source.length - shown.length
            return (
            <div key={t.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{t.name}</p>
                  <p className="truncate text-xs text-gray-500">{t.subdomain}.nyansaai.com</p>
                </div>

                <select
                  value={t.plan}
                  disabled={t.isPlatform || busyId === t.id}
                  onChange={e => patchTenant(t, { plan: e.target.value })}
                  title="Plan"
                  className={cn(selectClass, 'w-32 shrink-0 uppercase tracking-wide')}
                >
                  {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <select
                  value={t.status}
                  disabled={t.isPlatform || busyId === t.id}
                  onChange={e => patchTenant(t, { status: e.target.value as WorkspaceStatus })}
                  title="Workspace status"
                  className={cn(selectClass, 'w-36 shrink-0 font-semibold', STATUS_TONE[t.status])}
                >
                  {STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                </select>

                <button
                  onClick={() => toggle(expanded, t.id, setExpanded)}
                  aria-expanded={isOpen}
                  title={t.memberCount ? 'Show members' : 'No members yet'}
                  disabled={!t.memberCount}
                  className="flex w-24 shrink-0 items-center justify-end gap-1 text-right text-sm text-gray-500 transition hover:text-gray-900 disabled:hover:text-gray-500"
                >
                  {t.memberCount
                    ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)
                    : null}
                  {t.memberCount} {t.memberCount === 1 ? 'member' : 'members'}
                </button>
                <div className="w-32 shrink-0 text-right" title={`Estimated AI cost: ${t.queryCount30d} questions + ${t.documentCount30d} documents uploaded in the last 30 days. Modeled from average per-call cost, not measured billing.`}>
                  <p className="text-sm font-semibold text-gray-700">~${t.estimatedMonthlyCostUsd.toFixed(2)}<span className="text-[10px] font-normal text-gray-400">/mo</span></p>
                  <p className="text-[10px] text-gray-400">{t.queryCount30d} questions · {t.documentCount30d} docs</p>
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-gray-400">
                  {new Date(t.createdAt).toLocaleDateString()}
                </span>
                {!t.isPlatform && (
                  <button
                    onClick={() => setDeleteTarget(t)}
                    title="Delete tenant"
                    className="shrink-0 border border-gray-200 p-2 text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {rowError?.id === t.id && (
                <p className="mt-2 text-xs text-red-600">{rowError.message}</p>
              )}

              {isOpen && (
                <div className="mt-3 border-l-2 border-gray-100 pl-4">
                  {source.length === 0 ? (
                    <p className="py-1 text-xs text-gray-400">
                      No member records to show.
                      {t.memberCount > 0 && ' The count above comes from the database; these rows are missing a user record.'}
                    </p>
                  ) : (
                    <>
                      <ul className="divide-y divide-gray-50">
                        {shown.map(m => (
                          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                              {m.name?.trim() || <span className="text-gray-400">(no name)</span>}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{m.email}</span>
                            <span className={cn(
                              'shrink-0 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              m.role === 'senior' ? 'border-brand/20 bg-brand/5 text-brand'
                                : m.role === 'middle' ? 'border-gray-200 bg-gray-50 text-gray-600'
                                  : 'border-gray-200 bg-white text-gray-500',
                            )}>
                              {m.role}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {hidden > 0 && (
                        <button
                          onClick={() => toggle(showAll, t.id, setShowAll)}
                          className="mt-1.5 text-xs font-semibold text-brand transition hover:underline"
                        >
                          Show {hidden} more
                        </button>
                      )}
                      {!capped && !matched && source.length > MEMBER_PREVIEW && (
                        <button
                          onClick={() => toggle(showAll, t.id, setShowAll)}
                          className="mt-1.5 text-xs font-semibold text-gray-500 transition hover:underline"
                        >
                          Show fewer
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            )
          })}
          {q && visible.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-gray-500">
              Nothing matches that search.
            </p>
          )}
        </div>
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm  border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center  bg-red-50 border border-red-200">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">Delete {deleteTarget.name}?</h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              This permanently deletes the workspace, its members, documents and all associated data. This cannot be undone.
            </p>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              To close a workspace without losing anything, set its status to{' '}
              <span className="font-semibold text-gray-700">Suspended</span> instead — access stops, the data stays.
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1  border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1  bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
