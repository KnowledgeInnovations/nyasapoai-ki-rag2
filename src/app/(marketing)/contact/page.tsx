import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'

export const metadata: Metadata = { title: 'Contact' }

const fieldClass = 'mt-1.5 w-full border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const labelClass = 'block text-sm font-medium text-gray-700'

export default function ContactPage() {
  return (
    <div className="bg-paper px-6 py-24 font-editorial-sans md:px-8">
      <div className="animate-fade-up mx-auto max-w-xl">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Contact</span>
        <h1 className="font-editorial mt-3.5 text-4xl font-normal text-gray-900">Get in touch</h1>
        <p className="mt-3 text-gray-500">
          Questions, custom requirements, or partnership enquiries — we reply
          within one business day.
        </p>

        <form className="mt-10 space-y-5 border border-gray-200 bg-white p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>First name</label>
              <input type="text" className={fieldClass} />
            </div>
            <div>
              <label className={labelClass}>Last name</label>
              <input type="text" className={fieldClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Work email</label>
            <input type="email" className={fieldClass} />
          </div>

          <div>
            <label className={labelClass}>Organisation</label>
            <input type="text" className={fieldClass} />
          </div>

          <div>
            <label className={labelClass}>Message</label>
            <textarea rows={5} className={fieldClass} />
          </div>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Send message <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  )
}
