'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface Props {
  url: string
}

interface SheetData {
  name: string
  html: string
}

export default function SpreadsheetViewer({ url }: Props) {
  const [sheets, setSheets]   = useState<SheetData[] | null>(null)
  const [active, setActive]   = useState(0)
  const [error, setError]     = useState(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const [XLSX, res] = await Promise.all([
          import('xlsx'),
          fetch(url),
        ])
        if (!res.ok) throw new Error('download failed')
        const arrayBuffer = await res.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const parsed = workbook.SheetNames.map(name => ({
          name,
          html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { header: '', footer: '' }),
        }))
        if (!cancelled) setSheets(parsed)
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
        <p className="text-sm font-medium text-gray-500">Couldn&apos;t render this spreadsheet</p>
        <p className="text-xs text-gray-400 mt-1">Try downloading the original file instead.</p>
      </div>
    )
  }

  if (!sheets) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-300">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {sheets.length > 1 && (
        <div className="mb-3 flex shrink-0 gap-1 overflow-x-auto">
          {sheets.map((sheet, i) => (
            <button
              key={sheet.name}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                i === active
                  ? 'bg-brand text-white'
                  : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-2xl border border-gray-100 bg-white p-4">
        <div
          className="spreadsheet-preview text-sm [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium"
          dangerouslySetInnerHTML={{ __html: sheets[active].html }}
        />
      </div>
    </div>
  )
}
