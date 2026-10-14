/**
 * Subscription plans and the capacity each one includes.
 *
 * A role says what a user may do; a plan says how much the organisation has
 * paid for. The two are deliberately separate — a Senior user on Starter has
 * every Senior permission, but the workspace around them holds fewer seats
 * and documents than the same user would have on Professional.
 *
 * Limits live here as data rather than being scattered through call sites, so
 * commercial terms can change without hunting through the codebase. `null`
 * means unlimited, which is how Enterprise expresses "agreed in the contract"
 * — those workspaces are sized per agreement rather than by a published tier.
 *
 * Changing a number here changes it everywhere it is enforced. It does not
 * retroactively shrink a workspace that is already over the new limit: the
 * checks below gate *adding* to a workspace, so an organisation that exceeds
 * a reduced limit keeps what it has and simply cannot add more.
 */

export type Plan = 'starter' | 'professional' | 'enterprise'

export interface PlanLimits {
  /** Shown in billing and on the plan picker. */
  label: string
  /** Who the tier is aimed at — used in billing copy. */
  audience: string
  /** Total members, including Senior users. null = unlimited. */
  maxUsers: number | null
  /** How many of those members may hold the Senior role. null = unlimited. */
  maxSeniorUsers: number | null
  /** Documents that may exist in the workspace. null = unlimited. */
  maxDocuments: number | null
  /** Total stored bytes across all documents. null = unlimited. */
  maxStorageBytes: number | null
  /** AI questions included per billing period. null = unlimited. */
  includedQueriesPerMonth: number | null
  /** Whether Senior permissions can be granted individually (Professional+). */
  granularSeniorPermissions: boolean
  /** Departments, custom roles and per-knowledge-base access (Enterprise). */
  advancedRbac: boolean
}

const GB = 1024 * 1024 * 1024

export const PLANS: Record<Plan, PlanLimits> = {
  starter: {
    label: 'Starter',
    audience: 'Small teams',
    maxUsers: 10,
    maxSeniorUsers: 1,
    maxDocuments: 100,
    maxStorageBytes: 10 * GB,
    includedQueriesPerMonth: 1_000,
    granularSeniorPermissions: false,
    advancedRbac: false,
  },
  professional: {
    label: 'Professional',
    audience: 'Growing organisations',
    maxUsers: 50,
    maxSeniorUsers: 3,
    maxDocuments: 1_000,
    maxStorageBytes: 100 * GB,
    includedQueriesPerMonth: 10_000,
    granularSeniorPermissions: true,
    advancedRbac: false,
  },
  // Enterprise and Sovereign workspaces are sized in the contract, so nothing
  // here is capped. Per-workspace overrides (below) carry the agreed numbers.
  enterprise: {
    label: 'Enterprise',
    audience: 'Large and specialised organisations',
    maxUsers: null,
    maxSeniorUsers: null,
    maxDocuments: null,
    maxStorageBytes: null,
    includedQueriesPerMonth: null,
    granularSeniorPermissions: true,
    advancedRbac: true,
  },
}

const DEFAULT_PLAN: Plan = 'starter'

/** Unknown or missing plan strings fall back to the most restrictive tier. */
export function normalizePlan(plan: string | null | undefined): Plan {
  const p = (plan ?? '').trim().toLowerCase()
  return p === 'professional' || p === 'enterprise' || p === 'starter' ? p : DEFAULT_PLAN
}

/**
 * The limits in force for a workspace.
 *
 * `overrides` carries anything negotiated for that specific workspace — an
 * Enterprise customer with a 250-user cap, or a Starter customer given extra
 * documents as a goodwill gesture. Stored per tenant so a bespoke arrangement
 * never requires editing the tier everyone else is on.
 */
export function limitsFor(
  plan: string | null | undefined,
  overrides?: Partial<PlanLimits> | null,
): PlanLimits {
  return { ...PLANS[normalizePlan(plan)], ...(overrides ?? {}) }
}

export interface LimitCheck {
  allowed: boolean
  /** Message intended for the person who hit the limit. */
  reason?: string
  limit?: number | null
  current?: number
}

const ok: LimitCheck = { allowed: true }

/** Can another member be added? */
export function canAddUser(limits: PlanLimits, currentUsers: number): LimitCheck {
  if (limits.maxUsers === null || currentUsers < limits.maxUsers) return ok
  return {
    allowed: false,
    limit: limits.maxUsers,
    current: currentUsers,
    reason: `The ${limits.label} plan includes ${limits.maxUsers} users and this workspace already has ${currentUsers}. Upgrade the plan to invite more.`,
  }
}

/** Can another member hold the Senior role? */
export function canAddSeniorUser(limits: PlanLimits, currentSeniors: number): LimitCheck {
  if (limits.maxSeniorUsers === null || currentSeniors < limits.maxSeniorUsers) return ok
  const seat = limits.maxSeniorUsers === 1 ? 'Senior user' : 'Senior users'
  return {
    allowed: false,
    limit: limits.maxSeniorUsers,
    current: currentSeniors,
    reason: `The ${limits.label} plan includes ${limits.maxSeniorUsers} ${seat} and this workspace already has ${currentSeniors}. Upgrade the plan, or give this person the Middle role instead.`,
  }
}

/** Can another document be added? */
export function canAddDocument(limits: PlanLimits, currentDocuments: number): LimitCheck {
  if (limits.maxDocuments === null || currentDocuments < limits.maxDocuments) return ok
  return {
    allowed: false,
    limit: limits.maxDocuments,
    current: currentDocuments,
    reason: `The ${limits.label} plan includes ${limits.maxDocuments.toLocaleString()} documents and this workspace already has ${currentDocuments.toLocaleString()}. Upgrade the plan or remove documents you no longer need.`,
  }
}

/** Would storing `incomingBytes` more exceed the storage allowance? */
export function canStore(limits: PlanLimits, currentBytes: number, incomingBytes: number): LimitCheck {
  if (limits.maxStorageBytes === null || currentBytes + incomingBytes <= limits.maxStorageBytes) return ok
  return {
    allowed: false,
    limit: limits.maxStorageBytes,
    current: currentBytes,
    reason: `This upload would exceed the ${formatBytes(limits.maxStorageBytes)} of storage included in the ${limits.label} plan. Upgrade the plan or remove documents you no longer need.`,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) {
    const gb = bytes / GB
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
  }
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}
