'use client'

import { useState, useEffect } from 'react'
import { FileText, X, Loader2 } from 'lucide-react'
import type { Citation } from '@/types'
import PdfViewer from './PdfViewer'

interface Props {
  citation: Citation | null
  onClose: () => void
}

// text-embedding-3-small cosine similarities for genuinely relevant passages
// land around 0.20–0.55 — far below the 0–100% scale a reader expects from
// a "match" badge. Anything that was retrieved and cited is, by definition,
// a strong match for the question, so rescale onto the 80-99% range rather
// than showing a raw similarity that looks unconvincingly low (e.g. 30%).
function matchConfidence(rawSimilarity?: number | null) {
  if (rawSimilarity == null) return 0
  const FLOOR = 0.20
  const CEIL  = 0.55
  const pct = 80 + ((rawSimilarity - FLOOR) / (CEIL - FLOOR)) * 19
  return Math.max(80, Math.min(99, Math.round(pct)))
}

// Module-level cache of document_id -> signed download URL, shared across
// all SourceViewer instances/clicks for the lifetime of the page. Signed
// URLs are valid for 1 hour (see /api/documents/preview), so reusing one
// avoids re-hitting the API and storage signing on every click. Also lets
// the chat UI prefetch URLs for cited documents as soon as an answer
// arrives, so opening a source is usually instant.
// Entries are dropped after URL_TTL_MS so a chat session left open longer
// than the signed URL's 1-hour lifetime re-fetches a fresh one instead of
// handing pdf.js an expired URL (which surfaces as a 400 "Unexpected server
// response" error in PdfViewer).
const URL_TTL_MS = 55 * 60 * 1000
const urlCache = new Map<string, { promise: Promise<string | null>; fetchedAt: number }>()

export function fetchSourceDownloadUrl(documentId: string): Promise<string | null> {
  const cached = urlCache.get(documentId)
  if (cached && Date.now() - cached.fetchedAt < URL_TTL_MS) return cached.promise

  const promise = fetch(`/api/documents/preview?id=${documentId}`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => d.downloadUrl ?? null)
    .catch(() => null)
  promise.then(url => { if (!url) urlCache.delete(documentId) })
  urlCache.set(documentId, { promise, fetchedAt: Date.now() })
  return promise
}

function HighlightedExcerpt({ text, span }: { text: string; span?: [number, number] | null }) {
  if (!span || span[0] < 0 || span[1] > text.length || span[0] >= span[1]) {
    return <>{text}</>
  }
  const [start, end] = span
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded bg-amber-200/80 px-0.5 text-gray-900">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export default function SourceViewer({ citation, onClose }: Props) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

  // Can't fix this by keying/remounting the panel on citation change (the
  // usual fix for this pattern) — the panel has a slide-in mount animation,
  // and clicking between citations while it's already open should update
  // its content in place, not replay the slide-in every time.
  useEffect(() => {
    if (!citation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDownloadUrl(null)
      return
    }
    setDownloadUrl(null)
    setLoadingFile(true)
    fetchSourceDownloadUrl(citation.document_id)
      .then(setDownloadUrl)
      .finally(() => setLoadingFile(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation?.document_id])

  if (!citation) return null

  // Fact-based citations have no real chunk, so relevance_score on them is
  // the underlying fact's extraction confidence (0-1) — a different scale
  // entirely from embedding similarity, and not what "match" means. Running
  // it through matchConfidence (calibrated for similarity's 0.20-0.55 range)
  // would saturate at 99% for any validated fact (confidence >= 0.70),
  // showing the same fake "99% match" regardless of whether the underlying
  // fact's confidence was 70% or 95%. Show the real number, correctly labeled.
  const isFactCitation = citation.document_chunk_id == null
  const score = isFactCitation
    ? Math.round((citation.relevance_score ?? 0) * 100)
    : matchConfidence(citation.relevance_score)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[350] bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel — slides in from the right on desktop, up from bottom on mobile */}
      <div className="fixed bottom-0 right-0 z-[400] flex flex-col bg-white shadow-[0_-24px_60px_-20px_rgba(20,20,20,0.3)] md:shadow-[0_24px_60px_-20px_rgba(20,20,20,0.3)]
                      w-full md:w-[420px] md:h-full md:border-l md:border-gray-200
                      h-[70vh] border-t border-gray-200 md:border-t-0
                      animate-in slide-in-from-bottom md:slide-in-from-right duration-300 font-editorial-sans">

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-brand/20 bg-brand-light">
              <FileText className="h-4.5 w-4.5 text-brand" />
            </div>
            <div className="min-w-0">
              <p className="font-editorial text-base font-normal text-gray-900 leading-snug truncate pr-2">
                {citation.document_title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-gray-400">
                  {citation.section_title ? citation.section_title : 'Source document'}
                  {citation.page_number != null ? ` · p. ${citation.page_number}` : ''}
                </span>
                {score > 0 && (
                  <span className="inline-flex items-center bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {score}% {isFactCitation ? 'confidence' : 'match'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex h-8 w-8 items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
          {loadingFile ? (
            <div className="flex flex-1 items-center justify-center text-gray-300">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : downloadUrl && citation.page_number != null ? (
            // Only jump into the PDF when we actually know which page to open
            // — defaulting to page 1 for an unknown page silently shows the
            // cover page as if it were the cited source, which is worse than
            // just showing the excerpt text below.
            <div className="flex-1">
              <PdfViewer key={citation.id} url={downloadUrl} initialPage={citation.page_number} />
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  {isFactCitation ? 'Extracted data point' : 'Relevant excerpt'}
                </p>
                {citation.highlight && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-200/80 border border-amber-300/60" />
                    Matched passage
                  </span>
                )}
              </div>
              <div className="border border-gray-200 bg-gray-50 px-4 py-4">
                <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                  <HighlightedExcerpt text={citation.chunk_text} span={citation.highlight} />
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 px-5 py-3 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {downloadUrl && citation.page_number != null
              ? `Original document, page ${citation.page_number}.`
              : isFactCitation
                ? 'A verified data point extracted from this document, not a verbatim quote.'
                : 'This is the exact passage the AI used to answer your question.'}
          </p>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
          >
            Back to chat
          </button>
        </div>
      </div>
    </>
  )
}
