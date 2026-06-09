import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
  if (!['admin', 'exco', 'senior_manager', 'senior', 'middle'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { filename, fileSize } = await request.json() as { filename?: string; fileSize?: number }
  if (!filename) return NextResponse.json({ error: 'No filename provided' }, { status: 400 })
  if (typeof fileSize === 'number' && fileSize > MAX_SIZE) {
    return NextResponse.json({ error: 'File exceeds 500 MB limit' }, { status: 400 })
  }

  const serviceClient = svc()
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
