import { NextRequest, NextResponse } from 'next/server'
import { requireConnectionAdmin, svc, SENSITIVITIES } from './guard'
import { getSite, isGraphConfigured, GraphError } from '@/lib/sharepoint/graph'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/** Listing a workspace's connected libraries, and connecting a new one. */

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error

  const { data, error } = await svc()
    .from('sharepoint_connections')
    .select('*')
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: `Could not read the connections: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ connections: data ?? [], configured: isGraphConfigured() })
}

export async function POST(request: NextRequest) {
  const gate = await requireConnectionAdmin()
  if ('error' in gate) return gate.error

  if (!isGraphConfigured()) {
    return NextResponse.json({
      error: 'SharePoint is not set up on this deployment yet.',
      notConfigured: true,
    }, { status: 503 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 })
  }
  const { azureTenantId, siteId, driveId, displayName, sensitivity, department } =
    (body ?? {}) as Record<string, unknown>

  const azure = typeof azureTenantId === 'string' ? azureTenantId.trim() : ''
  const site  = typeof siteId === 'string' ? siteId.trim() : ''
  const drive = typeof driveId === 'string' ? driveId.trim() : ''
  const name  = typeof displayName === 'string' ? displayName.trim().slice(0, 200) : ''
  const level = typeof sensitivity === 'string' ? sensitivity.trim().toLowerCase() : 'internal'

  // Each of these is named separately rather than as one "invalid request",
  // because every one of them is a different thing for the reader to go
  // and fix.
  if (!azure) return NextResponse.json({ error: 'The Microsoft 365 tenant ID is missing.' }, { status: 400 })
  if (!site)  return NextResponse.json({ error: 'No site was chosen.' }, { status: 400 })
  if (!drive) return NextResponse.json({ error: 'No document library was chosen.' }, { status: 400 })
  if (!name)  return NextResponse.json({ error: 'Give the connection a name, so it can be recognised later.' }, { status: 400 })
  if (!(SENSITIVITIES as readonly string[]).includes(level)) {
    return NextResponse.json({
      error: `"${level}" is not a sensitivity level. Choose one of: ${SENSITIVITIES.join(', ')}.`,
    }, { status: 400 })
  }

  // Prove the library can actually be read before storing a row that
  // claims it can. The alternative is a connection that looks healthy on
  // this screen and fails silently at 2am in a cron log nobody reads.
  let siteUrl: string | null = null
  try {
    const found = await getSite({ azureTenantId: azure }, site)
    siteUrl = found.webUrl ?? null
  } catch (e) {
    const status = e instanceof GraphError ? e.status : 0
    return NextResponse.json({
      error: status === 401 || status === 403
        ? 'Microsoft refused access to that site. Admin consent or the site grant (step 4 of the Azure setup) is missing, so nothing was connected.'
        : `Could not confirm access to that site, so nothing was connected: ${(e as Error).message}`,
    }, { status: 502 })
  }

  const service = svc()
  const { data, error } = await service
    .from('sharepoint_connections')
    .insert({
      tenant_id:       gate.tenantId,
      display_name:    name,
      azure_tenant_id: azure,
      site_id:         site,
      drive_id:        drive,
      site_url:        siteUrl,
      sensitivity:     level,
      department:      typeof department === 'string' && department.trim() ? department.trim().slice(0, 100) : null,
      connected_by:    gate.userId,
    })
    .select('*')
    .single()

  if (error) {
    // The unique (tenant_id, drive_id) constraint. Connecting the same
    // library twice would import every file in it twice.
    if (error.code === '23505') {
      return NextResponse.json({
        error: 'That library is already connected to this workspace.',
      }, { status: 409 })
    }
    return NextResponse.json({ error: `Could not save the connection: ${error.message}` }, { status: 500 })
  }

  await recordAudit({
    tenantId:     gate.tenantId,
    userId:       gate.userId,
    action:       AUDIT_ACTIONS.CONNECTION_ADDED,
    resourceType: 'sharepoint_connection',
    resourceId:   data.id,
    metadata:     { library: name, sensitivity: level, siteUrl, driveId: drive },
  })

  return NextResponse.json({ connection: data })
}
