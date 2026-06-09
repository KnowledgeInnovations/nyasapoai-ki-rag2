import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const DELETE_ROLES = ['admin']

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
  if (!DELETE_ROLES.includes(membership.role)) {
    return NextResponse.json({ error: 'Only admins can delete documents' }, { status: 403 })
  }

  const service = svc()

  // Fetch the document to get file_path (scoped to this tenant)
  const { data: doc, error: fetchError } = await service
    .from('documents')
    .select('id, file_path, tenant_id')
    .eq('id', id)
    .eq('tenant_id', membership.tenant_id)
    .single()

  if (fetchError || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // 1. Delete all chunks (must be before document due to FK)
  await service.from('document_chunks').delete().eq('document_id', id)

  // 2. Delete the document record
  const { error: deleteError } = await service.from('documents').delete().eq('id', id)
  if (deleteError) {
    console.error('Document delete error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete document record' }, { status: 500 })
  }

  // 3. Delete the file from storage (best-effort — don't fail if already gone)
  if (doc.file_path) {
    await service.storage.from('documents').remove([doc.file_path]).catch(() => {})
  }

  return NextResponse.json({ success: true })
}
