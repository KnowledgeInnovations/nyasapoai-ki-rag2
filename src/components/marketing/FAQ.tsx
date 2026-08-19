'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

const faqs = [
  {
    q: 'Is our data secure and private?',
    a: 'Yes. All data is encrypted in transit and at rest using AES-256. Your documents are stored in a dedicated, isolated workspace — no data is ever shared across tenants. Role-based access control ensures every team member sees only what they are cleared for.',
  },
  {
    q: 'Do I need to train the AI or set anything up?',
    a: 'No setup or training required. Upload your documents and start asking questions immediately. The AI reads and understands your documents automatically — PDFs, contracts, site reports, spreadsheets, and more.',
  },
  {
    q: 'What file formats are supported?',
    a: 'We support PDF (including scanned documents via OCR), Word (DOCX), Excel (XLSX), CSV, and plain text. Bulk upload is available for large document libraries. New formats are added regularly.',
  },
  {
    q: 'How accurate are the answers?',
    a: "Every answer is grounded directly in your uploaded documents and includes exact source citations — document name, page number, and section. You can verify any response in seconds. If the information isn't in your documents, the system tells you that, rather than guessing.",
  },
  {
    q: 'Can we control who sees which documents?',
    a: 'Yes. Full role-based access control is built in. Executives can access everything; project managers see their projects; site teams see only relevant site documents. Permissions are managed at the document and folder level.',
  },
  {
    q: 'How quickly can our team get started?',
    a: 'Your workspace is already configured. Log in, upload your first documents, and start asking questions within minutes. Most teams complete their first useful query within 15 minutes of signing in.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      {faqs.map((item, i) => (
        <div key={i} className={cn(
          'border transition-all duration-200',
          open === i
            ? 'border-brand/20 bg-brand-light'
            : 'border-gray-200 bg-white hover:border-gray-300'
        )}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
          >
            <span className="text-sm font-semibold text-gray-900 leading-snug">{item.q}</span>
            <span className={cn(
              'shrink-0 flex h-6 w-6 items-center justify-center rounded-full transition-colors',
              open === i ? 'bg-brand/10' : 'bg-gray-100'
            )}>
              {open === i
                ? <Minus className="h-3.5 w-3.5 text-brand" />
                : <Plus className="h-3.5 w-3.5 text-gray-400" />
              }
            </span>
          </button>
          {open === i && (
            <div className="px-6 pb-5">
              <p className="text-sm leading-relaxed text-gray-500">{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
