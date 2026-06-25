'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TotpChallengeForm from '@/components/auth/TotpChallengeForm'

// Reached only as a server-side fallback (see (app)/layout.tsx) when a
// session has a verified TOTP factor but hasn't stepped up to aal2 yet —
// normally LoginClient.tsx handles this inline and a signed-in user never
// lands here directly.
export default function MfaChallengePage() {
  const router = useRouter()
  const supabase = createClient()

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-gray-200/80 bg-white p-8 shadow-2xl shadow-black/5">
          <TotpChallengeForm
            onVerified={() => router.push('/ask')}
            onCancel={async () => { await supabase.auth.signOut(); router.push('/auth/login') }}
          />
        </div>
      </div>
    </div>
  )
}
