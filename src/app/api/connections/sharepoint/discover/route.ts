import { NextRequest, NextResponse } from 'next/server'
import { requireConnectionAdmin } from '../guard'
import {
  listSites, listDrives, isGraphConfigured, GraphError, GraphNotConfiguredError,
} from '@/lib/sharepoint/graph'

/**
 * Finding the library to connect.
 *
 * Two steps, because that is how Microsoft 365 is shaped: sites first,
 * then the document libraries inside the chosen site. Without a site id
 * there is nothing to list drives from.
 *
 * Under Sites.Selected this returns only the sites an administrator has
 * already granted the application — so an empty list is the expected
 * answer when step 4 of the Azure setup has not been done, and is
 * reported as that rather than as "no sites exist".
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error

  if (!isGraphConfigured()) {
    return NextResponse.json({
      error: 'SharePoint is not set up on this deployment yet. An administrator needs to register the Azure application first — see docs/SHAREPOINT.md.',
      notConfigured: true,
    }, { status: 503 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 })
  }
  const { azureTenantId, siteId, search } = (body ?? {}) as {
    azureTenantId?: unknown; siteId?: unknown; search?: unknown
  }

  if (typeof azureTenantId !== 'string' || !azureTenantId.trim()) {
    return NextResponse.json({
      error: 'Enter your Microsoft 365 tenant ID — the directory (tenant) ID from the Azure portal.',
    }, { status: 400 })
  }
  const creds = { azureTenantId: azureTenantId.trim() }

  try {
    // With a site chosen, list its document libraries. Without one, find
    // the sites we are allowed to see.
    if (typeof siteId === 'string' && siteId.trim()) {
      const drives = await listDrives(creds, siteId.trim())
      return NextResponse.json({
        drives: drives.map(d => ({
          id: d.id,
          name: d.name ?? 'Documents',
          driveType: d.driveType ?? null,
          webUrl: d.webUrl ?? null,
        })),
      })
    }

    const sites = await listSites(creds, typeof search === 'string' ? search : '')
    return NextResponse.json({
      sites: sites.map(s => ({
        id: s.id,
        name: s.displayName ?? s.name ?? s.id,
        webUrl: s.webUrl ?? null,
      })),
      // An empty list under Sites.Selected is a configuration state, not an
      // error, and saying so here saves the "it says there are no sites but
      // we have fifty" support conversation.
      hint: sites.length === 0
        ? 'No sites came back. Under Sites.Selected a site is invisible until an administrator grants this application access to it — step 4 of the Azure setup. Allow up to half an hour after the grant.'
        : null,
    })
  } catch (e) {
    if (e instanceof GraphNotConfiguredError) {
      return NextResponse.json({ error: e.message, notConfigured: true }, { status: 503 })
    }
    if (e instanceof GraphError) {
      // Graph's own status, translated. 401/403 here is nearly always a
      // missing consent or a missing site grant, and saying "Forbidden"
      // leaves the reader with nowhere to go.
      const message = e.status === 401 || e.status === 403
        ? 'Microsoft refused the request. Either admin consent was never granted for this application in that tenant, or the site has not been granted to it yet (step 4 of the Azure setup).'
        : e.status === 404
          ? 'Microsoft could not find that site. Check the site ID.'
          : `Microsoft returned an error (${e.status}): ${e.message}`
      return NextResponse.json({ error: message }, { status: 502 })
    }
    return NextResponse.json({
      error: `Could not reach Microsoft: ${(e as Error).message}`,
    }, { status: 502 })
  }
}
