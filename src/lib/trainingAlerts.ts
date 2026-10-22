/**
 * Tells a workspace's Senior users when a document finished training without
 * a complete fact layer.
 *
 * Why this exists. Such a document looks healthy: its status reads 'ready',
 * it appears in the list, and the only visible sign is a hover tooltip on a
 * badge. A 40-page station register sat in that state holding zero facts, and
 * nobody knew until an answer came back thin and somebody thought to ask. The
 * cost of silence is answers that are quietly worse than they should be,
 * which is the failure mode hardest for a user to detect on their own.
 *
 * Deliberately quiet about retries. The remaining work is queued and
 * continues automatically, so this is a notice, not an alarm, and it fires
 * once per incident rather than on every pass.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './email'

// One notice per document per day. Fact extraction resumes automatically, so
// a document mid-recovery would otherwise generate a message per pass.
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export interface IncompleteTrainingAlert {
  tenantId: string
  documentId: string
  documentTitle: string
  remaining: number
  total: number
  /** Why it stopped, including the budget accounting where available. */
  reason: string
}

export async function alertIncompleteTraining(
  service: SupabaseClient,
  alert: IncompleteTrainingAlert,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    // Suppress a repeat for an incident already reported.
    const { data: doc, error: docErr } = await service
      .from('documents')
      .select('last_incomplete_alert_at')
      .eq('id', alert.documentId)
      .maybeSingle()

    if (docErr) {
      // Includes "column does not exist" before migration 036 — skip the
      // alert rather than failing the training run that triggered it.
      console.error('[trainingAlerts] could not read alert state:', docErr.message)
      return { sent: false, reason: 'alert state unavailable' }
    }

    const last = doc?.last_incomplete_alert_at ? new Date(doc.last_incomplete_alert_at).getTime() : 0
    if (Date.now() - last < ALERT_COOLDOWN_MS) {
      return { sent: false, reason: 'already notified within the cooldown' }
    }

    // Senior users of this workspace — the people who can act on it.
    const { data: seniors } = await service
      .from('memberships')
      .select('users:user_id (email)')
      .eq('tenant_id', alert.tenantId)
      .eq('role', 'senior')

    const recipients = (seniors ?? [])
      .map(m => {
        const u = m.users as { email?: string } | { email?: string }[] | null
        return Array.isArray(u) ? u[0]?.email : u?.email
      })
      .filter((e): e is string => !!e)

    if (!recipients.length) return { sent: false, reason: 'no Senior users to notify' }

    const { data: tenant } = await service
      .from('tenants').select('name').eq('id', alert.tenantId).maybeSingle()

    const pct = alert.total > 0 ? Math.round(((alert.total - alert.remaining) / alert.total) * 100) : 0

    await sendEmail({
      to: recipients,
      subject: `Document still being processed: ${alert.documentTitle}`,
      text:
        `"${alert.documentTitle}" has finished its current processing pass but is not fully indexed yet.\n\n` +
        `${alert.total - alert.remaining} of ${alert.total} excerpts checked (${pct}%). ` +
        `${alert.remaining} still queued.\n\n` +
        `${alert.reason}\n\n` +
        `Nothing has been lost, and the remaining excerpts are processed automatically. ` +
        `Until they are, answers drawing on this document may be less complete than usual — ` +
        `particularly questions that count or list things across the whole document.\n\n` +
        `You can continue it immediately from the document's Training page.\n\n` +
        `${tenant?.name ?? 'Your workspace'} · Nyansa AI`,
      html:
        `<p>"<strong>${escapeHtml(alert.documentTitle)}</strong>" has finished its current processing pass but is not fully indexed yet.</p>` +
        `<p><strong>${alert.total - alert.remaining} of ${alert.total}</strong> excerpts checked (${pct}%). ${alert.remaining} still queued.</p>` +
        `<p style="color:#555">${escapeHtml(alert.reason)}</p>` +
        `<p>Nothing has been lost, and the remaining excerpts are processed automatically. Until they are, answers drawing on this document may be less complete than usual — particularly questions that count or list things across the whole document.</p>` +
        `<p>You can continue it immediately from the document's Training page.</p>` +
        `<p style="color:#888;font-size:12px">${escapeHtml(tenant?.name ?? 'Your workspace')} &middot; Nyansa AI</p>`,
    })

    await service.from('documents')
      .update({ last_incomplete_alert_at: new Date().toISOString() })
      .eq('id', alert.documentId)

    return { sent: true }
  } catch (e) {
    // An alert that fails must never fail the processing run that raised it.
    console.error('[trainingAlerts] alert failed:', (e as Error).message)
    return { sent: false, reason: (e as Error).message }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
