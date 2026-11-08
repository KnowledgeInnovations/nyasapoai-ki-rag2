import { normalizeRole, type Role } from '@/lib/roles'

/**
 * Document-sensitivity access control.
 *
 * A document's `sensitivity` (documents.sensitivity) is a label the uploader
 * picks in the UI — but until migration 051 nothing anywhere enforced it:
 * the RLS policies and every service-role read path gated on tenant
 * membership alone, so a Junior could read the full text and chunks of a
 * document marked "Confidential — Senior members only" (directly, or just by
 * asking the AI about it). This module is the single source of truth for who
 * may see what, and is mirrored exactly by the SQL helpers
 * public.role_rank() / public.sensitivity_min_rank() in migration 051 so the
 * database (for anon/authenticated-key access) and the application (for
 * service-role read paths that bypass RLS) agree.
 *
 * Ranks are a simple ladder — a role may see a document when the role's rank
 * is at least the document's required rank.
 *
 *   role:  junior = 1   middle = 2   senior = 3
 *
 *   sensitivity -> minimum rank required to read
 *     public        1   (all workspace members)
 *     internal      1   (all workspace members — the default)
 *     confidential  3   (Senior only — matches the UI label)
 *     restricted    3   (Senior only — "Admins only"; there is no separate
 *                        admin role, so Admins == Senior here)
 *
 * To let Middle (managers/analysts) see Confidential documents, change
 * 'confidential' below to 2 AND the matching CASE in migration 051 — keep the
 * two in lockstep or the UI and the API will disagree.
 */

export const ROLE_RANK: Record<Role, number> = {
  junior: 1,
  middle: 2,
  senior: 3,
}

const SENSITIVITY_MIN_RANK: Record<string, number> = {
  public: 1,
  internal: 1,
  confidential: 3,
  restricted: 3,
}

/** Numeric rank for a (possibly legacy/alias) role string. */
export function roleRank(role: string | null | undefined): number {
  return ROLE_RANK[normalizeRole(role)]
}

/**
 * Minimum rank required to read a document of this sensitivity. An unknown or
 * missing value is treated as `internal` (members-only), never as `public` —
 * failing closed is the safe direction for an access gate.
 */
export function sensitivityMinRank(sensitivity: string | null | undefined): number {
  const key = (sensitivity ?? 'internal').trim().toLowerCase()
  return SENSITIVITY_MIN_RANK[key] ?? SENSITIVITY_MIN_RANK.internal
}

/** May a member with this role read a document of this sensitivity? */
export function canViewSensitivity(
  role: string | null | undefined,
  sensitivity: string | null | undefined,
): boolean {
  return roleRank(role) >= sensitivityMinRank(sensitivity)
}
