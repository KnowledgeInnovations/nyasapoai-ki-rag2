import { NextRequest, NextResponse } from 'next/server'
import { requireConnectionAdmin, svc } from '../../guard'
import { syncConnection, type SharePointConnection } from '@/lib/sharepoint/sync'
import { isGraphConfigured } from '@/lib/sharepoint/graph'
import { isModelEnabled } from '@/lib/modelSwitch'

/**
 * Sync one library now, rather than waiting for the nightly run.
 *
 * Deliberately given a smaller budget than the cron: this one has a person
 * waiting on it, and a browser request that sits open for four minutes
 * reads as a hang. A library too large to finish inside the shorter
 * budget comes back as 'partial', which is the honest answer — progress
 * was made, the cursor was stored, and the rest continues on its own.
 */

export const maxDuration = 300

/** Long enough to be useful, short enough that the answer still arrives. */
const INTERACTIVE_BUDGET_MS = 90_000

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error
  const { id } = await params

  // Deliberately in this order: what the person just clicked on first,
  // then the deployment. "That connection does not exist" and "this
  // connection is paused" are about the thing in front of them and are
  // theirs to fix; the platform answers come after, so a stale page or a
  // mistyped id is not reported as a platform outage.
  const { data: connection } = await svc()
    .from('sharepoint_connections')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .eq('id', id)
    .maybeSingle()

  if (!connection) return NextResponse.json({ error: 'That connection does not exist.' }, { status: 404 })
  if (!connection.enabled) {
    return NextResponse.json({
      error: 'This connection is paused. Resume it first, then sync.',
    }, { status: 409 })
  }

  if (!isGraphConfigured()) {
    return NextResponse.json({
      error: 'SharePoint is not set up on this deployment yet.',
      notConfigured: true,
    }, { status: 503 })
  }

  // Importing a document is only worth doing if it can then be read, and
  // reading it is what the training switch governs. With the models off a
  // sync would fill the workspace with documents stuck at "processing".
  if (!(await isModelEnabled('training'))) {
    return NextResponse.json({
      error: 'AI document processing is switched off, so nothing was imported. A platform administrator can switch it back on.',
      trainingOff: true,
    }, { status: 503 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(_request.url).origin

  try {
    const result = await syncConnection(connection as SharePointConnection, {
      baseUrl,
      budgetMs: INTERACTIVE_BUDGET_MS,
    })
    return NextResponse.json({ result })
  } catch (e) {
    return NextResponse.json({
      error: `The sync failed: ${(e as Error).message}`,
    }, { status: 502 })
  }
}
