/**
 * Workspace lifecycle, and the single question the app actually asks of it:
 * may this workspace be used right now?
 *
 * Suspension blocks access; it never removes anything. A suspended workspace
 * keeps its documents, extracted text, embeddings and conversation history,
 * and regains access the instant it returns to 'active'. Organisations have to
 * be able to settle an invoice late without having lost their corpus.
 */

export type WorkspaceStatus =
  | 'pending'           // enquiry received, not yet provisioned
  | 'payment_required'  // provisioned, awaiting first payment
  | 'active'            // paid, or manually activated — full access
  | 'past_due'          // payment lapsed; usable until the grace period ends
  | 'suspended'         // grace elapsed or cancelled — blocked, data retained

const STATUSES: WorkspaceStatus[] = [
  'pending', 'payment_required', 'active', 'past_due', 'suspended',
]

/**
 * Unknown, missing or malformed values resolve to 'active'.
 *
 * This is deliberate and load-bearing. Every workspace that existed before
 * billing arrived is legitimately in use, and the column may be absent
 * entirely on a deployment where the migration has not yet run. Failing open
 * keeps those workspaces working; failing closed would lock out paying
 * customers over a schema mismatch.
 */
export function normalizeStatus(status: string | null | undefined): WorkspaceStatus {
  const s = (status ?? '').trim().toLowerCase() as WorkspaceStatus
  return STATUSES.includes(s) ? s : 'active'
}

export interface AccessDecision {
  allowed: boolean
  status: WorkspaceStatus
  /** True while a lapsed workspace is still inside its grace period. */
  inGracePeriod: boolean
  /** When access ends, where one is being tracked. */
  accessUntil: Date | null
  /** Shown to the user when access is refused. */
  reason?: string
}

/**
 * Whether the workspace may be used.
 *
 * 'past_due' is deliberately permissive: a failed payment should nag, not
 * lock people out mid-sentence. Access continues until `access_until` passes,
 * which is the configurable grace period. Once it has passed the workspace is
 * treated as suspended even if a scheduled job has not yet relabelled it, so
 * the grace period is enforced by the clock rather than by a cron run.
 */
export function workspaceAccess(
  rawStatus: string | null | undefined,
  accessUntilRaw?: string | Date | null,
): AccessDecision {
  const status = normalizeStatus(rawStatus)
  const accessUntil = accessUntilRaw ? new Date(accessUntilRaw) : null
  const graceRemaining = accessUntil !== null && accessUntil.getTime() > Date.now()

  switch (status) {
    case 'active':
      return { allowed: true, status, inGracePeriod: false, accessUntil }

    case 'past_due':
      // No deadline recorded means nothing has decided when grace ends, so
      // keep the workspace usable rather than guessing at a cutoff.
      if (accessUntil === null || graceRemaining) {
        return { allowed: true, status, inGracePeriod: true, accessUntil }
      }
      return {
        allowed: false, status, inGracePeriod: false, accessUntil,
        reason: 'This workspace is suspended because a payment is outstanding. Your documents and history are safe and will be available again as soon as payment is settled.',
      }

    case 'payment_required':
      return {
        allowed: false, status, inGracePeriod: false, accessUntil,
        reason: 'This workspace is not active yet. It will open as soon as the first payment is confirmed.',
      }

    case 'pending':
      return {
        allowed: false, status, inGracePeriod: false, accessUntil,
        reason: 'This workspace is still being set up. You will be notified as soon as it is ready.',
      }

    case 'suspended':
      return {
        allowed: false, status, inGracePeriod: false, accessUntil,
        reason: 'This workspace is suspended. Your documents and history are retained in full and will be available again once access is restored.',
      }
  }
}

export const STATUS_LABELS: Record<WorkspaceStatus, string> = {
  pending:          'Pending setup',
  payment_required: 'Payment required',
  active:           'Active',
  past_due:         'Past due',
  suspended:        'Suspended',
}
