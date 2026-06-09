import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Contact' }

export default function ContactPage() {
  return (
    <div className="px-6 py-24">
      <div className="mx-auto max-w-xl">
        <h1 className="text-4xl font-extrabold text-gray-900">Get in touch</h1>
        <p className="mt-3 text-gray-500">
          Questions, custom requirements, or partnership enquiries — we reply
          within one business day.
        </p>

        <form className="mt-10 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                First name
              </label>
              <input
                type="text"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Last name
              </label>
              <input
                type="text"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Work email
            </label>
            <input
              type="email"
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Organisation
            </label>
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Message
            </label>
            <textarea
              rows={5}
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Send message
          </button>
        </form>
      </div>
    </div>
  )
}
