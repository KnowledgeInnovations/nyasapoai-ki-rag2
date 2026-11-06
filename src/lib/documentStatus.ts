/**
 * What a document's badge should say, in one place.
 *
 * This existed twice and disagreed with itself. The training page counted
 * only real degradations; the documents page counted every entry in
 * processing_warnings, notes included. A note records something that went
 * RIGHT and is worth saying — "read as records about each TV Broadcasting
 * Station, with 12 named columns used as the vocabulary for extracted
 * facts" is the profiler reporting success. Counting it as a warning put an
 * amber triangle on a document with nothing wrong with it, and a workspace
 * owner looking at eight documents all marked "Ready (warnings)" reasonably
 * concluded the product was broken.
 *
 * A badge that fires on success teaches people to ignore badges. So the
 * rule is one rule, here, used by both pages.
 *
 * The second distinction is between work that FAILED and work that is not
 * FINISHED. Fact extraction runs against a wall-clock budget: a long
 * document gets as far as it gets, records how many excerpts are still to
 * check, and the nightly job picks the rest up. Nothing is lost and nothing
 * needs a human. That deserves "still working", not a warning triangle
 * sitting next to genuine failures.
 */

import type { Document, ProcessingWarning } from '@/types'

export type DocumentStatusKind = 'processing' | 'ready' | 'finishing' | 'degraded' | 'failed'

interface WarningBearing {
  status?: string
  status_detail?: string | null
  processing_warnings?: ProcessingWarning[]
}

/**
 * Warnings that represent something going wrong.
 *
 * A missing level predates the note/degraded distinction, so it stays a
 * degradation — the conservative reading, since those rows cannot be
 * re-classified after the fact.
 */
export function realWarnings(doc: WarningBearing): ProcessingWarning[] {
  return (doc.processing_warnings ?? []).filter(w => w.level !== 'note')
}

export function hasRealWarnings(doc: WarningBearing): boolean {
  return realWarnings(doc).length > 0
}

/**
 * True when the only thing outstanding is queued work that finishes by
 * itself. The resume route writes this sentence and the nightly job acts on
 * it, so matching the sentence is matching the mechanism.
 */
export function isFinishing(doc: WarningBearing): boolean {
  return /still queued/i.test(doc.status_detail ?? '')
}

/** How many excerpts are left, when the detail line says. */
export function queuedRemaining(doc: WarningBearing): { remaining: number; total: number } | null {
  const m = /(\d+)\s+of\s+(\d+)\s+excerpts still queued/i.exec(doc.status_detail ?? '')
  return m ? { remaining: Number(m[1]), total: Number(m[2]) } : null
}

export function documentStatusKind(doc: Document | WarningBearing): DocumentStatusKind {
  if (doc.status === 'failed')     return 'failed'
  if (doc.status === 'processing') return 'processing'
  if (doc.status !== 'ready')      return 'ready'
  if (isFinishing(doc))            return 'finishing'
  return hasRealWarnings(doc) ? 'degraded' : 'ready'
}

/**
 * One short sentence a non-technical reader can act on, or null when there
 * is nothing to say.
 *
 * Until now the reason lived only in a `title` attribute, which means it did
 * not exist on a phone and had to be discovered by hovering on a desktop.
 * The complaint that prompted this was precisely "they all have a warning /
 * why / that is my question" — the answer was in the database the whole
 * time and the page would not show it.
 */
export function statusReason(doc: Document | WarningBearing): string | null {
  const kind = documentStatusKind(doc)

  if (kind === 'finishing') {
    const q = queuedRemaining(doc)
    return q
      ? `Reading the rest of this document — ${q.total - q.remaining} of ${q.total} sections done. It continues on its own.`
      : 'Reading the rest of this document. It continues on its own.'
  }

  if (kind === 'degraded') {
    const warnings = realWarnings(doc)
    const network = warnings.some(w => w.network)
    if (network) return 'A network interruption stopped part of the processing. Retry is likely to fix it.'
    const first = warnings[0]?.message
    return doc.status_detail ?? (first ? String(first) : 'Part of the processing did not complete.')
  }

  if (kind === 'failed') return doc.status_detail ?? 'Processing failed.'

  return null
}
