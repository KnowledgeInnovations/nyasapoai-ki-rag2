'use client'

import { useState, useEffect } from 'react'
import { X, FileText, Download, CheckCircle2, Clock, XCircle, Hash } from 'lucide-react'
import type { Document } from '@/types'
import { getCategoryByValue } from '@/lib/documentCategories'
import PdfViewer from './PdfViewer'
import DocxViewer from './DocxViewer'
import SpreadsheetViewer from './SpreadsheetViewer'

type FileKind = 'pdf' | 'docx' | 'spreadsheet' | 'other'

function getFileKind(source?: string): FileKind {
  switch (source?.split('.').pop()?.toLowerCase()) {
    case 'pdf': return 'pdf'
    case 'docx': return 'docx'
    case 'xlsx': case 'xls': case 'csv': case 'ods': return 'spreadsheet'
    default: return 'other'
  }
}

function tabButtonClass(active: boolean) {
  return `rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
    active ? 'bg-brand text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
  }`
}

interface Chunk { chunk_index: number; chunk_text: string }

interface PreviewData {
  document: Document & { file_path?: string; file_size?: number; source?: string }
  chunks: Chunk[]
  downloadUrl: string | null
}

interface Props {
  docId: string | null
  onClose: () => void
}

function formatBytes(bytes?: number) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ready') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
      <CheckCircle2 className="h-3 w-3" /> Ready
    </span>
  )
  if (status === 'processing') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
      <Clock className="h-3 w-3 animate-spin" /> Processing
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  )
}

export default function DocumentPreview({ docId, onClose }: Props) {
  const [data,    setData]    = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(false)
  const [view,    setView]    = useState<'original' | 'indexed'>('original')

  useEffect(() => {
    if (!docId) return
    setLoading(true)
    setError(false)
    setView('original')
    fetch(`/api/documents/preview?id=${docId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [docId])

  if (!docId) return null

  const doc = data?.document
  const cat = getCategoryByValue(doc?.department)
  const fullText = data?.chunks
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map(c => c.chunk_text)
    .join('\n\n') ?? ''

  const size = formatBytes(doc?.file_size as number | undefined)
  const fileKind = getFileKind(doc?.source)
  const downloadUrl = data?.downloadUrl ?? null
  const canViewOriginal = fileKind !== 'other' && !!downloadUrl
  const activeView: 'original' | 'indexed' = canViewOriginal ? view : 'indexed'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed bottom-0 right-0 z-50 flex flex-col bg-white shadow-2xl
                      w-full md:w-[640px] md:h-full md:border-l md:border-gray-200
                      h-[88vh] rounded-t-3xl md:rounded-none">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border
              ${cat ? `${cat.bgColor} ${cat.borderColor}` : 'bg-gray-50 border-gray-200'}`}>
              {cat
                ? <cat.icon className={`h-5 w-5 ${cat.textColor}`} />
                : <FileText className="h-5 w-5 text-gray-400" />
              }
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-snug">
                {loading ? 'Loading…' : doc?.title ?? 'Document'}
              </p>
              {doc?.source && (
                <p className="mt-0.5 text-[11px] text-gray-400 truncate">{doc.source}</p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {data?.downloadUrl && (
              <a
                href={data.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:border-brand/30 hover:text-brand transition"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Metadata badges ─────────────────────────────────── */}
        {doc && (
          <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
            {cat && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${cat.bgColor} ${cat.borderColor} ${cat.textColor}`}>
                <cat.icon className="h-3 w-3" /> {cat.label}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-500 capitalize">
              {doc.sensitivity}
            </span>
            <StatusBadge status={doc.status} />
            {data && data.chunks.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-light px-2.5 py-1 text-xs font-medium text-brand">
                <Hash className="h-3 w-3" /> {data.chunks.length} chunks
              </span>
            )}
            {size && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-400">
                {size}
              </span>
            )}
          </div>
        )}

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col px-5 py-5">
          {loading ? (
            <div className="space-y-3 animate-pulse overflow-y-auto">
              {[95, 88, 100, 82, 91, 75, 96, 85].map((w, i) => (
                <div key={i} className="h-3 rounded-full bg-gray-100" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12 overflow-y-auto">
              <XCircle className="h-10 w-10 text-red-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">Failed to load preview</p>
              <p className="text-xs text-gray-400 mt-1">Try again or download the original file.</p>
            </div>
          ) : (
            <>
              {canViewOriginal && fullText && (
                <div className="mb-3 flex shrink-0 gap-1">
                  <button onClick={() => setView('original')} className={tabButtonClass(activeView === 'original')}>
                    Original
                  </button>
                  <button onClick={() => setView('indexed')} className={tabButtonClass(activeView === 'indexed')}>
                    Indexed text
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0">
                {activeView === 'original' && downloadUrl ? (
                  <>
                    {fileKind === 'pdf' && <PdfViewer key={docId} url={downloadUrl} />}
                    {fileKind === 'docx' && <DocxViewer key={docId} url={downloadUrl} />}
                    {fileKind === 'spreadsheet' && <SpreadsheetViewer key={docId} url={downloadUrl} />}
                  </>
                ) : fullText ? (
                  <div className="h-full overflow-y-auto">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Indexed content
                    </p>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
                      <p className="text-sm leading-[1.75] text-gray-700 whitespace-pre-wrap">
                        {fullText}
                      </p>
                    </div>
                  </div>
                ) : doc?.status === 'processing' ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <Clock className="h-10 w-10 text-amber-300 mb-3 animate-spin" />
                    <p className="text-sm font-medium text-gray-500">Processing document…</p>
                    <p className="text-xs text-gray-400 mt-1">Content will be available shortly.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <FileText className="h-10 w-10 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No content available</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">
            {activeView === 'original'
              ? 'Original document, rendered in your browser.'
              : 'This is the text the AI has indexed from this document.'}
          </p>
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
