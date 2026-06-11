import { NextRequest, NextResponse } from 'next/server'
import { getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { getServiceClient } from '@/app/api/chat/route'

export async function GET(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const documentId = new URL(request.url).searchParams.get('documentId')
  const svc = getServiceClient()

  let query = svc
    .from('search_reviews')
    .select('verdict')
    .eq('tenant_id', membership.tenant_id)

  query = documentId ? query.eq('document_id', documentId) : query.is('document_id', null)

  const { data } = await query
  const total = data?.length ?? 0
  const correct = data?.filter(r => r.verdict === 'correct').length ?? 0
  const accuracy = total > 0 ? Math.round((correct / total) * 10000) / 100 : null

  return NextResponse.json({ total, correct, accuracy })
}
