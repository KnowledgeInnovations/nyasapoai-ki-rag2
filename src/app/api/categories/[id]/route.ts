import { NextRequest, NextResponse } from 'next/server'
import { createClient, getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizeRole, canManageCategories } from '@/lib/roles'

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

  // getMembership() rather than a lookup of its own: it is the one place
  // that knows a person can belong to more than one workspace and that the
  // host decides which. This used to end in .single(), which errors on a
  // second membership row and reported "No workspace found" to someone who
  // had two.
  const membership = await getMembership()

  if (!membership) return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
  if (!canManageCategories(normalizeRole(membership.role))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Service role bypasses RLS — auth already validated above
  const { error } = await svc()
    .from('tenant_categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('Category delete error:', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
