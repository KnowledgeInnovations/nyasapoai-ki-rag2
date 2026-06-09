import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
  if (!['admin', 'exco', 'senior_manager', 'senior', 'middle'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json()
  const { value, label, description = '', iconName = 'folder', colorName = 'blue' } = body

  if (!value || !label) {
    return NextResponse.json({ error: 'value and label are required' }, { status: 400 })
  }

  // Service role bypasses RLS — auth already validated above
  const { data, error } = await svc()
    .from('tenant_categories')
    .upsert(
      {
        tenant_id:   membership.tenant_id,
        value,
        label,
        description,
        icon_name:   iconName,
        color_name:  colorName,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: 'tenant_id,value' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('Category upsert error:', error)
    return NextResponse.json({ error: 'Failed to save category' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
