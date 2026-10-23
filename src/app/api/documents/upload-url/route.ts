import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizeRole, canUploadDocuments } from '@/lib/roles'
import { limitsFor, canAddDocument, canStore } from '@/lib/plans'
import { knownCount, rowsOrEmpty } from '@/lib/dbResult'

const MAX_SIZE = 500 * 1024 * 1024 // 500 MB

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
  if (!canUploadDocuments(normalizeRole(membership.role))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { filename, fileSize } = await request.json() as { filename?: string; fileSize?: number }
  if (!filename) return NextResponse.json({ error: 'No filename provided' }, { status: 400 })
  if (typeof fileSize === 'number' && fileSize > MAX_SIZE) {
    return NextResponse.json({ error: 'File exceeds 500 MB limit' }, { status: 400 })
  }

  const serviceClient = svc()

  // The plan's document and storage allowances, enforced here.
  //
  // Both checks existed in plans.ts and were called from nowhere, so every
  // workspace had unlimited documents and unlimited storage whatever it
  // was paying for — the user allowances were enforced and these two
  // simply were not wired up. Checked before the signed URL is issued,
  // which is the last point at which an upload can be declined without
  // having already paid to transfer and store the file.
  // Only columns that exist: asking for a per-tenant overrides column that
  // has not been added would make this query error, leave the plan
  // unknown, and silently apply the strictest tier's limits to every
  // workspace — denying uploads to the customers paying most.
  const { data: tenantRow, error: tenantError } = await serviceClient
    .from('tenants').select('plan').eq('id', membership.tenant_id).maybeSingle()
  if (tenantError) {
    console.error('[upload] plan not determined, allowances not enforced:', tenantError.message)
  }
  // Not knowing the plan means not enforcing it. The alternative — assuming
  // the smallest plan — would block paying customers over a failed read,
  // and a missed limit costs us a document while a wrong denial costs them
  // their work.
  const limits = tenantError ? null : limitsFor((tenantRow as { plan?: string } | null)?.plan)

  const documentCount = knownCount(
    await serviceClient
      .from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', membership.tenant_id),
    `documents in workspace ${membership.tenant_id}`,
  )
  // An undetermined count must not deny a legitimate upload, and must not
  // wave through an unlimited one either: the count is retried once and,
  // failing that, the upload proceeds and the limit is logged as
  // unverified. Denying on a transient error would block a paying
  // customer's work; the alternative risks one document over the line.
  if (limits && documentCount != null) {
    const check = canAddDocument(limits, documentCount)
    if (!check.allowed) return NextResponse.json({ error: check.reason }, { status: 402 })
  } else {
    console.error('[upload] document allowance not verified for tenant', membership.tenant_id)
  }

  if (limits && typeof fileSize === 'number' && limits.maxStorageBytes != null) {
    const sizes = rowsOrEmpty(
      await serviceClient
        .from('documents').select('file_size').eq('tenant_id', membership.tenant_id),
      `stored bytes for workspace ${membership.tenant_id}`,
    ) as { file_size: number | null }[]
    const storedBytes = sizes.reduce((total, row) => total + (row.file_size ?? 0), 0)
    const check = canStore(limits, storedBytes, fileSize)
    if (!check.allowed) return NextResponse.json({ error: check.reason }, { status: 402 })
  }

  await serviceClient.storage.createBucket('documents', { public: false }).catch(() => {})

  const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const storagePath  = `${membership.tenant_id}/${Date.now()}-${safeFilename}`

  const { data, error } = await serviceClient.storage.from('documents').createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('Signed upload URL error:', error)
    return NextResponse.json({ error: `Could not start upload: ${error?.message ?? 'unknown error'}` }, { status: 500 })
  }

  return NextResponse.json({ path: data.path, token: data.token })
}
