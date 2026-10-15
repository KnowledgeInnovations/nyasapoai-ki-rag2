import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant, getWorkspaceStatus } from '@/lib/supabase/server'
import { workspaceAccess, STATUS_LABELS } from '@/lib/workspaceStatus'
import { ShieldCheck, Mail } from 'lucide-react'

export const metadata: Metadata = { title: 'Workspace unavailable — Nyansa AI' }

/**
 * Where members land when their workspace is not currently usable.
 *
 * The emphasis throughout is that nothing has been lost. The most likely
 * reader is someone whose organisation is late settling an invoice, and the
 * fear that their document set has been deleted is both the first thing they
 * will assume and the easiest to put right.
 */
export default async function WorkspaceUnavailablePage() {
  const membership = await getMembership()
  if (!membership) redirect('/auth/login')

  const [tenant, raw] = await Promise.all([
    getTenant(membership.tenant_id),
    getWorkspaceStatus(membership.tenant_id),
  ])
  const access = workspaceAccess(raw.status, raw.access_until)

  // Usable again — don't strand anyone on this page.
  if (access.allowed) redirect('/ask')

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 font-editorial-sans">
      <div className="w-full max-w-lg border border-gray-200 bg-white p-10 shadow-sm">
        <div className="font-editorial mb-8 text-[21px] text-gray-900">
          Nyansa<span className="text-brand">·</span>AI
        </div>

        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          {STATUS_LABELS[access.status]}
        </div>
        <h1 className="font-editorial mb-4 text-[28px] leading-tight text-gray-900">
          {tenant?.name ?? 'This workspace'} is not available right now
        </h1>

        <p className="mb-8 text-sm leading-relaxed text-gray-600">{access.reason}</p>

        <div className="mb-8 flex items-start gap-3 border border-gray-200 bg-gray-50 px-5 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div className="text-[13px] leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">Nothing has been deleted.</span>{' '}
            Every document, extracted figure and past answer is retained in full.
            Access returns exactly as it was once the workspace is reactivated.
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-gray-500">
          A Senior user in your organisation can resolve this from the billing
          settings. If you are not sure who that is, or you believe this is a
          mistake, contact us and we will sort it out.
        </p>

        <a
          href="mailto:no-reply@nyansaai.com"
          className="mt-6 inline-flex items-center gap-2 border border-gray-900 px-5 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-900 hover:text-white"
        >
          <Mail className="h-4 w-4" />
          Contact support
        </a>
      </div>
    </div>
  )
}
