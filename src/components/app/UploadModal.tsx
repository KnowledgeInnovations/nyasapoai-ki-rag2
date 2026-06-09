'use client'

import { useState, useRef, useCallback } from 'react'
import { X, Upload, FileText, CheckCircle2, AlertCircle, Loader2, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { uploadDocument } from '@/lib/uploadDocument'
import { SENSITIVITIES } from '@/lib/documentCategories'
import type { Category } from '@/lib/documentCategories'
import type { Document } from '@/types'

interface FileItem {
  file: File
  title: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

interface Props {
  onClose:    () => void
  onUploaded: (newDocs: Document[]) => void
  categories: Category[]
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadModal({ onClose, onUploaded, categories }: Props) {
  const [files,       setFiles]       = useState<FileItem[]>([])
  const [category,    setCategory]    = useState('')
  const [sensitivity, setSensitivity] = useState('internal')
  const [isDragging,  setIsDragging]  = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming)
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.file.name + f.file.size))
      const newItems: FileItem[] = arr
        .filter(f => !existing.has(f.name + f.size))
        .map(f => ({
          file: f,
          title: f.name.replace(/\.[^.]+$/, ''),
          status: 'pending',
        }))
      return [...prev, ...newItems]
    })
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateTitle(i: number, title: string) {
    setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, title } : f))
  }

  async function handleUpload() {
    if (!files.length || !category) return
    setUploading(true)

    const newDocs: Document[] = []

    for (let i = 0; i < files.length; i++) {
      const item = files[i]
      if (item.status === 'done') continue

      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'uploading' } : f))

      try {
        const { document, error } = await uploadDocument(item.file, {
          title: item.title,
          department: category,
          sensitivity,
        })
        if (document) {
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'done' } : f))
          newDocs.push(document)
        } else {
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: error ?? 'Upload failed' } : f))
        }
      } catch (err) {
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: (err as Error)?.message || 'Network error' } : f))
      }
    }

    setUploading(false)
    if (newDocs.length) onUploaded(newDocs)
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const allDone      = files.length > 0 && files.every(f => f.status === 'done')
  const canUpload    = pendingCount > 0 && !!category && !uploading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Upload Documents</h2>
            <p className="mt-0.5 text-sm text-gray-500">PDF, Word, Excel, PowerPoint, CSV, TXT and more</p>
          </div>
          <button onClick={onClose} disabled={uploading}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition disabled:opacity-40">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 transition',
              isDragging ? 'border-brand bg-brand-light scale-[1.01]' : 'border-gray-300 bg-gray-50 hover:border-brand/50 hover:bg-blue-50/30'
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-light mb-3">
              <Paperclip className="h-6 w-6 text-brand" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {isDragging ? 'Drop files here' : 'Drag & drop files or click to browse'}
            </p>
            <p className="mt-1 text-xs text-gray-400">PDF, DOCX, XLSX, PPTX, TXT, CSV and more · Max 500 MB</p>
            <input ref={fileInputRef} type="file" className="hidden" multiple
              onChange={e => e.target.files && addFiles(e.target.files)} />
          </div>

          {/* Category — required */}
          <div>
            <p className="mb-3 text-sm font-semibold text-gray-800">
              Category <span className="text-red-500">*</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {categories.map(cat => (
                <button key={cat.value} type="button"
                  onClick={() => setCategory(cat.value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-center text-xs font-semibold transition',
                    category === cat.value
                      ? `${cat.activeBorder} ${cat.activeBg} ${cat.activeText} shadow-sm`
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}>
                  <cat.icon className={cn('h-5 w-5', category === cat.value ? cat.textColor : 'text-gray-400')} />
                  {cat.label}
                </button>
              ))}
            </div>
            {!category && files.length > 0 && (
              <p className="mt-2 text-xs text-red-500">Please select a category before uploading.</p>
            )}
          </div>

          {/* Sensitivity */}
          <div>
            <p className="mb-3 text-sm font-semibold text-gray-800">Access level</p>
            <div className="flex flex-wrap gap-2">
              {SENSITIVITIES.map(s => (
                <button key={s.value} type="button"
                  onClick={() => setSensitivity(s.value)}
                  className={cn(
                    'flex flex-col rounded-xl border px-4 py-2.5 text-left text-xs transition',
                    sensitivity === s.value
                      ? 'border-brand bg-brand-light text-brand shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  )}>
                  <span className="font-semibold">{s.label}</span>
                  <span className={cn('mt-0.5', sensitivity === s.value ? 'text-brand/70' : 'text-gray-400')}>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-800">
                Files selected ({files.length})
              </p>
              <div className="space-y-2">
                {files.map((item, i) => (
                  <div key={i} className={cn(
                    'flex items-center gap-3 rounded-xl border px-4 py-3',
                    item.status === 'done'     && 'border-green-200 bg-green-50',
                    item.status === 'error'    && 'border-red-200 bg-red-50',
                    item.status === 'uploading' && 'border-brand/30 bg-brand-light',
                    item.status === 'pending'  && 'border-gray-200 bg-white',
                  )}>
                    {/* Icon/status */}
                    <div className="shrink-0">
                      {item.status === 'done'      && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                      {item.status === 'error'     && <AlertCircle  className="h-5 w-5 text-red-500" />}
                      {item.status === 'uploading' && <Loader2      className="h-5 w-5 animate-spin text-brand" />}
                      {item.status === 'pending'   && <FileText     className="h-5 w-5 text-gray-400" />}
                    </div>

                    {/* Title editable */}
                    <div className="min-w-0 flex-1">
                      {item.status === 'pending' ? (
                        <input
                          value={item.title}
                          onChange={e => updateTitle(i, e.target.value)}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand"
                        />
                      ) : (
                        <p className="truncate text-xs font-medium text-gray-800">{item.title}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {item.file.name} · {formatBytes(item.file.size)}
                        {item.error && <span className="ml-2 text-red-500">{item.error}</span>}
                      </p>
                    </div>

                    {/* Remove */}
                    {item.status === 'pending' && (
                      <button onClick={() => removeFile(i)}
                        className="shrink-0 text-gray-400 hover:text-red-500 transition">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <p className="text-xs text-gray-400">
            {allDone
              ? '✅ All files processed successfully'
              : `${files.length} file${files.length !== 1 ? 's' : ''} selected`}
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={uploading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
              {allDone ? 'Close' : 'Cancel'}
            </button>
            {!allDone && (
              <button onClick={handleUpload} disabled={!canUpload}
                className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-40">
                {uploading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
                  : <><Upload className="h-4 w-4" /> Upload {pendingCount > 1 ? `${pendingCount} files` : 'file'}</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
