'use client'

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
 *
 * EVERY auth email comes through here — invite, sign-in link, password reset,
 * signup confirmation, email change — so the wording has to follow the `type`
 * on the link. It used to treat everything that was not a password reset as
 * an invitation, which meant an existing user who asked for a sign-in link
 * was told "You have been invited… continue to set your password and finish
 * setting up your account". Reported from the Devtraco workspace, and fair
 * enough: being told to finish setting up an account you have had for weeks
 * reads like something has gone wrong.
 */

interface Copy {
  heading: string
  blurb: string
  cta: string
  /** What to do when the link no longer works — who issues a new one differs. */
  retry: string
}

function copyFor(type: string): Copy {
  switch (type) {
    case 'magiclink':
      return {
        heading: 'Sign in to Nyansa AI',
        blurb: 'Continue to sign in to your workspace. No password needed.',
        cta: 'Sign in',
        retry: 'request a new sign-in link from the login page',
      }
    case 'recovery':
      return {
        heading: 'Reset your password',
        blurb: 'Choose a new password for your Nyansa AI account. This link can only be used once.',
        cta: 'Reset password',
        retry: 'request a new reset link from the login page',
      }
    case 'signup':
      return {
        heading: 'Confirm your email',
        blurb: 'Confirm your email address to finish setting up your Nyansa AI account.',
        cta: 'Confirm email',
        retry: 'sign up again to receive a new confirmation email',
      }
    case 'email_change':
      return {
        heading: 'Confirm your new email',
        blurb: 'Confirm this address as the new email on your Nyansa AI account.',
        cta: 'Confirm new email',
        retry: 'request the change again from Settings',
      }
    case 'invite':
      return {
        heading: 'You have been invited',
        blurb: 'You have been invited to a Nyansa AI workspace. Continue to accept the invitation and set up your account.',
        cta: 'Accept invitation',
        retry: 'ask an administrator to send a new invitation',
      }
    default:
      // An action type this page has not been taught about. Say nothing
      // specific rather than guessing wrong, which is the failure above.
      return {
        heading: 'Continue to Nyansa AI',
        blurb: 'Continue to complete this request on your Nyansa AI account.',
        cta: 'Continue',
        retry: 'request a new link',
      }
  }
}

function AuthContinueInner() {
  const params = useSearchParams()
  const [going, setGoing] = useState(false)

  const tokenHash = params.get('token_hash') ?? ''
  // No default of 'invite': an unlabelled link is not an invitation, and
  // assuming it was is exactly what put invite wording in front of someone
  // signing in. An unknown type gets neutral wording instead.
  const type = params.get('type') ?? ''
  const redirectTo = params.get('redirect_to') ?? ''

  const { heading, blurb, cta, retry } = copyFor(type)

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
            This link is incomplete. Please open the most recent email you
            received, or {retry}.
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
          short time. If it no longer works, {retry}.
        </p>
      </div>
    </div>
  )
}

export default function AuthContinue() {
  return (
    <Suspense fallback={null}>
      <AuthContinueInner />
    </Suspense>
  )
}
