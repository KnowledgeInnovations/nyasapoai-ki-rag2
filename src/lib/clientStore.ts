/**
 * Browser storage this app owns, keyed per signed-in account.
 *
 * localStorage and sessionStorage are scoped to the origin, not to the
 * account: whatever one user leaves behind is readable by the next person to
 * sign in on that browser. Observed on the Ghana AI Summit workspace — an
 * invited junior opened Ask AI and saw the previous user's last answer, with
 * an empty chat history beside it, because the history comes from the server
 * (correctly, hers: empty) while the thread on screen came from the snapshot
 * the previous session had left in localStorage.
 *
 * So every key this app writes carries the user id it belongs to, and a key
 * belonging to anyone else is not read — it is deleted. Scoping is the part
 * that holds even when a session ends badly (tab closed, token expired, no
 * sign-out event ever fired); the purge on sign-out is the tidy-up, not the
 * guarantee.
 */

/** Key prefixes this app owns. Anything else in storage is left alone. */
const OWNED = [
  'ki_last_session',
  'ki_pending_conversation',
  'dash-insight:',
  'dash-batch:',
] as const

const SEP = '::u:'

/** The storage key `prefix` should use for this user. */
export function scopedKey(prefix: string, userId: string): string {
  return `${prefix}${SEP}${userId}`
}

function stores(): Storage[] {
  const out: Storage[] = []
  try { out.push(window.localStorage) } catch {}
  try { out.push(window.sessionStorage) } catch {}
  return out
}

function isOwned(key: string): boolean {
  return OWNED.some(p => key === p || key.startsWith(p))
}

/**
 * Drops every key this app owns that does not belong to `userId`, including
 * keys written before scoping existed (which carry no user id at all and so
 * cannot be shown to belong to the person now signed in).
 *
 * Called on mount rather than only on sign-out, because the case that
 * matters is arriving in a browser where someone else's session ended
 * without a clean sign-out.
 */
export function purgeForeignKeys(userId: string): void {
  const suffix = `${SEP}${userId}`
  for (const store of stores()) {
    try {
      const doomed: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key && isOwned(key) && !key.endsWith(suffix)) doomed.push(key)
      }
      for (const key of doomed) store.removeItem(key)
    } catch {}
  }
}

/** Drops every key this app owns, whoever it belongs to. Used on sign-out. */
export function purgeAppStorage(): void {
  for (const store of stores()) {
    try {
      const doomed: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key && isOwned(key)) doomed.push(key)
      }
      for (const key of doomed) store.removeItem(key)
    } catch {}
  }
}
