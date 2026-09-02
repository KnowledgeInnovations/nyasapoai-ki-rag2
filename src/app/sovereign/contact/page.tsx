"use client"

import { useState } from "react"
import { MapPin, Phone, Mail, Clock, Send } from "lucide-react"

const contactInfo = [
  {
    icon: MapPin,
    title: "Visit Us",
    details: ["Ministry of Communications Building", "Independence Avenue", "Accra, Ghana"],
  },
  {
    icon: Phone,
    title: "Call Us",
    details: ["+233 (0) 302 123 456", "+233 (0) 302 123 457"],
  },
  {
    icon: Mail,
    title: "Email Us",
    details: ["info@nyansapo.gov.gh", "support@nyansapo.gov.gh"],
  },
  {
    icon: Clock,
    title: "Business Hours",
    details: ["Monday - Friday: 9AM - 5PM", "Saturday: 10AM - 2PM"],
  },
]

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    organization: "",
    subject: "",
    message: "",
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <>
      {/* Hero Section */}
      <section className="px-6 py-16 bg-[#f8fafc]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-[#0f172a] mb-4">
            Contact Us
          </h1>
          <p className="text-lg text-[#64748b]">
            Get in touch with our team. We&apos;re here to help with any questions about NyansaPo AI.
          </p>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Contact Form */}
            <div>
              <h2 className="text-2xl font-bold text-[#0f172a] mb-6">Send Us a Message</h2>

              {submitted ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                  <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Send className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#0f172a] mb-2">Message Sent!</h3>
                  <p className="text-[#64748b]">
                    Thank you for contacting us. We&apos;ll get back to you within 24-48 hours.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false)
                      setFormData({ name: "", email: "", organization: "", subject: "", message: "" })
                    }}
                    className="mt-4 rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]"
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#424656] mb-2">
                        Full Name *
                      </label>
                      <input
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#424656] mb-2">
                        Email Address *
                      </label>
                      <input
                        required
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#424656] mb-2">
                      Organization
                    </label>
                    <input
                      value={formData.organization}
                      onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                      className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                      placeholder="Your organization"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#424656] mb-2">
                      Subject *
                    </label>
                    <input
                      required
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                      placeholder="How can we help?"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#424656] mb-2">
                      Message *
                    </label>
                    <textarea
                      required
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e2e2e2] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb] min-h-[150px]"
                      placeholder="Tell us more about your inquiry..."
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-[#2563eb] py-3 font-medium text-white transition-colors hover:bg-[#004fcb] flex items-center justify-center gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Send Message
                  </button>
                </form>
              )}
            </div>

            {/* Contact Information */}
            <div>
              <h2 className="text-2xl font-bold text-[#0f172a] mb-6">Contact Information</h2>
              <div className="space-y-6">
                {contactInfo.map((info) => {
                  const Icon = info.icon
                  return (
                    <div
                      key={info.title}
                      className="flex items-start gap-4 p-4 bg-[#f8fafc] rounded-xl"
                    >
                      <div className="h-12 w-12 rounded-lg bg-[#2563eb]/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-6 w-6 text-[#2563eb]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[#0f172a] mb-1">{info.title}</h3>
                        {info.details.map((detail, index) => (
                          <p key={index} className="text-sm text-[#64748b]">
                            {detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Map Placeholder */}
              <div className="mt-8 bg-[#f8fafc] rounded-xl h-64 flex items-center justify-center border border-[#e2e2e2]">
                <div className="text-center">
                  <MapPin className="h-8 w-8 text-[#6b7280] mx-auto mb-2" />
                  <p className="text-sm text-[#6b7280]">Interactive map coming soon</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
