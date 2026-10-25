'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  MessageSquare, FileText, LayoutDashboard, Settings, Building2,
  ChevronLeft, ChevronRight, X, Plus, History, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { canAccessDashboards, normalizeRole } from '@/lib/roles'

interface HistoryItem {
  id: string
  query: string
  response: string
  risks: string[]
  recommendations: string[]
  created_at: string
  /** Last turn in the thread — what the list is ordered and grouped by.
   *  Absent on a database without migration 042, where created_at stands
   *  in for it. */
  updated_at?: string | null
}

/** When this conversation was last active, for ordering and for the label
 *  shown under its title. */
function activeAt(item: HistoryItem): string {
  return item.updated_at ?? item.created_at
}

// The platform-operator tenant (Nyansa AI's own workspace) has no end-users
// or reference documents of its own — Ask/Documents/Dashboards are all
// client-tenant-facing features and are hidden for it regardless of role.
// Its entire job is cross-tenant admin, so its nav is just Tenants and
// Settings.
//
// Users and Training are not nav entries of their own any more: both are
// administration of this workspace rather than places you go to work, so
// they are tabs inside Settings (/settings/users, /settings/training) and
// are still role-gated there by their own routes.
function getNavItems(role: string, isPlatformAdmin?: boolean, isPlatformTenant?: boolean) {
  const r = normalizeRole(role)
  return [
    ...(isPlatformTenant ? [] : [{ href: '/ask', icon: MessageSquare, label: 'Ask AI' }]),
    ...(isPlatformTenant ? [] : [{ href: '/documents', icon: FileText, label: 'Documents' }]),
    ...(canAccessDashboards(r) && !isPlatformTenant ? [{ href: '/dashboards', icon: LayoutDashboard, label: 'Dashboard' }] : []),
    ...(isPlatformAdmin                             ? [{ href: '/admin/tenants', icon: Building2,    label: 'Tenants'    }] : []),
    { href: '/settings',   icon: Settings,         label: 'Settings'   },
  ]
}

interface Props {
  role: string
  tenantName: string
  /** The workspace icon set in Settings → Workspace; falls back to initials. */
  tenantLogoUrl?: string | null
  isPlatformAdmin?: boolean
  isPlatformTenant?: boolean
  collapsed: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggle: () => void
}

// Derive a 1-2 letter badge from a tenant name, e.g. "Knowledge Innovations" -> "KI"
function tenantInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'NA'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// The workspace badge: the tenant's own icon once they've set one in
// Settings → Workspace (the same image the browser tab uses), otherwise their
// initials. An uploaded logo sits on white rather than the brand fill — it
// carries its own colours and usually its own background, so painting brand
// blue behind it just muddies whatever they uploaded.
//
// Plain <img> rather than next/image: the source is a Supabase storage URL
// built from an env var, which next/image would need a matching
// images.remotePatterns entry for, and there's nothing to optimise on a 32px
// badge.
function WorkspaceBadge({ logoUrl, initials, tenantName, className }: {
  logoUrl?: string | null
  initials: string
  tenantName: string
  className?: string
}) {
  if (logoUrl) {
    return (
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden border border-gray-200 bg-white', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={tenantName} className="h-full w-full object-contain" />
      </div>
    )
  }
  return (
    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center border border-brand/20 bg-brand text-xs font-semibold text-white', className)}>
      {initials}
    </div>
  )
}

