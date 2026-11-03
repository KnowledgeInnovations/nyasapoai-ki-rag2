import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/**
 * Moves workspaces whose payment has lapsed through the lifecycle migration
 * 034 defined: active → past_due (still usable, during grace) → suspended
 * (closed, nothing deleted).
 *
 * The caution here is deliberate and worth keeping. This is the one job in
 * the system that takes access away from paying customers, so it refuses to
 * act on anything it is not sure about:
 *
 *   - a workspace with paid_until NULL is not on paid billing at all. Every
 *     workspace that predates billing is in that state, and treating null as
 *     "overdue" would close the entire platform the first time this ran.
 *   - a workspace already suspended is left alone; re-suspending it would
 *     write a fresh audit entry every night for something that did not
 *     happen.
 *   - the platform workspace is never touched.
 *
 * Suspension retains everything — documents, extracted figures, history —
 * and is undone the moment payment resumes. That is a product promise, not
 * an implementation detail: see migration 034.
 */

export const maxDuration = 60

/** How long a workspace keeps working after payment is due. */
const GRACE_DAYS = 7

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(request: NextRequest) {
  // Same contract as the other cron routes: Vercel's bearer header for a
  // scheduled run, or x-cron-secret when the daily job chains this one.
  // Without a configured secret, refuse rather than run unauthenticated —
  // this route closes workspaces.
  const bearer = request.headers.get('authorization')
  const internal = request.headers.get('x-cron-secret')
  const secret = process.env.CRON_SECRET
  if (!secret || (bearer !== `Bearer ${secret}` && internal !== secret)) {
    return new Response('Unauthorized', { status: 401 })
  }
  return runBillingSweep(new URL(request.url).searchParams.get('dryRun') === '1')
}

export async function runBillingSweep(dryRun = false) {
  const service = svc()
  const now = new Date()

  const { data: tenants, error } = await service
    .from('tenants')
    .select('id, name, status, paid_until, access_until, is_platform')
    .not('paid_until', 'is', null)
    .eq('is_platform', false)

  if (error) {
    // Refusing to guess: a failed read is not "nothing is overdue", and it is
    // certainly not grounds to suspend anybody.
    console.error('[billing-cron] could not read workspaces, doing nothing:', error.message)
    return NextResponse.json({ error: 'Could not read workspaces' }, { status: 500 })
  }

  const movedToPastDue: string[] = []
  const suspended: string[] = []

  for (const t of tenants ?? []) {
    const paidUntil = new Date(t.paid_until as string)
    if (paidUntil > now) continue            // paid up
    if (t.status === 'suspended') continue   // already closed

    const graceEnds = t.access_until
      ? new Date(t.access_until)
      : new Date(paidUntil.getTime() + GRACE_DAYS * 86_400_000)

    if (now < graceEnds) {
      // Due, but inside the grace period: usable, and told so.
      if (t.status !== 'past_due') {
        movedToPastDue.push(t.name)
        if (!dryRun) {
          await service.from('tenants')
            .update({ status: 'past_due', access_until: graceEnds.toISOString() })
            .eq('id', t.id)
          await recordAudit({
            tenantId: t.id, userId: null,
            action: AUDIT_ACTIONS.WORKSPACE_STATUS,
            resourceType: 'workspace', resourceId: t.id,
            metadata: {
              from: t.status, to: 'past_due', by: 'billing',
              grace_until: graceEnds.toISOString(),
            },
          })
        }
      }
      continue
    }

    // Grace elapsed.
    suspended.push(t.name)
    if (!dryRun) {
      await service.from('tenants').update({ status: 'suspended' }).eq('id', t.id)
      await recordAudit({
        tenantId: t.id, userId: null,
        action: AUDIT_ACTIONS.WORKSPACE_STATUS,
        resourceType: 'workspace', resourceId: t.id,
        metadata: { from: t.status, to: 'suspended', by: 'billing', note: 'nothing deleted' },
      })
    }
  }

  const summary = {
    checked: tenants?.length ?? 0,
    movedToPastDue: movedToPastDue.length,
    suspended: suspended.length,
    ...(dryRun ? { dryRun: true, wouldPastDue: movedToPastDue, wouldSuspend: suspended } : {}),
  }
  console.log(`[billing-cron] ${JSON.stringify(summary)}`)
  return NextResponse.json(summary)
}
