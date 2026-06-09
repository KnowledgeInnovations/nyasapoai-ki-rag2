'use client'

import { useState } from 'react'
import { X, Trash2, Loader2 } from 'lucide-react'
import { ICON_OPTIONS, COLOR_OPTIONS, CATEGORIES, buildCategory } from '@/lib/documentCategories'
import type { Category } from '@/lib/documentCategories'
import { cn } from '@/lib/utils'

interface Props {
  category?: Category
  onSave:    (cat: Category) => void
  onDelete:  (value: string) => void
  onClose:   () => void
}

function toSlug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function CategoryModal({ category, onSave, onDelete, onClose }: Props) {
  const isEdit = !!category

  const [label,       setLabel]       = useState(category?.label ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [iconName,    setIconName]    = useState(category?.iconName ?? 'folder')
  const [colorName,   setColorName]   = useState(category?.colorName ?? 'blue')
  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [error,       setError]       = useState('')

  const slug     = isEdit ? category.value : toSlug(label)
  const canSave  = label.trim().length > 0 && slug.length > 0

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: slug, label: label.trim(), description: description.trim(), iconName, colorName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }
      onSave(buildCategory(slug, label.trim(), description.trim(), iconName, colorName, data.id, isEdit ? (category?.isCustom ?? false) : true))
    } catch {
      setError('Network error — check your connection')
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!category?.dbId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/categories/${category.dbId}`, { method: 'DELETE' })
      if (!res.ok) { setDeleting(false); return }
      onDelete(category.value)
    } catch {
      setDeleting(false)
    }
  }

  const isDefaultOverride = isEdit && !!category?.dbId && CATEGORIES.some(c => c.value === category?.value)
  const showDelete        = isEdit && !!category?.dbId

  const previewCat = buildCategory(slug || 'preview', label || 'Category name', description, iconName, colorName)
  const PreviewIcon = previewCat.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <h2 className="text-base font-bold text-gray-900">
            {isEdit ? 'Edit category' : 'New category'}
          </h2>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              maxLength={30}
              placeholder="e.g. HR Documents"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand/20"
            />
            {!isEdit && slug && (
              <p className="mt-1 text-xs text-gray-400">
                ID: <code className="font-mono">{slug}</code>
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={80}
              placeholder="Short description of this category"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand/20"
            />
          </div>

          {/* Icon picker */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Icon</label>
            <div className="grid grid-cols-7 gap-1.5">
              {Object.entries(ICON_OPTIONS).map(([name, { icon: Icon, label: iconLabel }]) => (
                <button key={name} type="button" title={iconLabel}
                  onClick={() => setIconName(name)}
                  className={cn(
                    'flex items-center justify-center rounded-xl p-2.5 transition',
                    iconName === name
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  )}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(color => (
                <button key={color.name} type="button" title={color.label}
                  onClick={() => setColorName(color.name)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition',
                    color.swatch,
                    colorName === color.name
                      ? 'border-gray-700 scale-110 shadow-sm'
                      : 'border-transparent hover:scale-105'
                  )}>
                  {colorName === color.name && <div className="h-2 w-2 rounded-full bg-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Preview</label>
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold',
              previewCat.bgColor, previewCat.borderColor, previewCat.textColor
            )}>
              <PreviewIcon className="h-3.5 w-3.5" />
              {previewCat.label}
            </span>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <div>
            {showDelete && (
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-40">
                {deleting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
                {isDefaultOverride ? 'Reset to default' : 'Delete'}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={!canSave || saving}
              className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-40">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
