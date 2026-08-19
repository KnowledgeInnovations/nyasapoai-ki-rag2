'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export interface TenantRow {
  id:         string
  name:       string
  subdomain:  string
  plan:       string
  createdAt:  string
  memberCount: number
  isPlatform: boolean
  queryCount30d: number
  documentCount30d: number
  estimatedMonthlyCostUsd: number
}

interface Props {
  tenants: TenantRow[]
}

export default function TenantsClient({ tenants }: Props) {
  const router = useRouter()
  const [list, setList] = useState(tenants)
  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <section className="overflow-hidden  border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
        <h2 className="text-sm font-bold text-gray-800">Workspaces</h2>
        <p className="mt-0.5 text-xs text-gray-500">{list.length} {list.length === 1 ? 'tenant' : 'tenants'} total.</p>
      </div>
      <div className="divide-y divide-gray-100">
        {list.map(t => (
          <div key={t.id} className="flex items-center gap-4 px-6 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{t.name}</p>
              <p className="truncate text-xs text-gray-500">{t.subdomain}.nyansaai.com</p>
            </div>
            <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              {t.plan}
            </span>
            <span className="w-20 shrink-0 text-right text-sm text-gray-500">
              {t.memberCount} {t.memberCount === 1 ? 'member' : 'members'}
            </span>
            <div className="w-32 shrink-0 text-right" title={`Estimated AI cost: ${t.queryCount30d} questions + ${t.documentCount30d} documents uploaded in the last 30 days. Modeled from average per-call cost, not measured billing.`}>
              <p className="text-sm font-semibold text-gray-700">~${t.estimatedMonthlyCostUsd.toFixed(2)}<span className="text-[10px] font-normal text-gray-400">/mo</span></p>
              <p className="text-[10px] text-gray-400">{t.queryCount30d} questions · {t.documentCount30d} docs</p>
            </div>
            <span className="w-28 shrink-0 text-right text-xs text-gray-400">
              {new Date(t.createdAt).toLocaleDateString()}
            </span>
            {!t.isPlatform && (
              <button
                onClick={() => setDeleteTarget(t)}
                title="Delete tenant"
                className="shrink-0  border border-gray-200 p-2 text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

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
    </section>
  )
}
