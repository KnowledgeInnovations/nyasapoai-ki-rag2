'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface Props {
  url: string
  /**
   * A passage to scroll to and highlight once the document has rendered.
   *
   * A Word file has no pages, so a citation into one could name its
   * section and show its text but could not put the reader at the place it
   * came from — 94 citations in this deployment. Giving the viewer the
   * cited text lets it do for Word what opening at a page number does for
   * a PDF.
   */
  highlight?: string | null
}

export default function DocxViewer({ url, highlight }: Props) {
  const [html, setHtml]   = useState<string | null>(null)
  const [error, setError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const [{ default: mammoth }, { default: DOMPurify }, res] = await Promise.all([
          import('mammoth'),
          import('dompurify'),
          fetch(url),
        ])
        if (!res.ok) throw new Error('download failed')
        const arrayBuffer = await res.arrayBuffer()
        const { value } = await mammoth.convertToHtml({ arrayBuffer })
        // mammoth converts to a clean semantic subset rather than passing
        // through raw embedded HTML, so this is lower-risk than the xlsx
        // case — sanitizing anyway for defense in depth on untrusted uploads.
        if (!cancelled) setHtml(DOMPurify.sanitize(value))
      } catch {
        if (!cancelled) setError(true)
      }
    }

    render()
    return () => { cancelled = true }
  }, [url])

  // Finds the cited passage in the rendered document, scrolls it into view
  // and marks it. Runs after the HTML lands, since there is nothing to
  // search before that.
  useEffect(() => {
    if (!html || !highlight || !containerRef.current) return
    const root = containerRef.current
    // Match on a distinctive opening fragment rather than the whole
    // excerpt: the chunk text carries a document-title prefix and
    // normalised whitespace, so it rarely matches the rendered HTML
    // verbatim.
    const needle = highlight
      .replace(/^\[Document:[^\]]*\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
    if (needle.length < 15) return

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ')
      if (!text.includes(needle.slice(0, 30))) continue
      const element = node.parentElement
      if (!element) continue
      element.scrollIntoView({ block: 'center' })
      element.style.backgroundColor = 'rgb(254 243 199)'
      element.style.transition = 'background-color 600ms'
      return
    }
  }, [html, highlight])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center py-12">
        <AlertCircle className="h-10 w-10 text-red-300 mb-3" />
        <p className="text-sm font-medium text-gray-500">Couldn&apos;t render this document</p>
        <p className="text-xs text-gray-400 mt-1">Try downloading the original file instead.</p>
      </div>
    )
  }

  if (!html) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-300">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto  border border-gray-100 bg-white p-6">
      <div
        className="docx-preview prose prose-sm max-w-none prose-headings:font-semibold prose-table:border prose-td:border prose-td:border-gray-200 prose-td:px-2 prose-td:py-1 prose-th:border prose-th:border-gray-200 prose-th:px-2 prose-th:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
