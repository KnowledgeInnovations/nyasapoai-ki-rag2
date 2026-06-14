'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Clock, CheckCircle2, XCircle, Lock, Pencil, Plus, Trash2, X, CheckSquare } from 'lucide-react'
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
  // document delete state
  const [deleteTarget,   setDeleteTarget]  = useState<{ id: string; title: string } | null>(null)
  const [deleting,       setDeleting]      = useState(false)
  // multi-select / bulk delete state
  const [selectMode,     setSelectMode]    = useState(false)
  const [selectedIds,    setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting,   setBulkDeleting]  = useState(false)
  // category delete state
  const [catDeleteTarget, setCatDeleteTarget] = useState<Category | null>(null)
  const [catDeleting,     setCatDeleting]     = useState(false)
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

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(d => d.id))
    )
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleBulkDeleteConfirm() {
    const ids = [...selectedIds]
    if (!ids.length) return
    setBulkDeleting(true)
    try {
      const results = await Promise.all(
        ids.map(id => fetch(`/api/documents/${id}`, { method: 'DELETE' }).then(r => ({ id, ok: r.ok })))
      )
      const deletedIds = new Set(results.filter(r => r.ok).map(r => r.id))
      const failedCount = results.length - deletedIds.size
      setDocuments(prev => prev.filter(d => !deletedIds.has(d.id)))
      if (previewDocId && deletedIds.has(previewDocId)) setPreviewDocId(null)
      if (failedCount > 0) alert(`${failedCount} document${failedCount !== 1 ? 's' : ''} could not be deleted.`)
    } catch {
      alert('Bulk delete failed — please try again')
    } finally {
      setBulkDeleting(false)
      setBulkDeleteOpen(false)
      exitSelectMode()
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

  async function handleCategoryDirectDelete() {
    if (!catDeleteTarget) return
    setCatDeleting(true)
    try {
      let ok = false
      if (catDeleteTarget.dbId) {
        // Custom category or already-overridden default — delete the DB row
        const res = await fetch(`/api/categories/${catDeleteTarget.dbId}`, { method: 'DELETE' })
        ok = res.ok
      } else {
        // Pure built-in default — upsert a __hidden__ sentinel so it's excluded on next load
        const res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value:     catDeleteTarget.value,
            label:     '__hidden__',
            iconName:  catDeleteTarget.iconName,
            colorName: catDeleteTarget.colorName,
          }),
        })
        ok = res.ok
      }
      if (ok) {
        // Always remove from the visible list (don't revert defaults — user wanted them gone)
        setCategories(prev => prev.filter(c => c.value !== catDeleteTarget.value))
        if (filter === catDeleteTarget.value) setFilter('all')
      }
    } catch {}
    setCatDeleting(false)
    setCatDeleteTarget(null)
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

        <div className="flex shrink-0 items-center gap-2">
          {canDelete && documents.length > 0 && (
            selectMode ? (
              <button onClick={exitSelectMode}
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                <X className="h-4 w-4" />
                Cancel
              </button>
            ) : (
              <button onClick={() => setSelectMode(true)}
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                <CheckSquare className="h-4 w-4" />
                Select
              </button>
            )
          )}

          {canUpload ? (
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark">
              <Plus className="h-4 w-4" />
              Upload
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
              <Lock className="h-4 w-4" /> View only
            </div>
          )}
        </div>
      </div>

      {/* ── Category overview cards ─────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
        {categories.map(cat => (
          <div key={cat.value} className="relative group">
            <button
              onClick={() => setFilter(filter === cat.value ? 'all' : cat.value)}
              disabled={(counts[cat.value] ?? 0) === 0 && filter !== cat.value}
              className={cn(
                'w-full flex flex-col items-start rounded-xl border p-2.5 text-left transition hover:shadow-md disabled:cursor-default disabled:opacity-40 sm:rounded-2xl sm:p-4',
                filter === cat.value
                  ? `${cat.activeBorder} ${cat.activeBg} shadow-sm`
                  : 'border-gray-200 bg-white hover:border-gray-300'
              )}>
              <cat.icon className={cn(
                'mb-1.5 h-4 w-4 transition sm:mb-2 sm:h-5 sm:w-5',
                filter === cat.value ? cat.textColor : 'text-gray-400 group-hover:text-gray-500',
              )} />
              <p className={cn('text-lg font-black leading-none sm:text-xl', filter === cat.value ? cat.activeText : 'text-gray-900')}>
                {counts[cat.value] ?? 0}
              </p>
              <p className={cn('mt-0.5 text-[10px] font-semibold leading-tight sm:mt-1 sm:text-xs', filter === cat.value ? cat.activeText : 'text-gray-500')}>
                {cat.label}
              </p>
            </button>

            {canUpload && (
              <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
                <button
                  onClick={e => { e.stopPropagation(); setEditingCategory(cat) }}
                  title="Edit category"
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/90 text-gray-400 shadow-sm backdrop-blur-sm transition hover:bg-white hover:text-gray-700 md:opacity-0 md:group-hover:opacity-100">
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setCatDeleteTarget(cat) }}
                  title="Delete category"
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/90 text-red-400 shadow-sm backdrop-blur-sm transition hover:bg-red-50 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
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

      {/* ── Selection toolbar ────────────────────────────────── */}
      {selectMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/20 bg-brand-light px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={toggleSelectAll}
              className="rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white">
              {selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
            </button>
            <p className="text-sm font-medium text-gray-700">
              {selectedIds.size} of {filtered.length} selected
            </p>
          </div>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
            Delete selected
          </button>
        </div>
      )}

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
        <>
          {/* ── Mobile card list (< md) ──────────────────────────── */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(doc => {
              const s   = statusConfig[doc.status]
              const cat = getCat(doc.department)
              return (
                <div
                  key={doc.id}
                  onClick={() => selectMode ? toggleSelect(doc.id) : setPreviewDocId(doc.id)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3.5 shadow-sm transition active:scale-[0.99]',
                    selectedIds.has(doc.id) ? 'border-brand/30 bg-brand-light/30' : previewDocId === doc.id ? 'border-brand/30 bg-brand-light/30' : 'border-gray-200',
                  )}>
                  {/* Checkbox */}
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-brand focus:ring-brand"
                    />
                  )}

                  {/* Icon */}
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                    cat ? `${cat.bgColor} ${cat.borderColor}` : 'bg-gray-50 border-gray-200',
                  )}>
                    {cat
                      ? <cat.icon className={cn('h-5 w-5', cat.textColor)} />
                      : <FileText className="h-5 w-5 text-gray-400" />}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-semibold', previewDocId === doc.id ? 'text-brand' : 'text-gray-900')}>
                      {doc.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-400">{doc.source}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {/* Status chip */}
                      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', s.cls)}>
                        <s.icon className="h-2.5 w-2.5" />{s.label}
                      </span>
                      {/* Category chip */}
                      {cat && (
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', cat.bgColor, cat.borderColor, cat.textColor)}>
                          <cat.icon className="h-2.5 w-2.5" />{cat.label}
                        </span>
                      )}
                      {/* Date */}
                      <span className="text-[10px] text-gray-400">{formatDate(doc.created_at)}</span>
                    </div>
                  </div>

                  {/* Delete button */}
                  {canDelete && !selectMode && (
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget({ id: doc.id, title: doc.title }) }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-300 transition hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Desktop table (md+) ─────────────────────────────── */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 text-left">
                  {selectMode && (
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                      />
                    </th>
                  )}
                  <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">Document</th>
                  <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">Category</th>
                  <th className="hidden px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 sm:table-cell">Access</th>
                  <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">Status</th>
                  <th className="hidden px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 lg:table-cell">Added</th>
                  {canDelete && !selectMode && <th className="w-10 px-3 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(doc => {
                  const s   = statusConfig[doc.status]
                  const cat = getCat(doc.department)
                  return (
                    <tr key={doc.id}
                      onClick={() => selectMode ? toggleSelect(doc.id) : setPreviewDocId(doc.id)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        selectedIds.has(doc.id) ? 'bg-brand-light' : previewDocId === doc.id ? 'bg-brand-light' : 'hover:bg-gray-50/80',
                      )}>
                      {selectMode && (
                        <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(doc.id)}
                            onChange={() => toggleSelect(doc.id)}
                            className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                          />
                        </td>
                      )}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                            cat ? `${cat.bgColor} ${cat.borderColor}` : 'bg-gray-50 border-gray-200',
                          )}>
                            {cat
                              ? <cat.icon className={cn('h-4 w-4', cat.textColor)} />
                              : <FileText className="h-4 w-4 text-gray-400" />}
                          </div>
                          <div className="min-w-0">
                            <p className={cn('truncate font-semibold max-w-[220px]', previewDocId === doc.id ? 'text-brand' : 'text-gray-900')}>{doc.title}</p>
                            <p className="truncate text-xs text-gray-400 max-w-[220px]">{doc.source}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {cat ? (
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold', cat.bgColor, cat.borderColor, cat.textColor)}>
                            <cat.icon className="h-3 w-3" />{cat.label}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="hidden px-5 py-3.5 sm:table-cell">
                        <span className="capitalize text-xs text-gray-500">{doc.sensitivity}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold', s.cls)}>
                          <s.icon className="h-3 w-3" />{s.label}
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
        </>
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

      {/* ── Category delete confirmation ────────────────────── */}
      {catDeleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 border border-red-200">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">Delete &ldquo;{catDeleteTarget.label}&rdquo;?</h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              The category will be removed. Documents in this category won&apos;t be deleted — they&apos;ll become uncategorised.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setCatDeleteTarget(null)}
                disabled={catDeleting}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleCategoryDirectDelete}
                disabled={catDeleting}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50">
                {catDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Bulk delete confirmation ─────────────────────────── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 border border-red-200">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">
              Delete {selectedIds.size} document{selectedIds.size !== 1 ? 's' : ''}?
            </h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              The selected documents will be permanently removed including all AI knowledge chunks. This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleting}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleBulkDeleteConfirm}
                disabled={bulkDeleting}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50">
                {bulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
