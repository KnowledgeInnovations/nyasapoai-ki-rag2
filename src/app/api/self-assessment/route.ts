import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { REGRESSION_QUESTIONS, scoreRegressionAnswer, type RegressionResult } from '@/lib/selfAssessment'

export const maxDuration = 300

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/* ── GET: most recent regression runs (whole-KB) ─────────────── */
export async function GET() {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = getServiceClient()
  const { data } = await svc
    .from('self_assessments')
    .select('id, total_questions, passed, accuracy, avg_confidence, results, created_at')
    .eq('tenant_id', membership.tenant_id)
    .is('document_id', null)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ runs: data ?? [] })
}

/* ── POST: run the regression suite, streaming progress ──────── */
export async function POST(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership || !canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enc = new TextEncoder()
  const origin = request.nextUrl.origin
  const cookie = request.headers.get('cookie') ?? ''

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      const results: RegressionResult[] = []

      for (const question of REGRESSION_QUESTIONS) {
        send({ stage: 'running', id: question.id, message: `Asking: ${question.query}` })

        try {
          const res = await fetch(`${origin}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie },
            body: JSON.stringify({ query: question.query, newSession: false }),
          })
          if (!res.ok || !res.body) throw new Error(`/api/chat returned ${res.status}`)

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let done: {
            answer?: string
            confidence_score?: number
            confidence_level?: string
            citations?: unknown[]
          } | null = null

          while (true) {
            const { done: streamDone, value } = await reader.read()
            if (streamDone) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const ev = JSON.parse(line.slice(6))
                if (ev.done) done = ev
              } catch {}
            }
          }

          const answer = done?.answer ?? ''
          const confidenceScore = done?.confidence_score ?? 0
          const confidenceLevel = done?.confidence_level ?? 'Low'
          const citationCount = done?.citations?.length ?? 0

          const { passed, reason } = scoreRegressionAnswer(question, answer, confidenceScore, confidenceLevel, citationCount)

          const result: RegressionResult = {
            id: question.id, category: question.category, query: question.query,
            answer, confidenceScore, confidenceLevel, citationCount, passed, reason,
          }
          results.push(result)
          send({ stage: 'result', ...result })
        } catch (e) {
          const result: RegressionResult = {
            id: question.id, category: question.category, query: question.query,
            answer: '', confidenceScore: 0, confidenceLevel: 'Low', citationCount: 0,
            passed: false, reason: `Request failed: ${(e as Error).message}`,
          }
          results.push(result)
          send({ stage: 'result', ...result })
        }
      }

      const total = results.length
      const passed = results.filter(r => r.passed).length
      const accuracy = total ? Math.round((passed / total) * 10000) / 100 : 0
      const avgConfidence = total ? Math.round((results.reduce((a, r) => a + r.confidenceScore, 0) / total) * 100) / 100 : 0

      const svc = getServiceClient()
      const { error } = await svc.from('self_assessments').insert({
        tenant_id: membership.tenant_id,
        run_by: user.id,
        document_id: null,
        total_questions: total,
        passed,
        accuracy,
        avg_confidence: avgConfidence,
        results,
      })
      if (error) console.error('[SelfAssessment] insert failed:', error)

      send({ stage: 'complete', total, passed, accuracy, avgConfidence })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
