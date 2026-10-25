'use client'

import { createContext, useContext } from 'react'

/**
 * The signed-in user's id, for the client components that cache something in
 * browser storage and must key it to the account it belongs to — see
 * src/lib/clientStore.ts for why.
 *
 * A context rather than a prop threaded through each page, because the
 * components that need it (Ask AI, the dashboard insight cards) sit at
 * different depths under the same shell, and a cache that silently falls
 * back to "no user" is exactly the failure this exists to prevent.
 */
const CurrentUserContext = createContext<string | null>(null)

export function CurrentUserProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={userId}>{children}</CurrentUserContext.Provider>
}

/**
 * Null only outside the app shell. A caller that caches per-user data must
 * treat null as "do not read or write the cache" rather than as a key.
 */
export function useCurrentUserId(): string | null {
  return useContext(CurrentUserContext)
}
