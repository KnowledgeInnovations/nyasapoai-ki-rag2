import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { REGRESSION_QUESTIONS, scoreRegressionAnswer, type RegressionResult } from '@/lib/selfAssessment'
import { runAutoReprocess } from '@/lib/autoReprocess'
import { runAutoPromptFix } from '@/lib/answerHeuristics'
import { computeRecurringGaps } from '@/lib/extractionGaps'

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
  // maxDuration above is 300s for the WHOLE request, and the regression
  // suite (10 sequential /api/chat calls) runs before auto-reprocess even
  // starts — this deadline is anchored to request start so auto-reprocess
  // only gets whatever's actually left, not a fixed budget of its own.
  const requestDeadline = Date.now() + 280_000

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
            body: JSON.stringify({ query: question.query, newSession: false, agentic: true }),
          })
          if (!res.ok || !res.body) throw new Error(`/api/chat returned ${res.status}`)

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let done: {
            answer?: string
            confidence_score?: number
            confidence_level?: string
            citations?: { document_id?: string }[]
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
          const documentIds = [...new Set((done?.citations ?? []).map(c => c.document_id).filter((id): id is string => !!id))]

          const { passed, reason } = scoreRegressionAnswer(question, answer, confidenceScore, confidenceLevel, citationCount)

          const result: RegressionResult = {
            id: question.id, category: question.category, query: question.query,
            answer, confidenceScore, confidenceLevel, citationCount, documentIds, passed, reason,
          }
          results.push(result)
          send({ stage: 'result', ...result })
        } catch (e) {
          const result: RegressionResult = {
            id: question.id, category: question.category, query: question.query,
            answer: '', confidenceScore: 0, confidenceLevel: 'Low', citationCount: 0, documentIds: [],
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

      // Self-improvement phase 3: for recurring category gaps, generate a
      // candidate system-prompt rule and verify it against the WHOLE suite
      // (10 chat calls) before promoting it — see answerHeuristics.ts. Runs
      // BEFORE auto-reprocess deliberately: re-extraction (below) can burn
      // the entire remaining budget on a single slow document (observed
      // live, 30s-9min per attempt) and starve this phase every time if it
      // goes second. Categories like currency_boundary/insufficiency have
      // no document to re-extract anyway, so reprocess wouldn't have helped
      // them even with unlimited budget — this phase gets first claim on
      // whatever time is actually available, reprocess gets whatever's left.
      try {
        send({ stage: 'auto_prompt_fix_starting' })
        const gaps = await computeRecurringGaps(svc, membership.tenant_id)
        const promptFixable = gaps
          .filter(g => g.source === 'self_assessment')
          .map(g => ({ category: g.topic, exampleQuestion: g.exampleQuestion, exampleReason: g.exampleReason }))
        await runAutoPromptFix(svc, membership.tenant_id, origin, cookie, promptFixable, a => send({ stage: 'auto_prompt_fix', ...a }), requestDeadline)
      } catch (e) {
        console.error('[SelfAssessment] auto-prompt-fix failed:', e)
      }

      // Self-improvement phase 2: re-extract documents behind any recurring
      // gap this run (or prior runs) surfaced, then re-test. Runs after the
      // results above are saved so computeRecurringGaps sees this run's
      // failures too. Failures here are logged but don't fail the request —
      // the regression suite's own results are already saved either way.
      try {
        send({ stage: 'auto_reprocess_starting' })
        await runAutoReprocess(svc, membership.tenant_id, origin, cookie, a => send({ stage: 'auto_reprocess', ...a }), requestDeadline)
      } catch (e) {
        console.error('[SelfAssessment] auto-reprocess failed:', e)
      }

      send({ stage: 'complete', total, passed, accuracy, avgConfidence })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
