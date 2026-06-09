'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface Props {
  url: string
}

export default function DocxViewer({ url }: Props) {
  const [html, setHtml]   = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const [{ default: mammoth }, res] = await Promise.all([
          import('mammoth'),
          fetch(url),
        ])
        if (!res.ok) throw new Error('download failed')
        const arrayBuffer = await res.arrayBuffer()
        const { value } = await mammoth.convertToHtml({ arrayBuffer })
        if (!cancelled) setHtml(value)
      } catch {
        if (!cancelled) setError(true)
      }
    }

    render()
    return () => { cancelled = true }
  }, [url])

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
    <div className="h-full overflow-auto rounded-2xl border border-gray-100 bg-white p-6">
      <div
        className="docx-preview prose prose-sm max-w-none prose-headings:font-semibold prose-table:border prose-td:border prose-td:border-gray-200 prose-td:px-2 prose-td:py-1 prose-th:border prose-th:border-gray-200 prose-th:px-2 prose-th:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
