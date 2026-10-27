'use client'

export const dynamic = 'force-dynamic'

import AuthContinue from '@/components/auth/AuthContinue'

// Kept for auth emails already sent: every one of them carries this path, and
// they stay valid until their tokens expire. New emails point at
// /auth/continue, which does not claim to be about an invitation when it is
// not. Both render the same page, which takes its wording from the link's
// `type` — see src/components/auth/AuthContinue.tsx.
export default function AcceptInvitePage() {
  return <AuthContinue />
}
