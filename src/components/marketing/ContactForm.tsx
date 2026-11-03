'use client'

import { useState } from 'react'
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'

const fieldClass = 'mt-1.5 w-full border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const labelClass = 'block text-sm font-medium text-gray-700'

/**
 * The contact form had no handler, no named fields and no route: submitting it
 * reloaded the page and cleared the inputs, which reads exactly like success
 * while the enquiry went nowhere. It posts to /api/contact now.
 *
 * `source` records which call to action they arrived through, so an Enterprise
 * enquiry off the pricing page is recognisable as one in the subject line
 * rather than having to be inferred from the message.
 */
export default function ContactForm({ source }: { source?: string }) {
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName:    form.get('firstName'),
          lastName:     form.get('lastName'),
          email:        form.get('email'),
          organisation: form.get('organisation'),
          message:      form.get('message'),
          company:      form.get('company'),
          source,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again, or email no-reply@nyansaai.com.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Could not reach us just now. Please try again, or email no-reply@nyansaai.com.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-10 border border-gray-200 bg-white p-8">
        <div className="flex h-11 w-11 items-center justify-center bg-brand-light">
          <CheckCircle2 className="h-5 w-5 text-brand" />
        </div>
        <h2 className="font-editorial mt-5 text-2xl font-normal text-gray-900">Message received</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-500">
          Thank you — it is with our team and we will reply within one business
          day. If it is urgent, email us directly at{' '}
          <a href="mailto:no-reply@nyansaai.com" className="text-brand underline underline-offset-2">
            no-reply@nyansaai.com
          </a>.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-10 space-y-5 border border-gray-200 bg-white p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" type="text" autoComplete="given-name" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" type="text" autoComplete="family-name" className={fieldClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={fieldClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="organisation">Organisation</label>
        <input id="organisation" name="organisation" type="text" autoComplete="organization" className={fieldClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="message">Message</label>
        <textarea id="message" name="message" rows={5} required className={fieldClass} />
      </div>

      {/* Honeypot: off-screen and skipped by the keyboard, so a person never
          meets it and a bot filling every field gives itself away. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company">Company (leave this blank)</label>
        <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="inline-flex w-full items-center justify-center gap-2 bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {sending
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
          : <>Send message <ArrowRight className="h-3.5 w-3.5" /></>}
      </button>
    </form>
  )
}
