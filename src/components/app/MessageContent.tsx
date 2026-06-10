'use client'

import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Citation } from '@/types'

interface Props {
  text: string
  citations: Citation[]
  onCiteClick: (citation: Citation) => void
}

// Shorten a document title for display inside a pill
function shortTitle(title: string): string {
  // "Knowledge Innovations — Company Overview & History" → "Knowledge Innovations"
  return title.split(' — ')[0].split(' - ')[0].trim()
}

// Inline renderer: **bold** and [1] citation markers
function renderInline(
  text: string,
  citations: Citation[],
  onCiteClick: (c: Citation) => void,
): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g)
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) {
      return <strong key={i} className="font-semibold text-gray-900">{boldMatch[1]}</strong>
    }
    const citeMatch = part.match(/^\[(\d+)\]$/)
    if (citeMatch) {
      const idx = parseInt(citeMatch[1]) - 1
      const citation = citations[idx]
      const label = citation ? shortTitle(citation.document_title) : ''
      return (
        <button
          key={i}
          onClick={() => citation && onCiteClick(citation)}
          title={citation ? citation.document_title : undefined}
          className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-light px-2 py-0.5 mx-0.5 text-[11px] font-semibold text-brand hover:bg-brand hover:text-white hover:border-brand transition cursor-pointer align-middle leading-none"
        >
          <FileText className="h-2.5 w-2.5 shrink-0" />
          <span className="font-black">[{idx + 1}]</span>
          {label && <span className="max-w-[110px] truncate">{label}</span>}
        </button>
      )
    }
    return part ? <span key={i}>{part}</span> : null
  }).filter(Boolean) as React.ReactNode[]
}

// Splits a markdown table row "| a | b |" into ["a", "b"]
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
}

const TABLE_SEPARATOR_RX = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

// Detects values like "1,234.50", "12%", "GHS 1.2bn", "$45,000" — used to
// right-align and tabular-number numeric columns in rendered tables.
function isNumericCell(cell: string): boolean {
  const stripped = cell.replace(/\[\d+\]/g, '').replace(/\*\*/g, '').trim()
  if (!stripped) return false
  return /^[+-]?(GH[S₵]|US\$|\$|₵|GHS)?\s*[\d,]+(\.\d+)?\s*(%|bn|m|k|million|billion|cedis)?$/i.test(stripped)
}

// The model sometimes runs an entire numbered list onto a single line/
// paragraph (e.g. "1. Education saw... 2. Health funding... 3. Infra...").
// If a "block" is really just one line that starts a numbered list, split
// it back into individual items wherever " 2. ", " 3. " etc. appear.
function splitInlineNumbered(line: string): string[] {
  return line.split(/\s+(?=\d{1,2}[.)]\s)/).map(s => s.trim()).filter(Boolean)
}

// Same idea for bullet lists run together with "•" markers
function splitInlineBullets(line: string): string[] {
  return line.split(/\s+(?=•\s)/).map(s => s.trim()).filter(Boolean)
}

// Block renderer: paragraphs, bullet lists, numbered lists, headings, tables
function renderBlock(
  raw: string,
  citations: Citation[],
  onCiteClick: (c: Citation) => void,
  idx: number,
): React.ReactNode {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)

  if (lines.length === 1) {
    if (/^\d{1,2}[.)]\s/.test(lines[0])) {
      lines = splitInlineNumbered(lines[0])
    } else if (/^•\s/.test(lines[0])) {
      lines = splitInlineBullets(lines[0])
    }
  }

  // Markdown table: header row, separator row (---|---), then data rows
  const isTable = lines.length >= 2
    && lines[0].includes('|')
    && TABLE_SEPARATOR_RX.test(lines[1])
  if (isTable) {
    const header = splitTableRow(lines[0])
    const rows = lines.slice(2).map(splitTableRow)

    // Right-align + tabular-number any column (other than the first, which
    // is usually a year/category label) whose data cells are all numeric.
    const numericCol = header.map((_, ci) =>
      ci > 0 && rows.length > 0 && rows.every(r => !r[ci]?.trim() || isNumericCell(r[ci])),
    )

    return (
      <div key={idx} className="my-3 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-light/60">
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    className={cn(
                      'border-b border-gray-200 px-3.5 py-2.5 text-xs font-bold uppercase tracking-wide text-brand whitespace-nowrap',
                      numericCol[ci] ? 'text-right' : 'text-left',
                    )}
                  >
                    {renderInline(cell, citations, onCiteClick)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="transition-colors even:bg-gray-50/60 hover:bg-brand-light/30">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'border-b border-gray-100 px-3.5 py-2.5 text-sm text-gray-700 last:border-r-0',
                        numericCol[ci] ? 'text-right tabular-nums' : 'text-left',
                        ci === 0 && 'font-semibold text-gray-900 whitespace-nowrap',
                      )}
                    >
                      {renderInline(cell, citations, onCiteClick)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const isBullet = lines.every(l => /^[•\-\*]\s/.test(l))
  if (isBullet) {
    return (
      <ul key={idx} className="my-2 space-y-1.5 pl-1">
        {lines.map((l, li) => (
          <li key={li} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
            <span>{renderInline(l.replace(/^[•\-\*]\s/, ''), citations, onCiteClick)}</span>
          </li>
        ))}
      </ul>
    )
  }

  const isNumbered = lines.every(l => /^\d+[\.\)]\s/.test(l))
  if (isNumbered) {
    return (
      <ol key={idx} className="my-2 space-y-1.5 pl-1">
        {lines.map((l, li) => (
          <li key={li} className="flex items-start gap-2.5 text-sm leading-relaxed text-gray-700">
            <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">{li + 1}</span>
            <span>{renderInline(l.replace(/^\d+[\.\)]\s/, ''), citations, onCiteClick)}</span>
          </li>
        ))}
      </ol>
    )
  }

  const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
  if (headingMatch) {
    const level = headingMatch[1].length
    return (
      <p
        key={idx}
        className={cn(
          'font-bold text-gray-900',
          level === 1 ? 'mt-4 mb-2 pb-1.5 border-b border-gray-100 text-base' : 'mt-3 mb-1.5 text-sm',
        )}
      >
        {renderInline(headingMatch[2], citations, onCiteClick)}
      </p>
    )
  }

  const joined = lines.join(' ')
  return (
    <p key={idx} className={`text-sm leading-relaxed text-gray-800 ${idx > 0 ? 'mt-3' : ''}`}>
      {renderInline(joined, citations, onCiteClick)}
    </p>
  )
}

export default function MessageContent({ text, citations, onCiteClick }: Props) {
  const clean = text
    .replace(/^\s*\[ANSWER\]\s*\n?/, '')
    .split('\n[RISKS]')[0]
    .split('\n[RECS]')[0]
    .trim()

  const blocks = clean.split(/\n{2,}/)

  return (
    <div className="space-y-0.5">
      {blocks.map((block, i) => renderBlock(block, citations, onCiteClick, i))}
    </div>
  )
}
