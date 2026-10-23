/**
 * Makes "the query failed" impossible to mistake for "the answer is zero".
 *
 * A Supabase query does not throw when it fails; it returns
 * `{ data: null, error }`. So the ordinary idiom
 *
 *     const { count } = await service.from('x').select('*', { count: 'exact', head: true })
 *
 * leaves `count` null on any failure — a dropped connection, a column that
 * does not exist yet, a policy change — and every `!count` or `count ?? 0`
 * downstream then reads that as a true zero. The code proceeds confidently
 * on a number nobody computed.
 *
 * This is the shape of nearly every serious defect found in this system:
 *
 *  - a fact count that read as zero because the column did not exist, so a
 *    document looked unprocessed;
 *  - a profile that read as absent because its migration had not run;
 *  - a document that read as healthy because the stage that failed said
 *    nothing at all.
 *
 * Two of those failures destroy data. A count decides whether a user's
 * auth account is deleted when their last membership is removed, and
 * another decides whether a document's complete fact layer may be replaced
 * by a partial one. In both, a failed query produced null, null read as
 * zero, and zero authorised the deletion.
 *
 * So the rule here is about consequence, not tidiness:
 *
 *   mustCount / mustRows  — the answer decides whether something is
 *     deleted, replaced or authorised. A failure throws, because acting on
 *     a number nobody computed is worse than not acting.
 *   knownCount            — the answer informs a choice that has a safe
 *     default. Returns null for "not determined", which the caller has to
 *     handle deliberately; it cannot be silently added to.
 *   rowsOrEmpty           — the answer is displayed. A failure logs and
 *     shows nothing, which the reader can see.
 *
 * Use the one that matches what happens if the number is wrong.
 */

export interface SupabaseCountResult {
  count: number | null
  error: { message: string; code?: string } | null
}

export interface SupabaseDataResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

export class DatabaseUnavailableError extends Error {
  readonly cause?: { message: string; code?: string } | null
  constructor(label: string, error: { message: string; code?: string } | null) {
    super(`Could not read ${label}: ${error?.message ?? 'unknown database error'}`)
    this.name = 'DatabaseUnavailableError'
    this.cause = error
  }
}

/**
 * A count that something irreversible depends on. Throws rather than
 * returning a number nobody computed.
 */
export function mustCount(result: SupabaseCountResult, label: string): number {
  if (result.error) throw new DatabaseUnavailableError(label, result.error)
  if (result.count == null) {
    throw new DatabaseUnavailableError(label, { message: 'the query returned no count' })
  }
  return result.count
}

/** Rows that something irreversible depends on. */
export function mustRows<T>(result: SupabaseDataResult<T[]>, label: string): T[] {
  if (result.error) throw new DatabaseUnavailableError(label, result.error)
  return result.data ?? []
}

/**
 * A count whose absence the caller must handle. null means "not
 * determined" — distinct from 0, and deliberately awkward to ignore.
 */
export function knownCount(result: SupabaseCountResult, label: string): number | null {
  if (result.error) {
    console.error(`[db] could not count ${label}: ${result.error.message}`)
    return null
  }
  return result.count
}

/** Rows for display. A failure is logged and shows as nothing. */
export function rowsOrEmpty<T>(result: SupabaseDataResult<T[]>, label: string): T[] {
  if (result.error) {
    console.error(`[db] could not read ${label}: ${result.error.message}`)
    return []
  }
  return result.data ?? []
}
