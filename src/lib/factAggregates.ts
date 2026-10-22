/**
 * Answers counting, enumeration and coverage questions from the complete
 * fact layer instead of a retrieved sample.
 *
 * Why this exists. Passage retrieval fetches the 8-30 excerpts most
 * relevant to a question, which is the right answer for "what does the
 * policy say about notice periods" and the wrong one for "how many FM
 * stations were first authorised in 2025". A register's 793 rows are spread
 * evenly across 40 pages, so no excerpt is more relevant than any other and
 * a relevance-ranked top-k is an arbitrary slice of the document. Asked
 * that question against a fully-extracted register, the system answered
 * "at least 3 visible in the excerpts" and correctly flagged it as an
 * undercount — the data was all there, in 4,170 extracted facts, but
 * nothing ever looked at more than a cap's worth of it.
 *
 * What this does instead. For a question that is about how many or which
 * ones, it reads every fact the documents in scope hold, and hands the
 * model counts rather than rows: which attributes exist, how many subjects
 * carry each one, how the values distribute, and — for dates — a year
 * histogram. A distribution of a few hundred rows' worth of values costs a
 * fraction of the tokens the rows themselves would, and is the shape a
 * counting question actually needs.
 *
 * What it refuses to do. It reports what it could not read as plainly as
 * what it could. A register whose authorisation column is printed
 * "25 – 02 - 20" has no unambiguous year, and a count that quietly assumed
 * a reading of it would be a fabrication wearing a number. Those values are
 * counted separately, with examples, so the answer can say what is
 * genuinely unknowable from the source.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Questions this view is for. Deliberately narrow: a question that is not
// about counts gains nothing from a distribution and would only spend
// tokens on it.
const AGGREGATE_RX = /\b(how many|how much|number of|count(?:s|ed|ing)? of|total (?:number|count)|list (?:all|every|them)|all of the|each of the|every one|breakdown|distribution|what (?:proportion|percentage|share))\b/i

// Ceiling on rows read. Well above anything this deployment holds for one
// document (the largest is 4,170) while still bounding a pathological case.
const MAX_AGGREGATE_FACTS = 20_000
const PAGE = 1000

// How many distinct values of one attribute to show. Enough to enumerate a
// status or a category column in full; a free-text column is summarised
// rather than listed, and says so.
const MAX_VALUES_PER_ATTRIBUTE = 30

// How many attributes to describe. A dense register can extract dozens;
// the ones that matter are those the question names.
const MAX_ATTRIBUTES = 6

const STOPWORDS = new Set([
  'how', 'many', 'much', 'the', 'and', 'are', 'was', 'were', 'for', 'from',
  'with', 'that', 'this', 'what', 'which', 'number', 'count', 'total', 'all',
  'have', 'has', 'had', 'been', 'their', 'there', 'they', 'any', 'does', 'did',
  'list', 'show', 'give', 'tell', 'about', 'into', 'over', 'under', 'per',
])

export function isAggregateQuestion(query: string): boolean {
  return AGGREGATE_RX.test(query)
}

interface FactRow {
  subject: string | null
  attribute: string | null
  value_text: string | null
  page_number: number | null
}

/**
 * Reads every fact held by the given documents. Paged because PostgREST
 * caps an unbounded select, which would otherwise silently turn a complete
 * view into a 1,000-row sample — the exact failure this module exists to
 * remove.
 */
async function readAllFacts(
  svc: SupabaseClient,
  tenantId: string,
  documentIds: string[],
): Promise<FactRow[]> {
  const rows: FactRow[] = []
  for (let from = 0; from < MAX_AGGREGATE_FACTS; from += PAGE) {
    const { data, error } = await svc
      .from('document_facts')
      .select('subject, attribute, value_text, page_number')
      .eq('tenant_id', tenantId)
      .in('document_id', documentIds)
      .gte('confidence', 70)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[factAggregates] fact read failed:', error.message)
      break
    }
    if (!data?.length) break
    rows.push(...(data as FactRow[]))
    if (data.length < PAGE) break
  }
  return rows
}

/** Attribute names, scored by how well they match what was asked. */
function rankAttributes(rows: FactRow[], query: string): string[] {
  const queryTokens = (query.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(t => !STOPWORDS.has(t))
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (!r.attribute) continue
    counts.set(r.attribute, (counts.get(r.attribute) ?? 0) + 1)
  }
  const scored = [...counts.entries()].map(([attribute, n]) => {
    // Attribute names come back from extraction in free form
    // (date_of_first_authorisation, authorization_date, licence_date all
    // appeared in one document), so match on the words rather than the
    // whole name.
    const words = attribute.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    const overlap = queryTokens.reduce(
      (acc, t) => acc + (words.some(w => w.startsWith(t) || t.startsWith(w)) ? 1 : 0),
      0,
    )
    return { attribute, n, overlap }
  })
  // Matching the question first, then the attributes the document holds
  // most of — a column covering nearly every subject is what a "how many"
  // question is usually about even when it names nothing.
  scored.sort((a, b) => b.overlap - a.overlap || b.n - a.n)
  return scored.slice(0, MAX_ATTRIBUTES).map(s => s.attribute)
}

