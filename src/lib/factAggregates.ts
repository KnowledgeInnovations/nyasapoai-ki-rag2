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
import { readDateColumn, yearHistogram } from './dateInference'

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
const MAX_ATTRIBUTES = 10

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

const DATE_ATTRIBUTE_RX = /date|year|authoris|authoriz|licen[cs]e|renewal|expir|issued|commenc/i

// Reduces a word to something that matches its relatives. "authorised",
// "authorisation" and "authorization" have to compare equal, or a question
// asking how many stations were *authorised* in 2025 finds no overlap with
// the column named date_of_first_authorisation — which is exactly what
// happened: the view answered with station type and status, the question
// got "a complete count cannot be produced", and the column holding the
// answer was never looked at.
function stem(word: string): string {
  // Five characters, not six: at six, "renew", "renewal" and "renewed"
  // stem to three different things, so "renewed" slipped past the guard
  // that keeps a renewal column from being merged into an authorisation
  // one — the single most consequential conflation in this data.
  return word.toLowerCase().replace(/z/g, 's').slice(0, 5)
}

// Words that say nothing about which column is meant, so two attribute
// names differing only by these are the same column under two names.
const FILLER_WORDS = new Set(['of', 'the', 'for', 'and', 'type', 'kind', 'value', 'name', 'fm', 'radio', 'no', 'num', 'number'])

// Words that DO distinguish two columns, and must never be merged away.
// A register's "date of first authorisation" and "date of last renewal"
// both hold dates for the same station, and conflating them is the trap
// that makes a 2025 renewal look like a 2025 authorisation.
const DISTINGUISHING_WORDS = new Set(['first', 'last', 'start', 'end', 'renewal', 'renew', 'expiry', 'expire', 'issue', 'issued', 'previous', 'next', 'original'])

interface AttributeGroup {
  /** The name shown, the most common of the merged names. */
  label: string
  names: string[]
  values: string[]
  subjects: Set<string>
}

/**
 * Groups the attribute names that mean the same column, then ranks the
 * groups by how well they match the question.
 *
 * Extraction names attributes in free form, one call at a time, so a single
 * column arrives under several names. Measured on one register: station
 * type was extracted as station_type (616), type_of_fm_radio_station (66),
 * type_of_fm_station (23) and type_of_station (11) — four names for one
 * column, which between them filled every slot in the view, reported
 * coverage of 616 of 748 subjects when the real figure was 716, and left no
 * room for the column the question was actually about.
 */
