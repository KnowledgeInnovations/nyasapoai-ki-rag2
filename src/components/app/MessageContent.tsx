'use client'

import { FileText } from 'lucide-react'
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

// Block renderer: paragraphs, bullet lists, numbered lists, headings
function renderBlock(
  raw: string,
  citations: Citation[],
  onCiteClick: (c: Citation) => void,
  idx: number,
): React.ReactNode {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)

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

  const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/)
  if (headingMatch) {
    return (
      <p key={idx} className="mt-3 mb-1 font-bold text-gray-900 text-sm">
        {renderInline(headingMatch[1], citations, onCiteClick)}
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
