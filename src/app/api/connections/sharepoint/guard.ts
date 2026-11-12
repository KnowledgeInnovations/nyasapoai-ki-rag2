import { NextResponse } from 'next/server'
import { getMembership, getTenant, getUser } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/roles'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Who may connect an outside document library.
 *
 * Senior only, and not negotiable. Connecting a library is a standing
 * grant: every file in it, and every file anyone adds to it afterwards,
 * becomes answerable in this workspace at a sensitivity chosen once, at
 * connection time. That is the same weight as changing who can read a
 * Confidential document, which is already Senior-only.
 *
 * The platform workspace is excluded. It holds no customer documents and
 * has no library of its own to connect; offering it there would only
 * invite someone to connect a customer's library into the wrong place.
 */
export async function requireConnectionAdmin() {
  const membership = await getMembership()
  if (!membership) {
    return { error: NextResponse.json({ error: 'Please sign in again.' }, { status: 401 }) }
  }
  if (normalizeRole(membership.role) !== 'senior') {
    return {
      error: NextResponse.json({
        error: 'Only a Senior member can connect or change a document library.',
      }, { status: 403 }),
    }
  }
  const tenant = await getTenant(membership.tenant_id)
  if (tenant?.is_platform) {
    return {
      error: NextResponse.json({
        error: 'Connect libraries from the workspace that will hold the documents, not the platform workspace.',
      }, { status: 403 }),
    }
  }
  const user = await getUser()
  return { tenantId: membership.tenant_id, userId: user?.id ?? null }
}

export function svc(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** The levels a connection may carry, matching migration 053's check constraint. */
export const SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted'] as const
