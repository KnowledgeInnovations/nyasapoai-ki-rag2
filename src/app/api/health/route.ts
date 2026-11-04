import { NextResponse } from 'next/server'

/**
 * Liveness, for a platform that needs somewhere to knock.
 *
 * Render will not send traffic to a new instance until its health check
 * passes, and will keep the previous version live if a deploy never passes —
 * which is only useful if the check means something. So this reports that
 * the process is up and answering, and nothing more.
 *
 * Deliberately does NOT touch Supabase, Anthropic or SMTP. A health check
 * that fails when a dependency hiccups takes the whole service out of
 * rotation over something it cannot fix, turning a degraded feature into an
 * outage. Readiness of dependencies belongs in monitoring, not here.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    at: new Date().toISOString(),
  })
}
