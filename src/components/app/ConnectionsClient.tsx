'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Plus, RefreshCw, Trash2, Pause, Play, AlertTriangle,
  CheckCircle2, Link2, ExternalLink, ShieldAlert, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ConnectionRow {
  id: string
  display_name: string
  azure_tenant_id: string
  site_id: string
  drive_id: string
  site_url: string | null
  sensitivity: string
  enabled: boolean
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_detail: string | null
  created_at: string
}

interface Site  { id: string; name: string; webUrl: string | null }
interface Drive { id: string; name: string; driveType: string | null; webUrl: string | null }

interface SyncResult {
  status: 'ok' | 'partial' | 'failed'
  imported: number
  updated: number
  deleted: number
  skipped: number
  refused: { name: string; reason: string }[]
  detail: string
  resynced: boolean
}

/**
 * Connecting a SharePoint document library.
 *
 * The flow mirrors how Microsoft 365 is actually shaped, because any
 * shortcut around it ends in someone connecting the wrong thing: a
 * directory (tenant) ID, then a site, then a library inside that site.
 * Nothing is saved until all three are chosen and the site has been
 * confirmed readable.
 *
 * The sensitivity step is not optional and is not buried. Application
 * access cannot see SharePoint's own per-file permissions, so the level
 * chosen here is the only thing standing between a restricted file in
 * that library and everyone in the workspace. The screen says so in
 * those words, at the point of the decision, rather than in documentation
 * nobody opens.
 */

