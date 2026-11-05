/**
 * The workspace audit log: who did what, when.
 *
 * Read by senior members of a workspace (Settings → Audit log) and across
 * every workspace by platform admins. The table has existed since the first
 * schema with a senior-only read policy; nothing had ever written to it.
 *
 * Two rules shape this file.
 *
 * First, recording must never break the thing it records. A failed audit
 * write cannot be allowed to fail a document upload or an invite, so every
 * write is caught. That is a real trade-off — a lost entry is a gap in a
 * record people will later rely on — so a failure is logged loudly enough to
 * find rather than swallowed.
 *
 * Second, an audit entry describes something that already happened. Record
 * after the work succeeds, never before, or the log will claim things that
 * did not occur.
 */
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Actions worth answering questions about later — "who deleted that
 * document", "who made them a Senior", "when did we go to Professional".
 *
 * A closed set rather than free text: an audit log whose vocabulary drifts
 * cannot be filtered, counted or trusted to be complete.
 */
export const AUDIT_ACTIONS = {
  DOCUMENT_UPLOADED:  'document.uploaded',
  DOCUMENT_DELETED:   'document.deleted',
  DOCUMENT_TRAINED:   'document.trained',
  USER_INVITED:       'user.invited',
  USER_ROLE_CHANGED:  'user.role_changed',
  USER_REMOVED:       'user.removed',
  WORKSPACE_CREATED:  'workspace.created',
  WORKSPACE_DOMAINS:  'workspace.domains_changed',
  WORKSPACE_LOGO:     'workspace.logo_changed',
  WORKSPACE_PLAN:     'workspace.plan_changed',
  WORKSPACE_STATUS:   'workspace.status_changed',
  // Platform-level, not workspace-level: the rate card is Nyansa AI's own
  // cost base, and changing it changes every cost figure reported after it.
  MODEL_PRICES:       'model_prices.updated',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export interface AuditEntry {
  tenantId: string
  /** Who did it. Null for something the system did on its own, e.g. a cron. */
  userId?: string | null
  action: AuditAction
  /** What kind of thing it happened to: 'document', 'user', 'workspace'. */
  resourceType: string
  /** The thing's id, when it has one. */
  resourceId?: string | null
  /**
   * Enough context to read the entry without going and looking the resource
   * up — a document's title, the role someone moved between. Keep it small
   * and keep secrets out: this is read by every senior in the workspace.
   */
  metadata?: Record<string, unknown>
}

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Records one thing that happened. Never throws and never rejects: call it
 * without awaiting if the caller is latency-sensitive.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await svc().from('audit_logs').insert({
      tenant_id:     entry.tenantId,
      user_id:       entry.userId ?? null,
      action:        entry.action,
      resource_type: entry.resourceType,
      resource_id:   entry.resourceId ?? null,
      metadata:      entry.metadata ?? {},
    })
    if (error) {
      // Loud, and carrying the entry itself: this is the only remaining
      // record that it happened at all.
      console.error(
        `[audit] LOST ENTRY ${entry.action} on ${entry.resourceType} ` +
        `${entry.resourceId ?? '—'} in tenant ${entry.tenantId}: ${error.message}`,
      )
    }
  } catch (e) {
    console.error(
      `[audit] LOST ENTRY ${entry.action} in tenant ${entry.tenantId}: ${(e as Error).message}`,
    )
  }
}

/* ── Reading ──────────────────────────────────────────────── */

export interface AuditRow {
  id: string
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  actor: { id: string | null; name: string; email: string } | null
}

/** One line of plain English for an entry, built from its metadata. */
export function describeAudit(row: AuditRow): string {
  const m = row.metadata ?? {}
  const title = typeof m.title === 'string' ? m.title : null
  const email = typeof m.email === 'string' ? m.email : null

  switch (row.action) {
    case AUDIT_ACTIONS.DOCUMENT_UPLOADED:
      return `Uploaded ${title ?? 'a document'}`
    case AUDIT_ACTIONS.DOCUMENT_DELETED:
      return `Deleted ${title ?? 'a document'}`
    case AUDIT_ACTIONS.DOCUMENT_TRAINED:
      return typeof m.chunks === 'number'
        ? `Trained ${title ?? 'a document'} — ${m.chunks.toLocaleString()} excerpts`
        : `Trained ${title ?? 'a document'}`
    case AUDIT_ACTIONS.USER_INVITED:
      return `Invited ${email ?? 'someone'}${m.role ? ` as ${m.role}` : ''}`
    case AUDIT_ACTIONS.USER_ROLE_CHANGED:
      return `Changed ${email ?? 'a member'} from ${m.from ?? '?'} to ${m.to ?? '?'}`
    case AUDIT_ACTIONS.USER_REMOVED:
      return `Removed ${email ?? 'a member'} from the workspace`
    case AUDIT_ACTIONS.WORKSPACE_CREATED:
      return `Created this workspace${m.plan ? ` on the ${m.plan} plan` : ''}`
    case AUDIT_ACTIONS.WORKSPACE_DOMAINS:
      return Array.isArray(m.domains) && m.domains.length
        ? `Set invite domains to ${m.domains.join(', ')}`
        : 'Removed all invite domain restrictions'
    case AUDIT_ACTIONS.WORKSPACE_LOGO:
      return m.removed ? 'Removed the workspace icon' : 'Changed the workspace icon'
    case AUDIT_ACTIONS.WORKSPACE_PLAN:
      return `Changed the plan from ${m.from ?? '?'} to ${m.to ?? '?'}`
    case AUDIT_ACTIONS.WORKSPACE_STATUS:
      return `Changed the workspace status from ${m.from ?? '?'} to ${m.to ?? '?'}`
    default:
      return row.action
  }
}
