'use client'

export const dynamic = 'force-dynamic'

import AuthContinue from '@/components/auth/AuthContinue'

// Where every auth email points now. The route used to be /auth/accept-invite
// for all of them, so somebody asking for a sign-in link watched their browser
// go to a URL about accepting an invitation. That route still works — see the
// note on it - because links already sitting in inboxes use it.
export default function AuthContinuePage() {
  return <AuthContinue />
}
