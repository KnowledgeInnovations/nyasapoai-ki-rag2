/**
 * One event should be one warning.
 *
 * When fact extraction runs out of its budget, every call still in flight
 * reports its own expiry. The per-call allowance shrinks toward a 1s floor
 * as the deadline approaches — deliberately, see DeadlineExceededError in
 * claude.ts — so the tail of a single run produced this, on one document:
 *
 *   120x  generic_facts_resume    Time allowance of 1s for this call expired...
 *    74x  generic_facts_fallback  Time allowance of 1s for this call expired...
 *
 * Two hundred rows describing one event, stored on the document and read
 * by the admin UI. The useful entry — the budget-exhausted summary saying
 * how many excerpts remain and why — was buried among them, and a reader
 * seeing two hundred warnings reasonably concludes the document is a
 * disaster when nothing unusual happened at all.
 *
 * So warnings are collapsed where they are written rather than where they
 * are displayed: the same cause recorded once, with a count. Numbers are
 * ignored when deciding whether two messages are the same cause, because
 * "Time allowance of 1s" and "Time allowance of 35s" are one problem
 * reported twice, not two problems.
 *
 * The cap is a second, independent protection: a run that finds a hundred
 * genuinely distinct faults should still not write a hundred rows into a
 * column the UI reads on every page load.
 */

import type { ProcessingWarning } from '@/types'

/**
 * How many distinct warnings a run may record.
 *
 * Past this, further distinct causes are counted in a single overflow
 * entry. Twenty-five is far more than a healthy run produces and far
 * fewer than an unhealthy one can.
 */
export const MAX_WARNINGS = 25

const OVERFLOW_STEP = 'further_warnings'

/** Same cause, give or take the numbers in it. */
function causeKey(w: Pick<ProcessingWarning, 'step' | 'message'>): string {
  return `${w.step}|${String(w.message ?? '').replace(/\d+/g, 'N')}`
}

/**
 * Record a warning, collapsing repeats of the same cause.
 *
 * Mutates and returns the list, so it drops into the existing
 * `warnings.push(...)` call sites without restructuring them.
 */
export function addWarning(list: ProcessingWarning[], entry: ProcessingWarning): ProcessingWarning[] {
  const key = causeKey(entry)

  const existing = list.find(w => causeKey(w) === key)
  if (existing) {
    existing.count = (existing.count ?? 1) + 1
    // Keep the newest timestamp: the useful question about a repeating
    // fault is when it last happened, not when it first did.
    existing.at = entry.at
    // A cause that is sometimes a network fault is a network fault.
    if (entry.network) existing.network = true
    return list
  }

  // Notes are not failures and are few by nature; never let a flood of
  // degradations push the record of what went right out of the list.
  const distinct = list.filter(w => w.step !== OVERFLOW_STEP).length
  if (distinct >= MAX_WARNINGS) {
    const overflow = list.find(w => w.step === OVERFLOW_STEP)
    if (overflow) {
      overflow.count = (overflow.count ?? 1) + 1
      overflow.message = `${overflow.count} further warning(s) of other kinds were not recorded individually.`
      overflow.at = entry.at
    } else {
      list.push({
        step: OVERFLOW_STEP,
        message: '1 further warning(s) of other kinds were not recorded individually.',
        at: entry.at,
        level: 'degraded',
        count: 1,
      })
    }
    return list
  }

  list.push(entry)
  return list
}

/** How many times a cause fired — 1 unless it was collapsed. */
export function warningCount(w: ProcessingWarning): number {
  return w.count ?? 1
}
