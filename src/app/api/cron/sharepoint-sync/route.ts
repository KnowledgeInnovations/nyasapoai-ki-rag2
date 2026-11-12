import { NextRequest, NextResponse } from 'next/server'
import { isModelEnabled } from '@/lib/modelSwitch'
import { dueConnections, syncConnection, SYNC_BUDGET_MS } from '@/lib/sharepoint/sync'
import { isGraphConfigured } from '@/lib/sharepoint/graph'

/**
 * Bring every connected SharePoint library up to date.
 *
 * Separate from auto-reprocess-documents on purpose. That route finishes
 * reading documents the platform already holds; this one goes and finds
 * new ones. Sharing a slot would mean a large import starving the
 * finishing work, or the other way round, with no way to tell which had
 * happened.
 *
 * Note the cron frequency constraint in AGENTS.md: the schedule in
 * vercel.json is once a day on the current plan. The code here is written
 * for any frequency — budget-aware, resumable, and honest about stopping
 * early — so raising it is a one-line change if the plan allows.
 */

export const maxDuration = 300

/** Under the ceiling, leaving room to record what happened. */
const CRON_BUDGET_MS = 280_000

/** Connections per run. Each can take its full budget, so this is a cap, not a target. */
const MAX_CONNECTIONS = 5

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const msLeft = () => CRON_BUDGET_MS - (Date.now() - startedAt)

  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!isGraphConfigured()) {
    // Not an error. Most deployments will never connect SharePoint, and a
    // cron that fails nightly because an optional feature is unconfigured
    // is noise that teaches people to ignore cron failures.
    return NextResponse.json({ skipped: true, reason: 'No Azure application is configured for this deployment.' })
  }

  // Importing a document is only worth doing if it can then be read, and
  // reading it is what the training switch governs. With the models off,
  // a sync would fill the workspace with documents stuck at "processing"
  // and spend the bandwidth to do it.
  if (!(await isModelEnabled('training'))) {
    console.log('[sharepoint-sync] skipped — AI document processing is switched off')
    return NextResponse.json({ skipped: true, reason: 'AI document processing is switched off', synced: 0 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host')}`
  const connections = await dueConnections(MAX_CONNECTIONS)

  const results: unknown[] = []
  const deferred: string[] = []

  for (const connection of connections) {
    // A connection started with seconds left burns them and records
    // nothing. Defer it; the ordering is oldest-sync-first, so a deferred
    // connection is first in line next time rather than starved.
    if (msLeft() < 45_000) { deferred.push(connection.display_name); continue }

    try {
      const result = await syncConnection(connection, {
        baseUrl,
        budgetMs: Math.min(SYNC_BUDGET_MS, msLeft() - 15_000),
      })
      results.push(result)
      console.log(`[sharepoint-sync] ${connection.display_name}: ${result.status} — ${result.detail}`)
    } catch (e) {
      console.error(`[sharepoint-sync] ${connection.display_name} failed:`, (e as Error).message)
      results.push({ connectionId: connection.id, status: 'failed', detail: (e as Error).message.slice(0, 300) })
    }
  }

  if (deferred.length) {
    console.log(`[sharepoint-sync] deferred to the next run: ${deferred.join(', ')}`)
  }

  return NextResponse.json({
    checked: connections.length,
    results,
    deferred,
    msUsed: Date.now() - startedAt,
  })
}
