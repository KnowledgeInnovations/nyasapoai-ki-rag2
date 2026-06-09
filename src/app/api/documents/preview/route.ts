import { NextRequest, NextResponse } from 'next/server'
import { getUser, getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user)       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!membership) return NextResponse.json({ error: 'No workspace' },  { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = svc()

  // Verify document belongs to this tenant
  const { data: doc } = await db
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', membership.tenant_id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch indexed text chunks in order
  const { data: chunks } = await db
    .from('document_chunks')
    .select('chunk_index, chunk_text')
    .eq('document_id', id)
    .order('chunk_index', { ascending: true })

  // Generate a 1-hour signed download URL if the original file exists
  let downloadUrl: string | null = null
  if (doc.file_path) {
    const { data: signed } = await db.storage
      .from('documents')
      .createSignedUrl(doc.file_path, 3600)
    downloadUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({ document: doc, chunks: chunks ?? [], downloadUrl })
}
