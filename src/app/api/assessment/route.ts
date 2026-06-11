import { NextRequest, NextResponse } from 'next/server'
import { getMembership, getUser } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { getServiceClient } from '@/app/api/chat/route'
import { generateAssessmentQuestions, runAssessmentQuery, scoreResult } from '@/lib/assessmentEngine'

export const maxDuration = 300 // up to ~12 questions, each with 1-2 OpenAI calls

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' }
}

export async function POST(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { documentId = null } = await request.json().catch(() => ({}))
  const svc = getServiceClient()
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: object) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        send({ stage: 'generating', message: 'Generating test questions from validated facts…', progress: 5 })

        const questions = await generateAssessmentQuestions(svc, membership.tenant_id, documentId, 12, request.signal)

        if (!questions.length) {
          send({ stage: 'error', message: 'No trained documents or validated facts to assess yet.', progress: -1 })
          return
        }

        const results: Awaited<ReturnType<typeof scoreResult>>[] = []

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          const progress = 10 + Math.round(((i + 1) / questions.length) * 80)
          send({ stage: 'testing', message: `Question ${i + 1}/${questions.length}: ${q.question}`, progress })

          try {
            const run = await runAssessmentQuery(q.question, membership.tenant_id, svc, request.signal)
            results.push(await scoreResult(q, run, request.signal))
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') throw e
            results.push({
              question: q.question, expected: null, answerExcerpt: `Error: ${(e as Error).message}`,
              confidenceScore: 0, risks: ['Assessment query failed'], numericMatch: false, citationMatch: false, passed: false,
            })
          }
        }

        const total = results.length
        const passed = results.filter(r => r.passed).length
        const accuracy = Math.round((passed / total) * 10000) / 100
        const avgConfidence = Math.round((results.reduce((a, r) => a + r.confidenceScore, 0) / total) * 100) / 100

        send({ stage: 'saving', message: 'Saving assessment results…', progress: 95 })

        const user = await getUser()

        await svc.from('self_assessments').insert({
          tenant_id: membership.tenant_id,
          run_by: user?.id ?? null,
          document_id: documentId,
          total_questions: total,
          passed,
          accuracy,
          avg_confidence: avgConfidence,
          results,
        })

        send({
          stage: 'complete',
          message: `Assessment complete — ${passed}/${total} questions answered correctly.`,
          progress: 100,
          accuracy, avgConfidence, total, passed, results,
        })
      } catch (err) {
        console.error('[Assessment]', err)
        send({ stage: 'error', message: (err as Error).message, progress: -1 })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}

export async function GET(request: NextRequest) {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const documentId = new URL(request.url).searchParams.get('documentId')
  const svc = getServiceClient()

  let query = svc
    .from('self_assessments')
    .select('id, document_id, total_questions, passed, accuracy, avg_confidence, results, created_at')
    .eq('tenant_id', membership.tenant_id)
    .order('created_at', { ascending: false })
    .limit(1)

  query = documentId ? query.eq('document_id', documentId) : query.is('document_id', null)

  const { data } = await query
  return NextResponse.json({ assessment: data?.[0] ?? null })
}
