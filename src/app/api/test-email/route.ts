// TEMPORARY — verifies the Outlook SMTP credentials work end-to-end on the
// deployed environment. Remove this route once confirmed.
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'

export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const to = new URL(request.url).searchParams.get('to') || user.email

  try {
    await sendEmail({
      to,
      subject: 'NyasapoAI SMTP test',
      html: '<p>This is a test email confirming outbound SMTP is working.</p>',
      text: 'This is a test email confirming outbound SMTP is working.',
    })
    return NextResponse.json({ success: true, sentTo: to })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
