import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getTenantLogoPath, invalidateTenant, invalidateTenantLogo } from '@/lib/supabase/server'
import { TENANT_LOGO_BUCKET, publicUrlFor } from '@/lib/tenantLogo'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const BUCKET = TENANT_LOGO_BUCKET

const MAX_SIZE = 1024 * 1024 // 1 MB — this is an icon, not a document
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/svg+xml'])
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/svg+xml': 'svg',
}

// Senior-only, and always scoped to the caller's own tenant — no id parameter,
// so a senior admin of one tenant can't rebrand another by guessing an id
// (same reasoning as the email-domains route).
export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || membership.role !== 'senior') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Logo must be 1 MB or smaller' }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'Logo must be a PNG, JPEG, WebP, SVG or ICO image' }, { status: 400 })
  }

  const tenant = await getTenant(membership.tenant_id)
  if (!tenant) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Read the outgoing path before overwriting it, via the error-tolerant
  // lookup — getTenant() deliberately doesn't select logo_path.
  const previous = await getTenantLogoPath(tenant.subdomain)

  const service = svc()
  await service.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const path = `${membership.tenant_id}/${Date.now()}.${EXT[file.type]}`
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    console.error('Tenant logo upload error:', uploadError)
    return NextResponse.json({ error: 'Could not upload logo' }, { status: 500 })
  }

  const { error } = await service
    .from('tenants')
    .update({ logo_path: path })
    .eq('id', membership.tenant_id)

  if (error) {
    console.error('Tenant logo update error:', error)
    // Most likely cause: migration 033 hasn't run against this database yet.
    return NextResponse.json(
      { error: 'Could not save logo. If this persists, migration 033_tenant_logo.sql may not have been applied.' },
      { status: 500 }
    )
  }

  // Drop the previous file so a tenant's old logos don't accumulate in the
  // bucket forever — best-effort, a leftover object is harmless.
  if (previous && previous !== path) {
    await service.storage.from(BUCKET).remove([previous]).catch(() => {})
  }

  invalidateTenant(membership.tenant_id)
  invalidateTenantLogo(tenant.subdomain)
  return NextResponse.json({ logoPath: path, url: publicUrlFor(path) })
}

// Clear the custom logo — the tenant falls back to the Nyansa AI default.
export async function DELETE() {
  const membership = await getMembership()
  if (!membership || membership.role !== 'senior') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tenant = await getTenant(membership.tenant_id)
  if (!tenant) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Read the outgoing path before clearing the column, not after — afterwards
  // the row says null and the old object would be orphaned in the bucket.
  const previous = await getTenantLogoPath(tenant.subdomain)

  const service = svc()
  const { error } = await service
    .from('tenants')
    .update({ logo_path: null })
    .eq('id', membership.tenant_id)

  if (error) {
    console.error('Tenant logo clear error:', error)
    return NextResponse.json({ error: 'Could not remove logo' }, { status: 500 })
  }

  if (previous) await service.storage.from(BUCKET).remove([previous]).catch(() => {})

  invalidateTenant(membership.tenant_id)
  invalidateTenantLogo(tenant.subdomain)
  return NextResponse.json({ logoPath: null })
}
