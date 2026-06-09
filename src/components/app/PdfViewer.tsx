'use client'

import { useState, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface Props {
  url: string
}

export default function PdfViewer({ url }: Props) {
  const [numPages, setNumPages]   = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError]         = useState(false)
  const [width, setWidth]         = useState<number>()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.min(entry.contentRect.width - 32, 760))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="flex-1 overflow-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center text-center py-12">
            <AlertCircle className="h-10 w-10 text-red-300 mb-3" />
            <p className="text-sm font-medium text-gray-500">Couldn&apos;t render this PDF</p>
            <p className="text-xs text-gray-400 mt-1">Try downloading the original file instead.</p>
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={() => setError(true)}
            loading={
              <div className="flex h-64 items-center justify-center text-gray-300">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            }
            className="flex justify-center"
          >
            <Page
              pageNumber={pageNumber}
              width={width}
              renderAnnotationLayer
              renderTextLayer
              loading={
                <div className="flex h-64 items-center justify-center text-gray-300">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              }
              className="overflow-hidden rounded-xl shadow-sm [&>canvas]:rounded-xl"
            />
          </Document>
        )}
      </div>

      {!error && numPages && numPages > 1 && (
        <div className="mt-3 flex shrink-0 items-center justify-center gap-3">
          <button
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:bg-gray-50 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium text-gray-500 tabular-nums">
            Page {pageNumber} of {numPages}
          </span>
          <button
            onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:bg-gray-50 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
