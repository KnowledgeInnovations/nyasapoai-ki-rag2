'use client'

export const dynamic = 'force-dynamic'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, MailCheck } from 'lucide-react'

/**
 * Interstitial that stands between an auth email and Supabase's one-time
 * verify endpoint.
 *
 * Auth emails used to link straight to
 * `${SUPABASE_URL}/auth/v1/verify?token=…`, which works fine for a person and
 * fails badly for anyone behind corporate mail filtering. Microsoft Defender
 * Safe Links and its equivalents fetch every URL in an incoming message to
 * check it, and that fetch *is* the click: Supabase consumes the one-time
 * token, confirms the address and creates a session, so by the time the real
 * recipient clicks, the link is spent and they see an expired-link error.
 *
 * Observed on the Devtraco tenant: four invitees were confirmed and signed in
 * 20-51 seconds after their invites were created, none of whom had opened the
 * app — the scanner, not the person.
 *
 * So the email now points here instead. A scanner fetching this URL renders
 * some harmless HTML and consumes nothing; the token is only redeemed when
 * somebody actually presses the button.
 */
function AcceptInviteInner() {
  const params = useSearchParams()
  const [going, setGoing] = useState(false)

  const tokenHash = params.get('token_hash') ?? ''
  const type = params.get('type') ?? 'invite'
  const redirectTo = params.get('redirect_to') ?? ''

  const isRecovery = type === 'recovery'
  const heading = isRecovery ? 'Reset your password' : 'You have been invited'
  const blurb = isRecovery
    ? 'Choose a new password for your Nyansa AI account. This link can only be used once.'
    : 'You have been invited to a Nyansa AI workspace. Continue to set your password and finish setting up your account.'
  const cta = isRecovery ? 'Reset password' : 'Accept invitation'

  // Built here rather than in the email, so nothing consumes it until a real
  // click. Left as a plain link (not an auto-redirect) on purpose.
  const verifyUrl =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify` +
    `?token=${encodeURIComponent(tokenHash)}` +
    `&type=${encodeURIComponent(type)}` +
    `&redirect_to=${encodeURIComponent(redirectTo)}`

  const missing = !tokenHash

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 font-editorial-sans">
      <div className="w-full max-w-md border border-gray-200 bg-white p-10 shadow-sm">
        <div className="font-editorial mb-8 text-[21px] text-gray-900">
          Nyansa<span className="text-brand">·</span>AI
        </div>

        <div className="mb-5 flex h-11 w-11 items-center justify-center bg-brand-light">
          <MailCheck className="h-5 w-5 text-brand" />
        </div>

        <h1 className="font-editorial mb-3 text-[26px] leading-tight text-gray-900">{heading}</h1>
        <p className="mb-8 text-sm leading-relaxed text-gray-500">{blurb}</p>

        {missing ? (
          <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This link is incomplete. Please open the most recent email you received,
            or ask an administrator to send a new invitation.
          </p>
        ) : (
          <a
            href={verifyUrl}
            onClick={() => setGoing(true)}
            className="inline-flex w-full items-center justify-center gap-2 bg-brand px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            {going ? 'One moment…' : cta}
            {!going && <ArrowRight className="h-4 w-4" />}
          </a>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-gray-400">
          For your security this link can only be used once, and expires after a
          short time. If it no longer works, ask an administrator to send a new one.
        </p>
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  )
}
