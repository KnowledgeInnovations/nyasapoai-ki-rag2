'use client'

import { FileText, Clock, CheckCircle2, XCircle } from 'lucide-react'
import type { Document } from '@/types'
import { formatDate } from '@/lib/utils'

interface Props {
  documents?: Document[]
}

const statusConfig = {
  ready: { icon: CheckCircle2, label: 'Ready', color: 'text-green-600 bg-green-50' },
  processing: { icon: Clock, label: 'Processing', color: 'text-amber-600 bg-amber-50' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-red-600 bg-red-50' },
}

export default function DocumentList({ documents = [] }: Props) {
  if (documents.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <FileText className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-500">No documents yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Upload PDFs, Word docs, or spreadsheets to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th className="px-5 py-3 font-medium text-gray-600">Document</th>
            <th className="px-5 py-3 font-medium text-gray-600">Department</th>
            <th className="px-5 py-3 font-medium text-gray-600">Sensitivity</th>
            <th className="px-5 py-3 font-medium text-gray-600">Status</th>
            <th className="px-5 py-3 font-medium text-gray-600">Added</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {documents.map((doc) => {
            const s = statusConfig[doc.status]
            return (
              <tr key={doc.id} className="hover:bg-gray-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span className="font-medium text-gray-900">{doc.title}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-500">{doc.department || '—'}</td>
                <td className="px-5 py-3">
                  <span className="capitalize text-gray-500">{doc.sensitivity}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.color}`}>
                    <s.icon className="h-3 w-3" />
                    {s.label}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500">{formatDate(doc.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
