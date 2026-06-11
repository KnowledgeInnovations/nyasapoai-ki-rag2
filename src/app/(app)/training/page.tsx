import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TrainingClient from '@/components/app/TrainingClient'
import { canAccessTraining } from '@/lib/roles'

export const metadata: Metadata = { title: 'AI Training - Knowledge Innovations' }

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export interface TrainingDoc {
  id: string
  title: string
  source: string
  department: string | null
  status: string
  file_path: string
  created_at: string
  chunkCount: number
  lastTrainedAt: string | null
}

export interface AssessmentResultRow {
  question: string
  expected:
    | { entity: string; metric: string; fiscalYear: string | null; value: number; unit: string }
    | { entity: string; metric: string; fromYear: string; toYear: string; growthPct: number }
    | { docTitle: string }
    | { answer: string }
    | null
  answerExcerpt: string
  confidenceScore: number
  risks: string[]
  numericMatch: boolean
  citationMatch: boolean
  passed: boolean
}

export interface Assessment {
  id: string
  total_questions: number
  passed: number
  accuracy: number
  avg_confidence: number
  results: AssessmentResultRow[]
  created_at: string
}

export default async function TrainingPage() {
  const membership = await getMembership()
  if (!membership || !canAccessTraining(membership.role)) redirect('/ask')

  const service = svc()
  const tid      = membership.tenant_id

  // Fetch all documents
  const { data: docs } = await service
    .from('documents')
    .select('id, title, source, department, status, file_path, created_at')
    .eq('tenant_id', tid)
    .order('created_at', { ascending: false })

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
    file_path:    d.file_path,
    created_at:   d.created_at,
    chunkCount:   chunkMap.get(d.id)?.count ?? 0,
    lastTrainedAt: chunkMap.get(d.id)?.lastAt ?? null,
  }))

  const trainedCount   = trainingDocs.filter(d => d.chunkCount > 0).length
  const untrainedCount = trainingDocs.filter(d => d.chunkCount === 0).length

  // Latest global (whole-knowledge-base) self-assessment, if any.
  const { data: latestAssessment } = await service
    .from('self_assessments')
    .select('id, total_questions, passed, accuracy, avg_confidence, results, created_at')
    .eq('tenant_id', tid)
    .is('document_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <TrainingClient
      docs={trainingDocs}
      trainedCount={trainedCount}
      untrainedCount={untrainedCount}
      latestAssessment={latestAssessment}
    />
  )
}
