import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUser, getMembership } from '@/lib/supabase/server'
import { canAccessTraining } from '@/lib/roles'
import { rowsOrEmpty } from '@/lib/dbResult'
import type { ExpectedKind } from '@/lib/goldenSet'

/**
 * Proposes questions for a document, with an answer and the page it can be
 * checked on — for a person to confirm or correct.
 *
 * What this does NOT do is produce ground truth. The candidates come from
 * the document's own extracted facts, so a fact we misread becomes a
 * question built on the misreading, and a system graded against that would
 * score full marks for repeating its own mistake. That is precisely how
 * the older self-assessment suite came to measure nothing: its questions
 * were generated from our extractions and its scoring never compared
 * against a known answer.
 *
 * So every draft arrives unconfirmed, is excluded from the accuracy
 * figure, and carries the page it was taken from so confirming it means
 * looking at the source rather than trusting us. The drafting removes the
 * typing, not the checking.
 */

// Enough to choose from without turning confirmation into a chore.
const MAX_DRAFTS = 12

// A fact worth asking about has a subject, an attribute and a value that
// is a specific figure or a short definite string — not a paragraph.
const MAX_VALUE_LENGTH = 60

// At most this many questions about the same attribute.
//
// Without it, the first draft of a property brochure was twelve travel
// times from one page — each a different subject, so the one-per-subject
// rule allowed them all, and the resulting set tested a single table while
// looking like twelve tests. A golden set is only as good as its spread.
const MAX_PER_ATTRIBUTE = 2

// And at most this many from any one page, for the same reason.
const MAX_PER_PAGE = 3

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

interface Draft {
  question: string
  expected_answer: string
  expected_kind: ExpectedKind
  expected_value: Record<string, unknown>
  source_page: number | null
  document_id: string
  notes: string
}

export async function POST(request: NextRequest) {
  const [user, membership] = await Promise.all([getUser(), getMembership()])
  if (!user || !membership) return NextResponse.json({ error: 'No workspace' }, { status: 403 })
  if (!canAccessTraining(membership.role)) {
    return NextResponse.json({ error: 'Only Senior users can draft golden questions' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { documentId?: string } | null
  if (!body?.documentId) return NextResponse.json({ error: 'Which document?' }, { status: 400 })

  const service = svc()
  const { data: doc } = await service
    .from('documents')
    .select('id, title, extraction_profile')
    .eq('id', body.documentId)
    .eq('tenant_id', membership.tenant_id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const facts = rowsOrEmpty<{
    subject: string | null
    attribute: string | null
    value_text: string | null
    unit: string | null
    page_number: number | null
    confidence: number | null
  }>(
    await service
      .from('document_facts')
      .select('subject, attribute, value_text, unit, page_number, confidence')
      .eq('document_id', doc.id)
      .gte('confidence', 70)
      .not('page_number', 'is', null)
      .limit(400),
    `facts for document ${doc.id}`,
  )

  // Prefer facts whose value is a figure and whose page is known: those
  // are the ones a person can confirm in seconds by opening the page,
  // which is what decides whether confirmation actually happens.
  const candidates = facts.filter(f =>
    f.subject && f.attribute && f.value_text &&
    f.value_text.trim().length > 0 && f.value_text.trim().length <= MAX_VALUE_LENGTH,
  )

  const numeric = candidates.filter(f => /^[^a-zA-Z]*\d[\d,.]*\s*[a-zA-Z%²³]{0,12}$/.test(f.value_text!.trim()))
  const textual = candidates.filter(f => !numeric.includes(f))

  // Spread across subjects, attributes and pages, so a drafted set tests
  // the document rather than one table in it.
  const seenSubjects = new Set<string>()
  const perAttribute = new Map<string, number>()
  const perPage = new Map<number, number>()
  const drafts: Draft[] = []
  const readable = (s: string) => s.replace(/_/g, ' ').trim()

  for (const fact of [...numeric, ...textual]) {
    if (drafts.length >= MAX_DRAFTS) break
    const subject = fact.subject!.trim()
    if (seenSubjects.has(subject.toLowerCase())) continue

    const attribute = readable(fact.attribute!)
    const attributeKey = attribute.toLowerCase()
    if ((perAttribute.get(attributeKey) ?? 0) >= MAX_PER_ATTRIBUTE) continue
    const page = fact.page_number ?? -1
    if ((perPage.get(page) ?? 0) >= MAX_PER_PAGE) continue

    seenSubjects.add(subject.toLowerCase())
    perAttribute.set(attributeKey, (perAttribute.get(attributeKey) ?? 0) + 1)
    perPage.set(page, (perPage.get(page) ?? 0) + 1)

    const value = fact.value_text!.trim()
    // The unit is often already part of the value, and appending it again
    // produced expected answers like "13 mins mins".
    // Treats a placeholder as absence, for facts extracted before the
    // extractor stopped storing one. 251 rows carry the string "null".
    const rawUnit = fact.unit?.trim() ?? ''
    const unit = ['null', 'none', 'n/a', 'na', 'undefined', 'nil', '-'].includes(rawUnit.toLowerCase())
      ? ''
      : rawUnit
    const withUnit = unit && !new RegExp(`${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(value)
      ? `${value} ${unit}`
      : value
    const isNumeric = numeric.includes(fact)
    const asNumber = Number(value.replace(/[^\d.-]/g, ''))

    drafts.push({
      // Phrased so it stays grammatical whatever shape the attribute is.
      // "What is the {attribute} of {subject}?" reads as nonsense when the
      // attribute is itself a phrase — "what is the travel time from arlo
      // of Kotoka International Airport".
      question: `According to this document, what is the ${attribute} for ${subject}?`,
      expected_answer: withUnit,
      // A figure can be checked exactly; anything else is checked by the
      // answer containing it.
      expected_kind: isNumeric && Number.isFinite(asNumber) ? 'figure' : 'claim',
      expected_value: isNumeric && Number.isFinite(asNumber)
        ? { value: asNumber, tolerance: 0 }
        : { must_include: [value] },
      source_page: fact.page_number,
      document_id: doc.id,
      notes: `Drafted from an extracted fact in "${doc.title}"${fact.page_number ? `, page ${fact.page_number}` : ''}. Check the page before confirming — if the extraction misread it, this question is wrong in the same way.`,
    })
  }

  if (!drafts.length) {
    return NextResponse.json({
      error: `No checkable facts with a page number were found in "${doc.title}". A document with no extracted facts, or none carrying a page, has nothing to draft from — ask a question by hand instead.`,
    }, { status: 400 })
  }

  // Stored unconfirmed. Nothing here counts toward accuracy until somebody
  // opens the page and says it is right.
  const { data: inserted, error } = await service
    .from('golden_questions')
    .insert(drafts.map(d => ({ ...d, tenant_id: membership.tenant_id })))
    .select('id, question, expected_answer, expected_kind, expected_value, source_page, document_id, notes')

  if (error) {
    console.error('[golden-draft] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the drafts' }, { status: 500 })
  }

  return NextResponse.json({
    drafted: inserted?.length ?? 0,
    drafts: inserted ?? [],
    message: `${inserted?.length ?? 0} draft question(s) proposed from "${doc.title}". Each one needs checking against its page before it counts — a draft taken from a misread fact is wrong in exactly the same way the extraction was.`,
  })
}
