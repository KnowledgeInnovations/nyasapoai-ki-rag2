import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { getModelSwitches, invalidateModelSwitchCache, type ModelArea } from '@/lib/modelSwitch'
import { recordAudit, AUDIT_ACTIONS } from '@/lib/audit'

/**
 * Turning the AI models off and on.
 *
 * Platform admins only. This is the most consequential control in the
 * product — one request here stops every workspace — so it is audited with
 * a name against it, and it refuses anything it does not recognise rather
 * than interpreting it generously.
 */

export const dynamic = 'force-dynamic'

const KEY: Record<ModelArea, string> = {
  training: 'ai_training_enabled',
  chat:     'ai_chat_enabled',
}

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function requirePlatformAdmin() {
  const membership = await getMembership()
  if (!membership) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const tenant = await getTenant(membership.tenant_id)
  if (membership.role !== 'senior' || !tenant?.is_platform) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { membership, tenant }
}

export async function GET() {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return gate.error

  const switches = await getModelSwitches(true)
  const { data } = await svc()
    .from('platform_settings')
    .select('key, note, updated_at, updated_by')
    .in('key', [KEY.training, KEY.chat])

  return NextResponse.json({ switches, rows: data ?? [] })
}

export async function PATCH(request: NextRequest) {
  const gate = await requirePlatformAdmin()
  if ('error' in gate) return gate.error
  const user = await getUser()

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { training, chat, note } = (body ?? {}) as { training?: unknown; chat?: unknown; note?: unknown }

  const wanted: [ModelArea, boolean][] = []
  if (typeof training === 'boolean') wanted.push(['training', training])
  if (typeof chat === 'boolean')     wanted.push(['chat', chat])
  if (!wanted.length) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const reason = typeof note === 'string' ? note.trim().slice(0, 500) : ''
  const service = svc()
  const now = new Date().toISOString()

  for (const [area, on] of wanted) {
    const { error } = await service
      .from('platform_settings')
      .upsert({
        key:        KEY[area],
        value:      on,
        note:       reason || (on ? 'Switched on.' : 'Switched off.'),
        updated_at: now,
        updated_by: user?.id ?? null,
      }, { onConflict: 'key' })
    if (error) {
      return NextResponse.json({ error: `Could not change the ${area} switch: ${error.message}` }, { status: 500 })
    }
  }

  // Without this the page would show the new state while calls already in
  // flight kept reading the old one for up to five seconds. Short, but this
  // is the control where "it said off and it was still running" is exactly
  // what must not happen.
  invalidateModelSwitchCache()

  await recordAudit({
    tenantId:     gate.tenant!.id,
    userId:       user?.id ?? null,
    action:       AUDIT_ACTIONS.AI_SWITCH,
    resourceType: 'platform_settings',
    metadata:     { changes: Object.fromEntries(wanted), note: reason || null },
  })

  const switches = await getModelSwitches(true)
  return NextResponse.json({ ok: true, switches })
}
