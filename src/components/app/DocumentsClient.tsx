'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Clock, CheckCircle2, XCircle, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Document } from '@/types'
import { formatDate } from '@/lib/utils'
import { CATEGORIES, buildCategory } from '@/lib/documentCategories'
import type { Category, CategoryInit } from '@/lib/documentCategories'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'

const UploadModal      = dynamic(() => import('./UploadModal'),      { ssr: false })
const DocumentPreview  = dynamic(() => import('./DocumentPreview'),  { ssr: false })
const CategoryModal    = dynamic(() => import('./CategoryModal'),    { ssr: false })

interface Props {
  initialDocuments:  Document[]
  canUpload:         boolean
  canDelete:         boolean
  initialCategories: CategoryInit[]
}

const statusConfig = {
  ready:      { icon: CheckCircle2, label: 'Ready',      cls: 'text-green-600 bg-green-50 border-green-200' },
  processing: { icon: Clock,        label: 'Processing', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  failed:     { icon: XCircle,      label: 'Failed',     cls: 'text-red-600   bg-red-50   border-red-200'   },
}

export default function DocumentsClient({ initialDocuments, canUpload, canDelete, initialCategories }: Props) {
  const [documents, setDocuments]   = useState<Document[]>(initialDocuments)

  // Sync with server data when router.refresh() completes
  useEffect(() => { setDocuments(initialDocuments) }, [initialDocuments])
  const [categories, setCategories] = useState<Category[]>(
    () => initialCategories.map(c => buildCategory(c.value, c.label, c.description, c.iconName, c.colorName, c.dbId, c.isCustom))
  )
  const [filter,         setFilter]        = useState('all')
  const [showUpload,     setShowUpload]    = useState(false)
  const [previewDocId,   setPreviewDocId]  = useState<string | null>(null)
  // undefined = closed, null = add mode, Category = edit mode
  const [editingCategory, setEditingCategory] = useState<Category | null | undefined>(undefined)
  // delete state
  const [deleteTarget,   setDeleteTarget]  = useState<{ id: string; title: string } | null>(null)
  const [deleting,       setDeleting]      = useState(false)
  const router = useRouter()

  const getCat = (value: string | null | undefined) =>
    categories.find(c => c.value === value)

  const counts = categories.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.value] = documents.filter(d => d.department === cat.value).length
    return acc
  }, {})
  const uncategorised = documents.filter(d => !d.department || !categories.find(c => c.value === d.department)).length
  const totalCount    = documents.length

  const filtered = filter === 'all'
    ? documents
    : filter === 'uncategorised'
    ? documents.filter(d => !d.department)
    : documents.filter(d => d.department === filter)

  function handleUploaded(newDocs: Document[]) {
    // Optimistic update — show new docs immediately without waiting for refresh
    setDocuments(prev => {
      const existingIds = new Set(prev.map(d => d.id))
      return [...newDocs.filter(d => !existingIds.has(d.id)), ...prev]
    })
    router.refresh() // sync with server in the background
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/documents/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id))
        if (previewDocId === deleteTarget.id) setPreviewDocId(null)
      } else {
        const data = await res.json()
        alert(data.error ?? 'Delete failed')
      }
    } catch {
      alert('Delete failed — please try again')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  function handleCategorySaved(cat: Category) {
    setCategories(prev => {
      const idx = prev.findIndex(c => c.value === cat.value)
      if (idx >= 0) { const u = [...prev]; u[idx] = cat; return u }
      return [...prev, cat]
    })
    setEditingCategory(undefined)
  }

  function handleCategoryDeleted(value: string) {
    setCategories(prev => {
      // Revert to built-in default if one exists; otherwise remove entirely
      const builtIn = CATEGORIES.find(c => c.value === value)
      if (builtIn) return prev.map(c => c.value === value ? builtIn : c)
      return prev.filter(c => c.value !== value)
    })
    setEditingCategory(undefined)
  }

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Documents</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canUpload
              ? 'Upload and manage your project documents — all searchable by AI.'
              : 'Browse documents shared in your workspace.'}
          </p>
        </div>

        {canUpload ? (
          <button onClick={() => setShowUpload(true)}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark">
            Upload documents
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
            <Lock className="h-4 w-4" /> View only
          </div>
        )}
      </div>

      {/* ── Category overview cards ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {categories.map(cat => (
          <div key={cat.value} className="relative group">
            <button
              onClick={() => setFilter(filter === cat.value ? 'all' : cat.value)}
              disabled={(counts[cat.value] ?? 0) === 0 && filter !== cat.value}
              className={cn(
                'w-full flex flex-col items-start rounded-2xl border p-4 text-left transition hover:shadow-md disabled:cursor-default disabled:opacity-40',
                filter === cat.value
                  ? `${cat.activeBorder} ${cat.activeBg} shadow-sm`
                  : 'border-gray-200 bg-white hover:border-gray-300'
              )}>
              <cat.icon className={cn(
                'mb-2 h-5 w-5 transition',
                filter === cat.value ? cat.textColor : 'text-gray-400 group-hover:text-gray-500',
              )} />
              <p className={cn('text-xl font-black leading-none', filter === cat.value ? cat.activeText : 'text-gray-900')}>
                {counts[cat.value] ?? 0}
              </p>
              <p className={cn('mt-1 text-xs font-semibold leading-tight', filter === cat.value ? cat.activeText : 'text-gray-500')}>
                {cat.label}
              </p>
            </button>

            {canUpload && (
              <button
                onClick={e => { e.stopPropagation(); setEditingCategory(cat) }}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 text-gray-400 opacity-0 shadow-sm backdrop-blur-sm transition hover:bg-white hover:text-gray-700 group-hover:opacity-100">
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {canUpload && (
          <button
            onClick={() => setEditingCategory(null)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-gray-200 p-4 text-gray-400 transition hover:border-brand/40 hover:text-brand">
            <Plus className="h-5 w-5" />
            <p className="text-xs font-semibold">Add</p>
          </button>
        )}
      </div>

      {/* ── Filter tabs ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('all')}
          className={cn(
            'rounded-full border px-4 py-1.5 text-xs font-semibold transition',
            filter === 'all'
              ? 'border-brand bg-brand text-white shadow-sm'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
          )}>
          All ({totalCount})
        </button>

        {categories.filter(cat => (counts[cat.value] ?? 0) > 0).map(cat => (
          <button key={cat.value} onClick={() => setFilter(cat.value)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs font-semibold transition',
              filter === cat.value
                ? `${cat.activeBorder} ${cat.activeBg} ${cat.activeText} shadow-sm`
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
            )}>
            {cat.label} ({counts[cat.value]})
          </button>
        ))}

        {uncategorised > 0 && (
          <button onClick={() => setFilter('uncategorised')}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs font-semibold transition',
              filter === 'uncategorised'
                ? 'border-gray-400 bg-gray-100 text-gray-700 shadow-sm'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            )}>
            Uncategorised ({uncategorised})
          </button>
        )}
      </div>

      {/* ── Documents table / empty state ───────────────────── */}
      {documents.length === 0 ? (
        <div
          onClick={() => canUpload && setShowUpload(true)}
          className={cn(
            'rounded-2xl border-2 border-dashed border-gray-300 bg-white p-16 text-center',
            canUpload && 'cursor-pointer hover:border-brand transition-colors'
          )}>
          <FileText className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-500">No documents yet</p>
          <p className="mt-1 text-xs text-gray-400">
            {canUpload
              ? 'Click here or use the Upload button to add your first document.'
              : 'Documents uploaded by your workspace admin will appear here.'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-400">No documents in this category yet.</p>
          {canUpload && (
            <button onClick={() => setShowUpload(true)}
              className="mt-4 rounded-xl border border-brand/30 bg-brand-light px-4 py-2 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white">
              Upload to this category
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500">Document</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500">Category</th>
                <th className="hidden px-5 py-3.5 text-xs font-semibold text-gray-500 sm:table-cell">Access</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500">Status</th>
                <th className="hidden px-5 py-3.5 text-xs font-semibold text-gray-500 lg:table-cell">Added</th>
                {canDelete && <th className="w-10 px-3 py-3.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(doc => {
                const s   = statusConfig[doc.status]
                const cat = getCat(doc.department)
                return (
                  <tr key={doc.id}
                    onClick={() => setPreviewDocId(doc.id)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      previewDocId === doc.id ? 'bg-brand-light' : 'hover:bg-gray-50/80'
                    )}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                          cat ? `${cat.bgColor} ${cat.borderColor}` : 'bg-gray-50 border-gray-200'
                        )}>
                          {cat
                            ? <cat.icon className={cn('h-4 w-4', cat.textColor)} />
                            : <FileText className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="min-w-0">
                          <p className={cn('truncate font-semibold max-w-[200px]', previewDocId === doc.id ? 'text-brand' : 'text-gray-900')}>{doc.title}</p>
                          <p className="truncate text-xs text-gray-400 max-w-[200px]">{doc.source}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      {cat ? (
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                          cat.bgColor, cat.borderColor, cat.textColor
                        )}>
                          <cat.icon className="h-3 w-3" />
                          {cat.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>

                    <td className="hidden px-5 py-3.5 sm:table-cell">
                      <span className="capitalize text-xs text-gray-500">{doc.sensitivity}</span>
                    </td>

                    <td className="px-5 py-3.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                        s.cls
                      )}>
                        <s.icon className="h-3 w-3" />
                        {s.label}
                      </span>
                    </td>

                    <td className="hidden px-5 py-3.5 text-xs text-gray-400 lg:table-cell">
                      {formatDate(doc.created_at)}
                    </td>
                    {canDelete && (
                      <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setDeleteTarget({ id: doc.id, title: doc.title })}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                          title="Delete document">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────── */}
      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => setShowUpload(false)}
          onUploaded={docs => { setShowUpload(false); handleUploaded(docs) }}
        />
      )}

      {editingCategory !== undefined && (
        <CategoryModal
          category={editingCategory ?? undefined}
          onSave={handleCategorySaved}
          onDelete={handleCategoryDeleted}
          onClose={() => setEditingCategory(undefined)}
        />
      )}

      <DocumentPreview
        docId={previewDocId}
        onClose={() => setPreviewDocId(null)}
      />

      {/* ── Delete confirmation ─────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 border border-red-200">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">Delete this document?</h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              <span className="font-medium text-gray-700">&ldquo;{deleteTarget.title}&rdquo;</span> will be permanently removed including all AI knowledge chunks. This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
