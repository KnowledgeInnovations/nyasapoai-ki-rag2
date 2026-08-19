'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import TotpChallengeForm from '@/components/auth/TotpChallengeForm'
import EmailOtpChallengeForm from '@/components/auth/EmailOtpChallengeForm'

// Reached only as a server-side fallback (see (app)/layout.tsx) when a
// session hasn't completed its required step-up (TOTP or email, whichever
// the account uses) — normally LoginClient.tsx handles this inline and a
// signed-in user never lands here directly.
export default function MfaChallengePage() {
  const router = useRouter()
  const supabase = createClient()

  const [method, setMethod] = useState<'totp' | 'email' | null>(null)
  const [email, setEmail]   = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMethod(data.user?.user_metadata?.email_mfa_enabled ? 'email' : 'totp')
      setEmail(data.user?.email ?? '')
    })
  }, [supabase])

  async function cancel() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-md">
        <div className="border border-gray-200 bg-white p-8 shadow-[0_24px_60px_-30px_rgba(20,20,20,0.25)]">
          {method === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : method === 'email' ? (
            <EmailOtpChallengeForm email={email} onVerified={() => router.push('/ask')} onCancel={cancel} />
          ) : (
            <TotpChallengeForm onVerified={() => router.push('/ask')} onCancel={cancel} />
          )}
        </div>
      </div>
    </div>
  )
}