// The time a chat was last active. Inside the Today and Yesterday groups the
// heading already supplies the day, so only the clock time is shown; anything
// older carries its date as well.
//
// Locale-formatted on the client only, which is safe here because `history`
// is empty on the server render — there is no timestamp in the HTML for a
// different locale or timezone to disagree with.
function stamp(iso: string, sameDay: boolean): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${time}`
}

// Generate a short readable title from the query
function deriveTitle(query: string): string {
  const q = query.trim().replace(/[?!.]+$/, '')
  if (q.split(/\s+/).length <= 3) return q || 'Quick chat'
  const words = q.split(/\s+/).slice(0, 6)
  return words.join(' ') + (q.split(/\s+/).length > 6 ? '…' : '')
}

export default function AppSidebar({ role, tenantName, tenantLogoUrl, isPlatformAdmin, isPlatformTenant, collapsed, mobileOpen, onClose, onToggle }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const isAsk    = pathname.startsWith('/ask')
  const navItems = useMemo(() => getNavItems(role, isPlatformAdmin, isPlatformTenant), [role, isPlatformAdmin, isPlatformTenant])
  const initials = useMemo(() => tenantInitials(tenantName), [tenantName])

  // Prefetch all nav routes immediately so link clicks feel instant
  useEffect(() => {
    navItems.forEach(({ href }) => router.prefetch(href))
  }, [router, navItems])

  const [history,      setHistory]      = useState<HistoryItem[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const fetchHistory = useCallback(() => {
    fetch('/api/chat')
      .then(r => r.json())
      .then(d => setHistory(d.conversations ?? []))
      .catch(() => {})
  }, [])

  // Loaded once for the whole session, not per route. It used to be fetched
  // on /ask and cleared on the way out, so the history vanished the moment
  // you opened a document and came back to nothing to click.
  useEffect(() => {
    if (!isPlatformTenant) fetchHistory()
  }, [isPlatformTenant, fetchHistory])

  // Listen for refresh events from AskInterface
  useEffect(() => {
    const handler = () => fetchHistory()
    window.addEventListener('refresh-chat-history', handler)
    return () => window.removeEventListener('refresh-chat-history', handler)
  }, [fetchHistory])

  // Listen for conversation open (to highlight active item)
  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<HistoryItem>).detail
      setActiveConvId(item.id)
    }
    window.addEventListener('open-conversation', handler)
    return () => window.removeEventListener('open-conversation', handler)
  }, [])

  // Reset active when new chat starts
  useEffect(() => {
    const handler = () => setActiveConvId(null)
    window.addEventListener('new-chat', handler)
    return () => window.removeEventListener('new-chat', handler)
  }, [])

  // Both of these are reachable from every page now, and off /ask there is
  // no AskInterface mounted to hear a dispatched event — it would be sent
  // into an empty room. So the intent is left where AskInterface reads it on
  // mount, and we navigate.
  function handleNewChat() {
    setActiveConvId(null)
    onClose()
    if (isAsk) {
      window.dispatchEvent(new CustomEvent('new-chat'))
      return
    }
    try {
      localStorage.removeItem('ki_last_session')
      sessionStorage.removeItem('ki_pending_conversation')
    } catch {}
    router.push('/ask')
  }

  function handleOpenConversation(item: HistoryItem) {
    setActiveConvId(item.id)
    onClose()
    if (isAsk) {
      window.dispatchEvent(new CustomEvent('open-conversation', { detail: item }))
      return
    }
    try { sessionStorage.setItem('ki_pending_conversation', item.id) } catch {}
    router.push('/ask')
  }

  function confirmDelete(e: React.MouseEvent, item: HistoryItem) {
    e.stopPropagation()
    setDeleteTarget({ id: item.id, title: deriveTitle(item.query) })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const { id } = deleteTarget
    setDeletingId(id)
    setDeleteTarget(null)
    try {
      const res  = await fetch(`/api/chat?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        console.error('Delete failed:', data.error)
        return
      }
      setHistory(prev => prev.filter(h => h.id !== id))
      if (activeConvId === id) {
        setActiveConvId(null)
        window.dispatchEvent(new CustomEvent('new-chat'))
      }
    } catch (e) {
      console.error('Delete request error:', e)
    } finally {
      setDeletingId(null)
    }
  }

  // Group history by date — computed fresh on every render (not memoized)
  // so a tab left open across midnight doesn't keep grouping new
  // conversations under "Yesterday"; memoizing on `history` wouldn't
  // actually prevent that since it could go stretches without changing.
  //
  // Ordered here as well as by the API, because what counts as "latest" is
  // the last turn in the thread and a database without migration 042 can
  // only order by when it was opened.
  const now  = new Date()
  const prev = new Date(now)
  prev.setDate(prev.getDate() - 1)
  const today = now.toDateString()
  const yesterday = prev.toDateString()
  const ordered = [...history].sort(
    (a, b) => new Date(activeAt(b)).getTime() - new Date(activeAt(a)).getTime()
  )
  const groups: { label: string; items: HistoryItem[]; sameDay: boolean }[] = []
  const todays     = ordered.filter(i => new Date(activeAt(i)).toDateString() === today)
  const yesterdays = ordered.filter(i => new Date(activeAt(i)).toDateString() === yesterday)
  const older      = ordered.filter(i => {
    const d = new Date(activeAt(i)).toDateString()
    return d !== today && d !== yesterday
  })
  if (todays.length)     groups.push({ label: 'Today',     items: todays,     sameDay: true  })
  if (yesterdays.length) groups.push({ label: 'Yesterday', items: yesterdays, sameDay: true  })
  if (older.length)      groups.push({ label: 'Earlier',   items: older,      sameDay: false })

  const inner = (
    <div className={cn(
      'flex h-full flex-col bg-white border-r border-gray-200 font-editorial-sans transition-all duration-300',
      collapsed ? 'w-14' : 'w-60'
    )}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center border-b border-gray-200 px-3">
        {collapsed ? (
          <WorkspaceBadge logoUrl={tenantLogoUrl} initials={initials} tenantName={tenantName} className="mx-auto text-[11px]" />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <WorkspaceBadge logoUrl={tenantLogoUrl} initials={initials} tenantName={tenantName} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{tenantName}</p>
              <p className="text-[10px] leading-tight text-gray-400">Intelligence workspace</p>
            </div>
            <button onClick={onClose}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition md:hidden">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Body: nav + history ─────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Nav items */}
        <nav className="shrink-0 space-y-1 p-2 mt-1">
          {navItems.map(item => {
            const active = pathname.startsWith(item.href)
            const link = (
              <Link href={item.href} onClick={onClose}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex min-w-0 items-center border-l-2 transition-all duration-150',
                  collapsed ? 'h-10 w-10 mx-auto justify-center border-l-0' : 'flex-1 gap-3 px-3 py-2.5',
                  active
                    ? 'border-brand bg-brand-light text-brand font-semibold'
                    : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                )}>
                <item.icon className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  active ? 'text-brand' : 'text-gray-400 group-hover:text-gray-500'
                )} />
                {!collapsed && <span className="truncate text-sm font-medium">{item.label}</span>}
              </Link>
            )

            // Starting a new chat belongs beside Ask AI, which is what it
            // acts on — it used to be a full-width dashed button lower down,
            // visible only once you were already on /ask. A sibling of the
            // link rather than a child of it: a button nested inside an
            // anchor is not valid markup, and its click would fight the
            // navigation.
            if (item.href !== '/ask' || collapsed) {
              return <div key={item.href} className="flex">{link}</div>
            }
            return (
              <div key={item.href}
                className={cn('flex items-stretch', active && 'bg-brand-light')}>
                {link}
                <button onClick={handleNewChat} title="New chat" aria-label="New chat"
                  className={cn(
                    'flex w-9 shrink-0 items-center justify-center transition',
                    active
                      ? 'text-brand hover:bg-brand/10'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                  )}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </nav>

        {/* Chat history — on every page, whenever the sidebar is expanded.
            The platform tenant has no Ask AI to have a history of. */}
        {!collapsed && !isPlatformTenant && (
          <div className="flex flex-1 flex-col overflow-hidden border-t border-gray-200 mt-2 pt-2">
            <p className="px-4 pb-1 shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Chats
            </p>

            {/* History list */}
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
              {groups.length === 0 ? (
                <div className="px-2 py-4 text-center">
                  <History className="mx-auto h-5 w-5 text-gray-300 mb-1.5" />
                  <p className="text-[11px] text-gray-400">No conversations yet</p>
                </div>
              ) : groups.map(group => (
                <div key={group.label}>
                  <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </p>
                  {group.items.map(item => (
                    <div key={item.id}
                      className={cn(
                        'group relative flex items-center transition',
                        activeConvId === item.id
                          ? 'bg-brand-light'
                          : 'hover:bg-gray-100'
                      )}>
                      <button
                        onClick={() => handleOpenConversation(item)}
                        className="min-w-0 flex-1 px-3 py-2 text-left text-xs"
                      >
                        <p className={cn(
                          'truncate leading-relaxed pr-5',
                          activeConvId === item.id ? 'text-brand font-medium' : 'text-gray-500 group-hover:text-gray-700'
                        )}>
                          {deriveTitle(item.query)}
                        </p>
                        <p className={cn(
                          'mt-0.5 text-[10px] tabular-nums',
                          activeConvId === item.id ? 'text-brand/60' : 'text-gray-400'
                        )}>
                          {stamp(activeAt(item), group.sameDay)}
                        </p>
                      </button>
                      <button
                        onClick={e => confirmDelete(e, item)}
                        disabled={deletingId === item.id}
                        title="Delete chat"
                        className="absolute right-2 hidden group-hover:flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:text-red-500 transition disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer: collapse toggle ─────────────────────────── */}
      <div className="shrink-0 border-t border-gray-200 p-2">
        <button onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition">
          {collapsed
            ? <ChevronRight className="h-4 w-4" />
            : <><ChevronLeft className="h-4 w-4" /><span className="text-xs font-medium">Collapse</span></>
          }
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden md:block shrink-0 overflow-hidden"
        style={{ width: collapsed ? 56 : 240, transition: 'width 300ms ease' }}>
        {inner}
      </div>
      <div className={cn(
        'fixed left-0 top-0 z-50 h-full md:hidden transition-transform duration-300 ease-in-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {inner}
      </div>

      {/* ── Delete confirmation modal ─────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 font-editorial-sans">
          <div className="w-full max-w-sm border border-gray-200 bg-white p-6 shadow-[0_24px_60px_-20px_rgba(20,20,20,0.3)]">
            <div className="mb-1 flex h-10 w-10 items-center justify-center border border-red-200 bg-red-50">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="font-editorial mt-4 text-lg font-normal text-gray-900">Delete this chat?</h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              <span className="font-medium text-gray-700">&quot;{deleteTarget.title}&quot;</span> will be permanently removed and cannot be recovered.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-gray-300 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