const SENSITIVITIES = [
  { value: 'public',       label: 'Public',       who: 'Anyone with access to this workspace, including the public pages.' },
  { value: 'internal',     label: 'Internal',     who: 'Every member of this workspace. The usual choice.' },
  { value: 'confidential', label: 'Confidential', who: 'Senior members only.' },
  { value: 'restricted',   label: 'Restricted',   who: 'Senior members only. For board, legal and personnel material.' },
] as const

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function ConnectionsClient({
  connections, fileCounts, configured,
}: {
  connections: ConnectionRow[]
  fileCounts: Record<string, number>
  configured: boolean
}) {
  const router = useRouter()

  const [adding, setAdding] = useState(false)
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState('')
  const [notice, setNotice] = useState('')
  const [lastSync, setLastSync] = useState<Record<string, SyncResult>>({})
  const [confirmRemove, setConfirmRemove] = useState<ConnectionRow | null>(null)

  // The add flow, step by step.
  const [azureTenantId, setAzureTenantId] = useState('')
  const [sites, setSites]     = useState<Site[] | null>(null)
  const [siteId, setSiteId]   = useState('')
  const [drives, setDrives]   = useState<Drive[] | null>(null)
  const [driveId, setDriveId] = useState('')
  const [name, setName]       = useState('')
  const [sensitivity, setSensitivity] = useState<string>('internal')
  const [hint, setHint]       = useState<string | null>(null)

  function resetAdd() {
    setAdding(false); setAzureTenantId(''); setSites(null); setSiteId('')
    setDrives(null); setDriveId(''); setName(''); setSensitivity('internal')
    setHint(null); setError('')
  }

  async function discover(body: Record<string, unknown>, label: string) {
    setBusy(label); setError(''); setHint(null)
    try {
      const res = await fetch('/api/connections/sharepoint/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azureTenantId, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not reach Microsoft.')
      return json
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function findSites() {
    const json = await discover({}, 'sites')
    if (!json) return
    setSites(json.sites ?? [])
    setHint(json.hint ?? null)
    setDrives(null); setSiteId(''); setDriveId('')
  }

  async function chooseSite(site: Site) {
    setSiteId(site.id)
    setDriveId('')
    if (!name.trim()) setName(site.name)
    const json = await discover({ siteId: site.id }, 'drives')
    if (json) setDrives(json.drives ?? [])
  }

  async function connect() {
    setBusy('connect'); setError('')
    try {
      const res = await fetch('/api/connections/sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azureTenantId, siteId, driveId, displayName: name, sensitivity }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not connect the library.')
      setNotice(`Connected ${name.trim()}. Nothing has been imported yet — sync it now, or leave it for the nightly run.`)
      resetAdd()
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function syncNow(connection: ConnectionRow) {
    setBusy(`sync-${connection.id}`); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/connections/sharepoint/${connection.id}/sync`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'The sync failed.')
      setLastSync(s => ({ ...s, [connection.id]: json.result }))
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function patch(connection: ConnectionRow, body: Record<string, unknown>) {
    setBusy(`patch-${connection.id}`); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/connections/sharepoint/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save the change.')
      if (json.relabelled) {
        setNotice(`${json.relabelled} document(s) already imported were moved to the new level too.`)
      }
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(connection: ConnectionRow, removeDocuments: boolean) {
    setBusy(`remove-${connection.id}`); setError(''); setNotice('')
    try {
      const res = await fetch(
        `/api/connections/sharepoint/${connection.id}${removeDocuments ? '?removeDocuments=1' : ''}`,
        { method: 'DELETE' },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not disconnect.')
      setNotice(removeDocuments
        ? `Disconnected ${connection.display_name} and removed ${json.documentsRemoved} document(s).`
        : `Disconnected ${connection.display_name}. The documents it imported are still here and still answerable.`)
      setConfirmRemove(null)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 p-6">
          <div>
            <h2 className="flex items-center gap-2 font-editorial text-lg font-normal text-gray-900">
              <Link2 className="h-4 w-4 text-brand" />
              Connected document libraries
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              A connected SharePoint library is kept in step with this workspace:
              a file added there is imported and becomes answerable, a file edited
              there is updated rather than duplicated, and a file deleted there
              stops being answerable here.
            </p>
          </div>
          {configured && !adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-2 bg-brand px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand/90">
              <Plus className="h-4 w-4" />
              Connect a library
            </button>
          )}
        </div>

        {!configured && (
          <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 p-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">SharePoint is not set up on this deployment yet.</p>
              <p className="mt-1 text-amber-800">
                It needs an Azure application registered once, by someone with
                administrator rights in your Microsoft 365 tenant — about fifteen
                minutes. The steps, and which permission to ask for and why, are
                in <code className="bg-amber-100 px-1">docs/SHAREPOINT.md</code>.
                Until then this screen can show connections but cannot make one.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 border-b border-green-100 bg-green-50 p-4 text-sm text-green-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {adding && (
          <div className="space-y-5 border-b border-gray-100 bg-gray-50/60 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Connect a library</h3>
              <button onClick={resetAdd} className="text-gray-400 transition hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                1 — Microsoft 365 directory (tenant) ID
              </label>
              <p className="mt-1 text-xs text-gray-500">
                From the Azure portal, under Microsoft Entra ID then Overview. A
                string of letters and numbers, not your domain name.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={azureTenantId}
                  onChange={e => setAzureTenantId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="min-w-0 flex-1 border border-gray-200 px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
                />
                <button onClick={findSites} disabled={!azureTenantId.trim() || busy === 'sites'}
                  className="flex items-center gap-2 border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'sites' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Find sites
                </button>
              </div>
            </div>

            {sites && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  2 — Site
                </label>
                {hint && (
                  <p className="mt-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{hint}</p>
                )}
                {sites.length > 0 && (
                  <div className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto border border-gray-200 bg-white">
                    {sites.map(site => (
                      <button key={site.id} onClick={() => chooseSite(site)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition',
                          siteId === site.id ? 'bg-brand-light text-brand' : 'hover:bg-gray-50',
                        )}>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{site.name}</span>
                          {site.webUrl && <span className="block truncate text-xs text-gray-400">{site.webUrl}</span>}
                        </span>
                        {busy === 'drives' && siteId === site.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {drives && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  3 — Document library
                </label>
                {drives.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">That site has no document libraries we can read.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {drives.map(drive => (
                      <button key={drive.id} onClick={() => setDriveId(drive.id)}
                        className={cn(
                          'border px-3 py-2 text-sm font-semibold transition',
                          driveId === drive.id
                            ? 'border-brand bg-brand text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                        )}>
                        {drive.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {driveId && (
              <>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    4 — What to call it here
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Finance — Board papers"
                    className="mt-2 w-full border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    5 — Who may read what comes in
                  </label>
                  <div className="mt-2 flex items-start gap-3 border border-amber-200 bg-amber-50 p-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-xs text-amber-900">
                      <strong>Read this one carefully.</strong> We cannot see
                      SharePoint&rsquo;s own per-file permissions. Every file in this
                      library gets the level you choose here, so if a file in it is
                      restricted to three people in SharePoint, connecting the
                      library makes it readable by everyone the level allows.
                      Connect libraries whose contents the whole group may read,
                      and set the level to match.
                    </p>
                  </div>
                  <div className="mt-2 space-y-2">
                    {SENSITIVITIES.map(level => (
                      <label key={level.value}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 border p-3 transition',
                          sensitivity === level.value ? 'border-brand bg-brand-light' : 'border-gray-200 bg-white hover:bg-gray-50',
                        )}>
                        <input type="radio" name="sensitivity" value={level.value}
                          checked={sensitivity === level.value}
                          onChange={() => setSensitivity(level.value)}
                          className="mt-0.5" />
                        <span className="text-sm">
                          <span className="block font-semibold text-gray-900">{level.label}</span>
                          <span className="block text-xs text-gray-500">{level.who}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={connect} disabled={!name.trim() || busy === 'connect'}
                    className="flex items-center gap-2 bg-brand px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand/90 disabled:opacity-50">
                    {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    Connect this library
                  </button>
                  <button onClick={resetAdd}
                    className="border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {connections.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">
            No libraries are connected. Documents can still be uploaded by hand on
            the Documents page — a connection is for when the documents already
            live somewhere and keeping two copies is the problem.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {connections.map(connection => {
              const result = lastSync[connection.id]
              const level = SENSITIVITIES.find(s => s.value === connection.sensitivity)
              return (
                <li key={connection.id} className="space-y-3 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
                        {connection.display_name}
                        {!connection.enabled && (
                          <span className="border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                            Paused
                          </span>
                        )}
                        <span className={cn(
                          'border px-2 py-0.5 text-xs font-semibold',
                          connection.sensitivity === 'confidential' || connection.sensitivity === 'restricted'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-gray-200 bg-gray-50 text-gray-600',
                        )}>
                          {level?.label ?? connection.sensitivity}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {fileCounts[connection.id] ?? 0} file(s) tracked · last synced {timeAgo(connection.last_sync_at)}
                        {connection.last_sync_status ? ` · ${connection.last_sync_status}` : ''}
                      </p>
                      {connection.site_url && (
                        <a href={connection.site_url} target="_blank" rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                          {connection.site_url}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={connection.sensitivity}
                        onChange={e => patch(connection, { sensitivity: e.target.value })}
                        disabled={busy === `patch-${connection.id}`}
                        className="border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">
                        {SENSITIVITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <button onClick={() => syncNow(connection)}
                        disabled={!connection.enabled || !configured || busy === `sync-${connection.id}`}
                        className="flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                        {busy === `sync-${connection.id}`
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RefreshCw className="h-3.5 w-3.5" />}
                        Sync now
                      </button>
                      <button onClick={() => patch(connection, { enabled: !connection.enabled })}
                        disabled={busy === `patch-${connection.id}`}
                        className="flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
                        {connection.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {connection.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => setConfirmRemove(connection)}
                        className="flex items-center gap-1.5 border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {connection.last_sync_detail && !result && (
                    <p className="text-xs text-gray-500">{connection.last_sync_detail}</p>
                  )}

                  {result && (
                    <div className={cn(
                      'border p-3 text-xs',
                      result.status === 'failed'
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : result.status === 'partial'
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-green-200 bg-green-50 text-green-800',
                    )}>
                      <p className="font-semibold">{result.detail}</p>
                      {result.status === 'partial' && (
                        <p className="mt-1">
                          Stopped on its time budget, which is normal for a large
                          library. Progress was saved — the next run carries on from
                          exactly here, so nothing is read twice.
                        </p>
                      )}
                      {result.resynced && (
                        <p className="mt-1">
                          Microsoft had expired our place in the change feed, so the
                          library was read again from the beginning. Nothing was
                          duplicated.
                        </p>
                      )}
                      {result.refused.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {result.refused.map(r => (
                            <li key={r.name}>· {r.name} — {r.reason}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg space-y-4 border border-gray-200 bg-white p-6 shadow-2xl">
            <h3 className="font-editorial text-lg font-normal text-gray-900">
              Disconnect {confirmRemove.display_name}?
            </h3>
            <p className="text-sm text-gray-600">
              Syncing stops either way. The question is what happens to the{' '}
              {fileCounts[confirmRemove.id] ?? 0} document(s) already imported from it.
            </p>
            <div className="space-y-2">
              <button onClick={() => remove(confirmRemove, false)}
                disabled={busy === `remove-${confirmRemove.id}`}
                className="w-full border border-gray-300 bg-white p-3 text-left transition hover:bg-gray-50 disabled:opacity-50">
                <span className="block text-sm font-semibold text-gray-900">Keep the documents</span>
                <span className="block text-xs text-gray-500">
                  They stay in this workspace as ordinary documents and remain
                  answerable. They simply stop being kept in step with SharePoint.
                </span>
              </button>
              <button onClick={() => remove(confirmRemove, true)}
                disabled={busy === `remove-${confirmRemove.id}`}
                className="w-full border border-red-200 bg-white p-3 text-left transition hover:bg-red-50 disabled:opacity-50">
                <span className="block text-sm font-semibold text-red-800">
                  Remove the documents as well
                </span>
                <span className="block text-xs text-red-700">
                  Deletes those documents, their stored files and everything read
                  out of them. The files in SharePoint are untouched, but the
                  reading work is lost and cannot be undone.
                </span>
              </button>
            </div>
            <button onClick={() => setConfirmRemove(null)}
              className="w-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