const DATE_ATTRIBUTE_RX = /date|year|authoris|authoriz|licen[cs]e|renewal|expir|issued|commenc/i

function describeAttribute(attribute: string, values: string[]): string[] {
  const lines: string[] = []
  const distinct = new Set(values)
  lines.push(`- ${attribute}: ${values.length} value(s) across ${distinct.size} distinct value(s)`)

  if (DATE_ATTRIBUTE_RX.test(attribute)) {
    // Only a four-digit year is read as a year. A two-digit field cannot be
    // placed in a century without deciding how the source prints dates, and
    // deciding that silently is how a count becomes a guess.
    const byYear = new Map<string, number>()
    const unreadable: string[] = []
    for (const v of values) {
      const m = v.match(/\b(19|20)\d{2}\b/)
      if (m) byYear.set(m[0], (byYear.get(m[0]) ?? 0) + 1)
      else unreadable.push(v)
    }
    if (byYear.size) {
      const hist = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([y, n]) => `${y}: ${n}`).join(', ')
      lines.push(`  years stated in full: ${hist}`)
    }
    if (unreadable.length) {
      const examples = [...new Set(unreadable)].slice(0, 4).map(v => `"${v}"`).join(', ')
      lines.push(
        `  ${unreadable.length} value(s) carry no four-digit year and cannot be assigned to one ` +
        `without assuming how the source prints dates (e.g. ${examples}). ` +
        `These are NOT included in the year counts above and must not be ignored when answering — ` +
        `say how many could not be read.`,
      )
    }
    return lines
  }

  const byValue = new Map<string, number>()
  for (const v of values) byValue.set(v, (byValue.get(v) ?? 0) + 1)
  const sorted = [...byValue.entries()].sort((a, b) => b[1] - a[1])
  if (sorted.length <= MAX_VALUES_PER_ATTRIBUTE) {
    lines.push(`  ${sorted.map(([v, n]) => `${v}: ${n}`).join(', ')}`)
  } else {
    lines.push(
      `  most common — ${sorted.slice(0, MAX_VALUES_PER_ATTRIBUTE).map(([v, n]) => `${v}: ${n}`).join(', ')}` +
      ` (and ${sorted.length - MAX_VALUES_PER_ATTRIBUTE} further distinct value(s) not listed)`,
    )
  }
  return lines
}

/**
 * The block handed to the model, or null when there is nothing to compute.
 */
export async function buildFactAggregateBlock(
  svc: SupabaseClient,
  tenantId: string,
  documentIds: string[],
  query: string,
  documentTitles?: Map<string, string>,
): Promise<string | null> {
  if (!documentIds.length) return null

  const rows = await readAllFacts(svc, tenantId, documentIds)
  if (rows.length < 2) return null

  const subjects = new Set(rows.map(r => r.subject).filter(Boolean))
  const pages = new Set(rows.map(r => r.page_number).filter(p => p != null))
  const titles = documentIds
    .map(id => documentTitles?.get(id))
    .filter((t): t is string => !!t)

  const header = [
    'AGGREGATE VIEW — computed over EVERY extracted fact in ' +
    (titles.length ? titles.map(t => `"${t}"`).join(', ') : `${documentIds.length} document(s)`) +
    ', not a retrieved sample.',
    '',
    `Scope: ${rows.length} extracted fact(s) about ${subjects.size} distinct subject(s)` +
    (pages.size ? `, spanning ${pages.size} page(s)` : '') + '.',
    '',
    'Use these counts for any question about how many, which ones, or how ' +
    'the values distribute — they cover the whole document, whereas the ' +
    'excerpts above are only the passages that matched the question. Cite ' +
    'the excerpts for specific named examples, and this view for counts. ' +
    'Where a count below is incomplete, say so and give the number that ' +
    'could not be read rather than presenting the readable subset as the total.',
    '',
  ]

  const attributes = rankAttributes(rows, query)
  const body: string[] = []
  for (const attribute of attributes) {
    const values = rows
      .filter(r => r.attribute === attribute)
      .map(r => (r.value_text ?? '').trim())
      .filter(Boolean)
    if (!values.length) continue
    body.push(...describeAttribute(attribute, values))
    const covered = new Set(rows.filter(r => r.attribute === attribute).map(r => r.subject).filter(Boolean))
    if (subjects.size > 1) {
      body.push(`  present for ${covered.size} of ${subjects.size} subject(s)` +
        (covered.size < subjects.size
          ? ` — the remaining ${subjects.size - covered.size} have no value extracted for this attribute`
          : ''))
    }
  }
  if (!body.length) return null

  return '\n\n' + [...header, ...body].join('\n')
}
