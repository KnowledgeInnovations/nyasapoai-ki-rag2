import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { rowsOrEmpty } from '@/lib/dbResult'
import type { ExpectedKind } from '@/lib/goldenSet'

/**
 * A workspace's golden set: the questions whose correct answer is known,
 * which is the only thing that makes "the answers are accurate" a
 * measurement rather than a claim.
 *
 * Reads are open to every member — a team should be able to see what their
 * system is graded against — and writes are Senior-only, because changing
 * an expected answer changes what "correct" means.
 */

const KINDS: ExpectedKind[] = ['figure', 'set', 'absent', 'claim']

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET() {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })

  const service = svc()
  const questions = rowsOrEmpty(
    await service
      .from('golden_questions')
      .select('id, question, expected_answer, expected_kind, expected_value, source_page, document_id, verified_by, verified_at, notes, created_at')
      .eq('tenant_id', membership.tenant_id)
      .order('created_at'),
    `golden questions for workspace ${membership.tenant_id}`,
  )

  const runs = rowsOrEmpty(
    await service
      .from('golden_runs')
      .select('id, questions, correct, results, calibration, created_at')
      .eq('tenant_id', membership.tenant_id)
      .order('created_at', { ascending: false })
      .limit(10),
    `golden runs for workspace ${membership.tenant_id}`,
  )

  // Drafts are separated here rather than in the interface, so there is one
  // definition of what counts: a question nobody has confirmed does not
  // contribute to accuracy, however plausible it looks.
  const verified = questions.filter(q => !!(q as { verified_at?: string }).verified_at)
  const drafts = questions.filter(q => !(q as { verified_at?: string }).verified_at)

  return NextResponse.json({ verified, drafts, runs })
}

interface QuestionBody {
  question?: string
  expected_answer?: string
  expected_kind?: string
  expected_value?: Record<string, unknown>
  source_page?: number | null
  document_id?: string | null
  notes?: string | null
  /** Set by the person confirming the answer is right. */
  verify?: boolean
}

/** Shape-checks the expected value against the kind it claims to be. */
function invalidValue(kind: ExpectedKind, value: Record<string, unknown>): string | null {
  if (kind === 'figure') {
    return typeof value.value === 'number' && Number.isFinite(value.value)
      ? null
      : 'A figure question needs expected_value.value as a number.'
  }
  if (kind === 'set') {
    return Array.isArray(value.members) && value.members.length
      ? null
      : 'A set question needs expected_value.members as a non-empty list.'
  }
  if (kind === 'claim') {
    return Array.isArray(value.must_include) && value.must_include.length
      ? null
      : 'A claim question needs expected_value.must_include as a non-empty list.'
  }
  return null // 'absent' carries no value: the expected answer is that there is none.
}

export async function POST(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })
  if (!canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Only Senior users can change the golden set' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as QuestionBody | null
  if (!body?.question?.trim()) return NextResponse.json({ error: 'A question is required' }, { status: 400 })
  if (!body.expected_answer?.trim()) {
    return NextResponse.json({ error: 'An expected answer is required' }, { status: 400 })
  }
  const kind = (body.expected_kind ?? 'figure') as ExpectedKind
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: `expected_kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
  }
  const value = body.expected_value ?? {}
  const valueError = invalidValue(kind, value)
  if (valueError) return NextResponse.json({ error: valueError }, { status: 400 })

  const service = svc()
  const { data, error } = await service.from('golden_questions').insert({
    tenant_id: membership.tenant_id,
    document_id: body.document_id ?? null,
    source_page: body.source_page ?? null,
    question: body.question.trim(),
    expected_answer: body.expected_answer.trim(),
    expected_kind: kind,
    expected_value: value,
    notes: body.notes ?? null,
    // Someone adding a question by hand has, by doing so, said what the
    // answer is. A drafted question arrives without this and stays a draft
    // until confirmed.
    ...(body.verify === false ? {} : { verified_by: user.email ?? user.id, verified_at: new Date().toISOString() }),
  }).select('id').single()

  if (error) {
    console.error('[golden-questions] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the question' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function PATCH(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })
  if (!canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Only Senior users can change the golden set' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as (QuestionBody & { id?: string }) | null
  if (!body?.id) return NextResponse.json({ error: 'Which question?' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.question?.trim()) patch.question = body.question.trim()
  if (body.expected_answer?.trim()) patch.expected_answer = body.expected_answer.trim()
  if (body.expected_kind) {
    const kind = body.expected_kind as ExpectedKind
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: `expected_kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
    }
    patch.expected_kind = kind
    const valueError = invalidValue(kind, body.expected_value ?? {})
    if (valueError) return NextResponse.json({ error: valueError }, { status: 400 })
  }
  if (body.expected_value) patch.expected_value = body.expected_value
  if (body.source_page !== undefined) patch.source_page = body.source_page
  if (body.notes !== undefined) patch.notes = body.notes

  // Confirming is the act that turns a draft into ground truth, so it
  // records who did it. Any edit to what the answer IS re-opens that:
  // whoever changed it is now the person vouching for it.
  if (body.verify || patch.expected_answer || patch.expected_value) {
    patch.verified_by = user.email ?? user.id
    patch.verified_at = new Date().toISOString()
  }

  const service = svc()
  const { error } = await service
    .from('golden_questions')
    .update(patch)
    .eq('id', body.id)
    // Scoped by tenant as well as id, so a question id from another
    // workspace cannot be edited with a valid session.
    .eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('[golden-questions] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save the change' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const membership = await getMembership()
  if (!membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })
  if (!canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Only Senior users can change the golden set' }, { status: 403 })
  }
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Which question?' }, { status: 400 })

  const service = svc()
  const { error } = await service
    .from('golden_questions').delete()
    .eq('id', id).eq('tenant_id', membership.tenant_id)

  if (error) {
    console.error('[golden-questions] delete failed:', error.message)
    return NextResponse.json({ error: 'Could not remove the question' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
