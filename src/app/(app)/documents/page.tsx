import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership, getTenant, createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import DocumentsClient from '@/components/app/DocumentsClient'
import type { Document } from '@/types'
import { mergeWithDbCategories, type DbCategory } from '@/lib/documentCategories'
import { canUploadDocuments, canDeleteDocuments, isPlatformTenant } from '@/lib/roles'
import { buildFactCountMap } from '@/lib/factCounts'

export const metadata: Metadata = { title: 'Documents - Nyansa AI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function DocumentsPage() {
  const membership = await getMembership()
  // Documents are a client-tenant feature — the platform tenant manages
  // other tenants, not its own reference documents, from /admin/tenants.
  if (membership && isPlatformTenant(await getTenant(membership.tenant_id))) redirect('/admin/tenants')

  let documents:         Document[] = []
  let canUpload  = false
  let canDelete  = false
  let initialCategories = mergeWithDbCategories([])

  if (membership) {
    canUpload = canUploadDocuments(membership.role)
    canDelete = canDeleteDocuments(membership.role)

    const supabase = await createClient()
    const service = svc()
    const [{ data: docs }, { data: dbCats }, financialFactCounts, documentFactCounts] = await Promise.all([
      supabase
        .from('documents')
        .select('*')
        .eq('tenant_id', membership.tenant_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('tenant_categories')
        .select('id, value, label, description, icon_name, color_name')
        .eq('tenant_id', membership.tenant_id),
      // financial_facts/document_facts have no RLS policy — access is via
      // the service-role client only, same as the training pipeline routes.
      buildFactCountMap(service, 'financial_facts', membership.tenant_id),
      buildFactCountMap(service, 'document_facts', membership.tenant_id),
    ])

    documents = ((docs as Document[]) ?? []).map(d => ({
      ...d,
      financial_fact_count: financialFactCounts.get(d.id) ?? 0,
      document_fact_count: documentFactCounts.get(d.id) ?? 0,
    }))
    initialCategories = mergeWithDbCategories((dbCats as DbCategory[]) ?? [])
  }

  return (
    <DocumentsClient
      initialDocuments={documents}
      canUpload={canUpload}
      canDelete={canDelete}
      initialCategories={initialCategories}
    />
  )
}
