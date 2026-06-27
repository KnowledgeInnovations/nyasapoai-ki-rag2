import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TrainingClient from '@/components/app/TrainingClient'
import { canAccessTraining } from '@/lib/roles'
import { buildFactCountMap } from '@/lib/factCounts'
import { computeRecurringGaps, type RecurringGap } from '@/lib/extractionGaps'
import type { ProcessingWarning } from '@/types'

export const metadata: Metadata = { title: 'AI Training - Nyansa AI' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export interface Performance {
  total:    number
  correct:  number
  accuracy: number
}

export interface TrainingDoc {
  id: string
  title: string
  source: string
  department: string | null
  status: string
  status_detail: string | null
  processing_warnings: ProcessingWarning[]
  file_path: string
  created_at: string
  chunkCount: number
  lastTrainedAt: string | null
  financialFactCount: number
  documentFactCount: number
}

export default async function TrainingPage() {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) redirect('/ask')

  const service = svc()
  const tid      = membership.tenant_id

  // Fetch all documents
  const { data: docs } = await service
    .from('documents')
    .select('id, title, source, department, status, status_detail, processing_warnings, file_path, created_at')
    .eq('tenant_id', tid)
    .order('created_at', { ascending: false })

  const [financialFactCounts, documentFactCounts] = await Promise.all([
    buildFactCountMap(service, 'financial_facts', tid),
    buildFactCountMap(service, 'document_facts', tid),
  ])

  // Fetch every chunk row for the tenant — paginated, since Supabase caps
  // unbounded selects at 1000 rows, which would silently hide chunk counts
  // for documents whose chunks fall outside that window (i.e. the most
  // recently trained ones, making them look "Not Trained").
  const PAGE_SIZE = 1000
  const allChunks: { document_id: string; created_at: string }[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await service
      .from('document_chunks')
      .select('document_id, created_at')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (!page?.length) break
    allChunks.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  // Build chunk count + last trained map
  const chunkMap = new Map<string, { count: number; lastAt: string }>()
  for (const c of allChunks ?? []) {
    const e = chunkMap.get(c.document_id)
    if (!e) chunkMap.set(c.document_id, { count: 1, lastAt: c.created_at })
    else { e.count++; e.lastAt = c.created_at }
  }

  const trainingDocs: TrainingDoc[] = (docs ?? []).map(d => ({
    id:           d.id,
    title:        d.title,
    source:       d.source,
    department:   d.department,
    status:       d.status,
    status_detail: d.status_detail ?? null,
    processing_warnings: (d.processing_warnings as ProcessingWarning[] | null) ?? [],
    file_path:    d.file_path,
    created_at:   d.created_at,
    chunkCount:   chunkMap.get(d.id)?.count ?? 0,
    lastTrainedAt: chunkMap.get(d.id)?.lastAt ?? null,
    financialFactCount: financialFactCounts.get(d.id) ?? 0,
    documentFactCount: documentFactCounts.get(d.id) ?? 0,
  }))

  const trainedCount   = trainingDocs.filter(d => d.chunkCount > 0).length
  const untrainedCount = trainingDocs.filter(d => d.chunkCount === 0).length

  // Overall manual-review performance: how often the user has marked the
  // Document Search results (whole knowledge base) as correct.
  const { data: reviews } = await service
    .from('search_reviews')
    .select('verdict')
    .eq('tenant_id', tid)
    .is('document_id', null)

  const reviewTotal   = reviews?.length ?? 0
  const reviewCorrect = reviews?.filter(r => r.verdict === 'correct').length ?? 0
  const performance = reviewTotal > 0
    ? { total: reviewTotal, correct: reviewCorrect, accuracy: Math.round((reviewCorrect / reviewTotal) * 10000) / 100 }
    : null

  // Most recent regression-suite (self-assessment) run, if any.
  const { data: lastRun } = await service
    .from('self_assessments')
    .select('id, total_questions, passed, accuracy, avg_confidence, results, created_at')
    .eq('tenant_id', tid)
    .is('document_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Self-improvement, phase 1: recurring-gap flagging — read-only analysis
  // over existing review/regression signal, see extractionGaps.ts.
  const gaps = await computeRecurringGaps(service, tid)

  return (
    <TrainingClient
      docs={trainingDocs}
      trainedCount={trainedCount}
      untrainedCount={untrainedCount}
      performance={performance}
      lastRun={lastRun ?? null}
      gaps={gaps}
    />
  )
}

export type { RecurringGap }

export interface SelfAssessmentRun {
  id:              string
  total_questions: number
  passed:          number
  accuracy:        number
  avg_confidence:  number
  results:         RegressionResultRow[]
  created_at:      string
}

export interface RegressionResultRow {
  id:               string
  category:         string
  query:            string
  answer:           string
  confidenceScore:  number
  confidenceLevel:  string
  citationCount:    number
  passed:           boolean
  reason:           string
}