function groupAttributes(rows: FactRow[], query: string): AttributeGroup[] {
  const byName = new Map<string, AttributeGroup>()
  for (const row of rows) {
    if (!row.attribute) continue
    const value = (row.value_text ?? '').trim()
    if (!value) continue
    let group = byName.get(row.attribute)
    if (!group) {
      group = { label: row.attribute, names: [row.attribute], values: [], subjects: new Set() }
      byName.set(row.attribute, group)
    }
    group.values.push(value)
    if (row.subject) group.subjects.add(row.subject)
  }

  // Merge, largest first, so the biggest name becomes the label.
  const ordered = [...byName.values()].sort((a, b) => b.values.length - a.values.length)
  const merged: AttributeGroup[] = []
  for (const group of ordered) {
    const host = merged.find(m => sameColumn(m.names[0], group.names[0]))
    if (host) {
      host.names.push(...group.names)
      host.values.push(...group.values)
      for (const subject of group.subjects) host.subjects.add(subject)
    } else {
      merged.push(group)
    }
  }

  // A name carrying no distinguishing word is the vaguer spelling of a
  // column that has one: "authorization_date" against
  // "date_of_first_authorisation". Merged only when exactly one group
  // subsumes it, so the register's authorisation and renewal columns — the
  // pair whose conflation makes a 2025 renewal look like a 2025
  // authorisation — can never absorb each other, since neither subsumes
  // the other's words.
  for (let i = merged.length - 1; i >= 0; i--) {
    const vague = merged[i]
    if (hasDistinguishingWord(vague.names)) continue
    const vagueStems = meaningfulStems(vague.names[0])
    if (!vagueStems.size) continue
    const hosts = merged.filter((candidate, j) =>
      j !== i &&
      hasDistinguishingWord(candidate.names) &&
      [...vagueStems].every(stemmed => meaningfulStems(candidate.names[0]).has(stemmed)))
    if (hosts.length !== 1) continue
    const host = hosts[0]
    host.names.push(...vague.names)
    host.values.push(...vague.values)
    for (const subject of vague.subjects) host.subjects.add(subject)
    merged.splice(i, 1)
  }

  const queryStems = new Set(
    (query.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(t => !STOPWORDS.has(t)).map(stem),
  )
  // A question naming a year is about whatever column holds dates, whether
  // or not it names that column.
  const mentionsYear = /\b(19|20)\d\d\b/.test(query)

  const scored = merged.map(group => {
    const groupStems = new Set(group.names.flatMap(n => n.split(/[^a-zA-Z]+/).filter(Boolean).map(stem)))
    let overlap = 0
    for (const s of queryStems) if (groupStems.has(s)) overlap++
    if (mentionsYear && DATE_ATTRIBUTE_RX.test(group.names.join(' '))) overlap += 2
    return { group, overlap }
  })
  scored.sort((a, b) => b.overlap - a.overlap || b.group.values.length - a.group.values.length)
  return scored.slice(0, MAX_ATTRIBUTES).map(s => s.group)
}

function meaningfulStems(name: string): Set<string> {
  return new Set(
    name.split(/[^a-zA-Z]+/).filter(Boolean)
      .map(w => w.toLowerCase())
      .filter(w => !FILLER_WORDS.has(w))
      .map(stem),
  )
}

function hasDistinguishingWord(names: string[]): boolean {
  const marks = new Set([...DISTINGUISHING_WORDS].map(stem))
  return names.some(n => [...meaningfulStems(n)].some(s => marks.has(s)))
}

/** Whether two attribute names are the same column under different names. */
function sameColumn(a: string, b: string): boolean {
  const left = meaningfulStems(a)
  const right = meaningfulStems(b)
  if (!left.size || !right.size) return false

  // Anything that distinguishes the two columns blocks the merge, even when
  // everything else matches.
  const distinguishing = (set: Set<string>) =>
    [...set].filter(s => [...DISTINGUISHING_WORDS].some(d => stem(d) === s))
  const leftMarks = distinguishing(left).sort().join(',')
  const rightMarks = distinguishing(right).sort().join(',')
  if (leftMarks !== rightMarks) return false

  // Otherwise the same column if one name's meaningful words contain the
  // other's — "station type" and "type of station" do, "station type" and
  // "station status" do not.
  const subset = (small: Set<string>, big: Set<string>) => [...small].every(s => big.has(s))
  return subset(left, right) || subset(right, left)
}

// Attribute names are machine-shaped (date_of_first_authorisation); a
// reader should never see one. Without this the answer explained itself in
// terms of an "authorization_date column", which is our internal naming
// leaking into a customer's answer.
function humanise(attribute: string): string {
  return attribute.replace(/_/g, ' ').trim()
}

function describeAttribute(attribute: string, values: string[]): string[] {
  const lines: string[] = []
  const distinct = new Set(values)
  lines.push(`- ${humanise(attribute)}: ${values.length} value(s) across ${distinct.size} distinct value(s)`)

  if (DATE_ATTRIBUTE_RX.test(attribute)) {
    // Short-form dates are read from the column's own evidence rather than
    // discarded — see dateInference.ts. Stated and inferred years are
    // reported separately so an answer can say which it used, and whatever
    // still cannot be read is reported as a number rather than dropped.
    const column = readDateColumn(values)
    const { stated, inferred } = yearHistogram(column)

    const render = (counts: Map<number, number>) =>
      [...counts.entries()].sort(([a], [b]) => a - b).map(([y, n]) => `${y}: ${n}`).join(', ')

    if (stated.size) lines.push(`  years printed in full (${column.stated} value(s)): ${render(stated)}`)
    if (inferred.size) {
      lines.push(
        `  years read from the short form (${column.inferred} value(s)): ${render(inferred)} — ` +
        `the day/month order was established from the ${column.stated} values in this column that ` +
        `state it unambiguously, and the century from the latest year the column itself gives ` +
        `(${column.pivotYear}). Treat these as read, not stated, and say so if asked how.`,
      )
      const total = new Map(stated)
      for (const [year, n] of inferred) total.set(year, (total.get(year) ?? 0) + n)
      lines.push(`  combined by year (${column.stated + column.inferred} of ${values.length} value(s)): ${render(total)}`)
    }
    if (column.unreadable) {
      const examples = column.unreadableSamples.map(v => `"${v}"`).join(', ')
      lines.push(
        `  ${column.unreadable} value(s) remain unread because this document prints them in a ` +
        `form whose day/month order it never states unambiguously (e.g. ${examples}). ` +
        `Report that number alongside the figure; do not treat it as a reason to withhold one.`,
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

export interface FactAggregate {
  /** The text handed to the model. */
  block: string
  /**
   * Every number this view states. Passed to the verifier as evidence: a
   * count computed over the whole document is the most reliable figure in
   * an answer, and without this it scored as the least reliable, because it
   * appears in no retrieved chunk.
   */
  figures: number[]
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
): Promise<FactAggregate | null> {
  if (!documentIds.length) return null

  const rows = await readAllFacts(svc, tenantId, documentIds)
  if (rows.length < 2) return null

  const subjects = new Set(rows.map(r => r.subject).filter(Boolean))
  const pages = new Set(rows.map(r => r.page_number).filter(p => p != null))
  const titles = documentIds
    .map(id => documentTitles?.get(id))
    .filter((t): t is string => !!t)

  const header = [
    'AGGREGATE VIEW — counted across EVERY extracted fact in ' +
    (titles.length ? titles.map(t => `"${t}"`).join(', ') : `${documentIds.length} document(s)`) +
    ', not a retrieved sample.',
    '',
    `Scope: ${rows.length} extracted fact(s) about ${subjects.size} distinct record(s)` +
    (pages.size ? `, spanning ${pages.size} page(s)` : '') + '.',
    '',
    // Written as an instruction to answer, not as a caveat to hedge behind.
    // The previous wording asked for incompleteness to be flagged, and the
    // model obliged by opening with "a complete, reliable count cannot be
    // produced" above a view that held the number — which is the opposite
    // of useful. State the figure, then its scope, in that order.
    'These counts cover the whole document; the excerpts above are only the ' +
    'passages that matched the question. ANSWER FROM THESE COUNTS and cite ' +
    'this view, using the excerpts for named examples.',
    '',
    'Lead with the number. Give the figure these counts support in the first ' +
    'sentence, then say in one clause what it rests on — "8 stations, from ' +
    'the 427 whose first-authorisation date was extracted" — and name any ' +
    'figure that could not be read as its own fact. Do not open by saying ' +
    'what cannot be determined, do not describe what the data does not ' +
    'contain, and do not withhold a number you have because a more complete ' +
    'one exists in principle. A reader wants the best available figure and ' +
    'its basis, not a refusal.',
    '',
    'Where two columns below could be read as the same thing, use the one ' +
    'whose name says exactly what it holds, and describe it in the ' +
    "document's own words. Never quote a column name as written here — " +
    'these are extraction labels, not the wording of the source.',
    '',
  ]

  const groups = groupAttributes(rows, query)
  const body: string[] = []
  for (const group of groups) {
    if (!group.values.length) continue
    body.push(...describeAttribute(group.label, group.values))
    if (group.names.length > 1) {
      body.push(`  this is one column that was extracted under ${group.names.length} different names, now combined`)
    }
    if (subjects.size > 1) {
      body.push(`  recorded for ${group.subjects.size} of ${subjects.size} record(s)` +
        (group.subjects.size < subjects.size
          ? `; the other ${subjects.size - group.subjects.size} have no value for it`
          : ''))
    }
  }
  if (!body.length) return null

  const block = '\n\n' + [...header, ...body].join('\n')
  // Scraped back out of the rendered text rather than tracked as it is
  // built, so the two can never drift: whatever the model was shown is
  // exactly what the verifier will accept.
  const figures = [...block.matchAll(/\b\d[\d,]*\b/g)]
    .map(m => Number(m[0].replace(/,/g, '')))
    .filter(n => Number.isFinite(n))
  return { block, figures: [...new Set(figures)] }
}
