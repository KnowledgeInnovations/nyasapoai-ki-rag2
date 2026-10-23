import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { mustRows } from '@/lib/dbResult'
import { gradeAnswer, calibration, miscalibrated, type GoldenQuestion, type GradedAnswer } from '@/lib/goldenSet'

/**
 * Asks a workspace's golden questions, grades the answers against the
 * known-correct ones, and reports accuracy and confidence calibration.
 *
 * The distinction this route exists to make: the older self-assessment
 * suite scores an answer on its confidence and whether it cited anything,
 * and stores no expected answer, so it cannot tell a right answer from a
 * wrong one. This compares against an answer a person confirmed against a
 * named page.
 *
 * Only confirmed questions are counted. A drafted question is a guess
 * about what the right answer is, and grading against guesses measures
 * agreement with ourselves — which is what made the older suite
 * circular, since its questions were generated from our own extractions.
 */

export const maxDuration = 300

// Each question is a full retrieval-and-answer cycle, 20-40s apiece. A
// budget rather than a count, so a long set reports what it got through
// instead of being killed mid-run with nothing to show.
const RUN_BUDGET_MS = 260_000

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })
  if (!canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Only Senior users can run the golden set' }, { status: 403 })
  }

  const service = svc()
  const deadline = Date.now() + RUN_BUDGET_MS
  // Asking the questions means calling the chat route as this user, so
  // their own session travels with each request — the answers must be the
  // ones they would actually get.
  const cookie = request.headers.get('cookie') ?? ''
  const origin = request.nextUrl.origin

  let questions: GoldenQuestion[]
  try {
    questions = mustRows<GoldenQuestion & { verified_at: string | null }>(
      await service
        .from('golden_questions')
        .select('id, question, expected_answer, expected_kind, expected_value, source_page, document_id, notes, verified_at')
        .eq('tenant_id', membership.tenant_id)
        .not('verified_at', 'is', null)
        .order('created_at'),
      'the golden questions for this workspace',
    )
  } catch (e) {
    // A failed read must not report an empty set as a perfect score.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  if (!questions.length) {
    return NextResponse.json({
      error: 'No confirmed questions yet. Add some, or draft them from a document and confirm the answers.',
    }, { status: 400 })
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))

      const results: GradedAnswer[] = []
      let ranOut = false

      for (const [index, question] of questions.entries()) {
        if (Date.now() > deadline) { ranOut = true; break }
        send({ stage: 'asking', index, total: questions.length, question: question.question })

        let graded: GradedAnswer
        try {
          const res = await fetch(`${origin}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ query: question.question, newSession: true }),
            signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
          })
          if (!res.ok) throw new Error(`the assistant returned ${res.status}`)
          const text = await res.text()
          const lines = text.split('\n').filter(l => l.startsWith('data: '))
          const last = JSON.parse(lines[lines.length - 1].slice(6))
          graded = gradeAnswer(
            question,
            String(last.answer ?? ''),
            Number(last.confidence_score ?? 0),
            (last.citations ?? []).length,
          )
        } catch (e) {
          graded = {
            id: question.id, question: question.question, correct: false,
            reason: `Could not get an answer: ${(e as Error).message}`,
            confidence: 0, citations: 0, answer: '',
          }
        }
        results.push(graded)
        send({ stage: 'result', index, total: questions.length, ...graded })
      }

      const correct = results.filter(r => r.correct).length
      const bands = calibration(results)
      const { confidentlyWrong, needlesslyDoubted } = miscalibrated(results)

      const { error: saveError } = await service.from('golden_runs').insert({
        tenant_id: membership.tenant_id,
        ran_by: user.id,
        questions: results.length,
        correct,
        results,
        calibration: bands,
      })
      if (saveError) console.error('[golden-run] could not store the run:', saveError.message)

      send({
        stage: 'complete',
        questions: results.length,
        asked: results.length,
        skipped: questions.length - results.length,
        correct,
        accuracy: results.length ? Math.round((correct / results.length) * 100) : null,
        calibration: bands,
        confidentlyWrong: confidentlyWrong.length,
        needlesslyDoubted: needlesslyDoubted.length,
        ranOutOfTime: ranOut,
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  })
}
