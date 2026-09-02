"use client"

import { useState } from "react"
import Link from "next/link"
import { FileText, Bot, Languages, BarChart3, Globe } from "lucide-react"
import { Modal } from "@/components/sovereign/Modal"

export default function SovereignPage() {
  const [showDemoDialog, setShowDemoDialog] = useState(false)
  const [showContactDialog, setShowContactDialog] = useState(false)
  const [formSubmitted, setFormSubmitted] = useState(false)
  const [demoForm, setDemoForm] = useState({ name: "", email: "", organization: "", date: "" })
  const [contactForm, setContactForm] = useState({ name: "", email: "", message: "" })

  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormSubmitted(true)
    setTimeout(() => {
      setShowDemoDialog(false)
      setFormSubmitted(false)
      setDemoForm({ name: "", email: "", organization: "", date: "" })
    }, 2000)
  }

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormSubmitted(true)
    setTimeout(() => {
      setShowContactDialog(false)
      setFormSubmitted(false)
      setContactForm({ name: "", email: "", message: "" })
    }, 2000)
  }

  return (
    <>
      {/* Hero Section */}
      <section className="px-6 py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-[#f8fafc] border border-[#e2e2e2] rounded-full px-4 py-1.5 mb-6">
                <span className="h-2 w-2 rounded-full bg-[#785900]"></span>
                <span className="text-xs font-medium text-[#424656] uppercase tracking-wide">
                  Powering Nation-Wide Transformation
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-[#0f172a] leading-tight mb-6 text-balance">
                Empowering Ghana&apos;s Future with{" "}
                <span className="text-[#2563eb]">Sovereign AI</span>
              </h1>
              <p className="text-lg text-[#64748b] mb-8 leading-relaxed">
                NyasaPo AI delivers a unified intelligence layer built specifically for the
                Ghanaian ecosystem, ensuring data sovereignty while accelerating
                administrative excellence and local innovation.
              </p>
              <div className="flex items-center gap-4">
                <Link
                  href="/sovereign/dashboard"
                  className="inline-flex h-auto items-center justify-center rounded-lg bg-[#2563eb] px-6 py-3 font-medium text-white transition-colors hover:bg-[#004fcb]"
                >
                  Get Started
                </Link>
                <Link
                  href="/sovereign/policies"
                  className="inline-flex h-auto items-center justify-center rounded-lg border border-[#0f172a] px-6 py-3 font-medium text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                >
                  Learn More
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="bg-[#0f172a] rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute inset-0 opacity-30">
                  <svg viewBox="0 0 400 300" className="w-full h-full">
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2563eb" strokeWidth="0.5" opacity="0.3"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                    <circle cx="200" cy="150" r="80" fill="none" stroke="#2563eb" strokeWidth="1" opacity="0.5"/>
                    <circle cx="200" cy="150" r="60" fill="none" stroke="#2563eb" strokeWidth="1" opacity="0.3"/>
                    <circle cx="200" cy="150" r="40" fill="none" stroke="#2563eb" strokeWidth="1" opacity="0.2"/>
                  </svg>
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-center mb-6">
                    <div className="relative">
                      <Globe className="h-32 w-32 text-[#2563eb] opacity-50" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="grid grid-cols-3 gap-1">
                          {[...Array(9)].map((_, i) => (
                            <div key={i} className="w-3 h-3 rounded-full bg-[#2563eb] opacity-60"></div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3 mt-4">
                    <Bot className="h-8 w-8 text-[#64748b]" />
                    <Bot className="h-8 w-8 text-[#64748b]" />
                    <Bot className="h-8 w-8 text-[#64748b]" />
                  </div>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 right-4 bg-[#1a1c1c] rounded-xl p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#2563eb]/20 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-[#2563eb]" />
                </div>
                <div>
                  <p className="text-xs text-[#2563eb] font-medium uppercase">Live Insight</p>
                  <p className="text-sm text-white">98.4% Efficiency Gain in Digital Processing</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pillars Section */}
      <section className="px-6 py-16 bg-[#f8fafc]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-[#0f172a] mb-3 text-balance">The Pillars of Sovereignty</h2>
          <p className="text-[#64748b] mb-12">
            Harnessing the Digital Pulse to drive efficiency across every tier of government
            and private enterprise.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Document Automation */}
            <Link href="/sovereign/dashboard" className="block">
              <div className="bg-white rounded-2xl p-6 border border-[#e2e2e2] hover:border-[#2563eb] transition-colors h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-xl bg-[#f1f5f9] flex items-center justify-center">
                    <FileText className="h-6 w-6 text-[#424656]" />
                  </div>
                  <span className="text-xs text-[#6b7280] uppercase tracking-wide">01 / Documentation</span>
                </div>
                <h3 className="text-xl font-bold text-[#0f172a] mb-2">Document Automation</h3>
                <p className="text-[#64748b] text-sm mb-6">
                  Revolutionize record-keeping with AI that understands local
                  contexts, legal frameworks, and administrative nuances. Digitize
                  centuries of knowledge in seconds.
                </p>
                <div className="bg-[#0f172a] rounded-xl p-4 relative overflow-hidden h-40">
                  <div className="absolute inset-0 flex items-center justify-center opacity-60">
                    <svg viewBox="0 0 200 100" className="w-full h-full">
                      <circle cx="100" cy="50" r="30" fill="none" stroke="#2563eb" strokeWidth="2" />
                      <circle cx="60" cy="50" r="20" fill="none" stroke="#2563eb" strokeWidth="1" opacity="0.5" />
                      <circle cx="140" cy="50" r="20" fill="none" stroke="#2563eb" strokeWidth="1" opacity="0.5" />
                      <line x1="80" y1="50" x2="120" y2="50" stroke="#2563eb" strokeWidth="1" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            {/* AI Assistant */}
            <Link href="/sovereign/ai-assistant" className="block">
              <div className="bg-[#FACC15] rounded-2xl p-6 hover:bg-[#eab308] transition-colors h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-[#0f172a]" />
                  </div>
                  <span className="text-xs text-[#0f172a]/70 uppercase tracking-wide">02 / Interaction</span>
                </div>
                <h3 className="text-xl font-bold text-[#0f172a] mb-2">AI Assistant</h3>
                <p className="text-[#0f172a]/80 text-sm mb-6">
                  A smart, context-aware companion that
                  speaks your language and understands
                  your operational workflow.
                </p>
                <span className="inline-flex w-full items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]">
                  Explore KiYaNi
                </span>
              </div>
            </Link>

            {/* Native Translation */}
            <Link href="/sovereign/ai-models" className="block">
              <div className="bg-white rounded-2xl p-6 border border-[#e2e2e2] hover:border-[#2563eb] transition-colors h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-12 w-12 rounded-xl bg-[#f1f5f9] flex items-center justify-center">
                    <Languages className="h-6 w-6 text-[#424656]" />
                  </div>
                  <h3 className="text-xl font-bold text-[#0f172a]">Native Translation</h3>
                </div>
                <p className="text-[#64748b] text-sm mb-4">
                  Breaking language barriers with high-fidelity translation
                  for Twi, Ga, Ewe, and more. Inclusive technology for every
                  citizen.
                </p>
                <div className="flex gap-2 mt-4">
                  <div className="h-2 flex-1 bg-[#2563eb] rounded-full"></div>
                  <div className="h-2 flex-1 bg-[#64748b] rounded-full"></div>
                  <div className="h-2 flex-1 bg-[#2563eb] rounded-full"></div>
                </div>
              </div>
            </Link>

            {/* Decision Support */}
            <Link href="/sovereign/analytics" className="block">
              <div className="bg-white rounded-2xl p-6 border border-[#e2e2e2] hover:border-[#2563eb] transition-colors h-full">
                <div className="flex items-start gap-4">
                  <div>
                    <div className="h-12 w-12 rounded-xl bg-[#f1f5f9] flex items-center justify-center mb-4">
                      <BarChart3 className="h-6 w-6 text-[#424656]" />
                    </div>
                    <h3 className="text-xl font-bold text-[#0f172a] mb-2">Decision Support</h3>
                    <p className="text-[#64748b] text-sm">
                      Advanced analytics that process vast
                      datasets to provide actionable insights
                      for policy makers and business
                      leaders.
                    </p>
                  </div>
                  <div className="bg-[#f8fafc] rounded-xl p-4 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      <span className="text-xs font-medium text-[#424656]">OPTIMIZED</span>
                    </div>
                    <div className="h-16 w-24 relative">
                      <svg viewBox="0 0 100 50" className="w-full h-full">
                        <path d="M 0 40 Q 25 35, 50 25 T 100 15" fill="none" stroke="#2563eb" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-16 bg-[#0f172a]">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 text-balance">
                Ready to join the<br />Sovereign AI<br />movement?
              </h2>
              <p className="text-[#94a3b8] mb-8">
                Deploy KiYaNi AI within your organization today and experience the
                future of Ghanaian digital utility.
              </p>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowDemoDialog(true)}
                  className="rounded-lg bg-white px-6 py-2 font-medium text-[#0f172a] transition-colors hover:bg-[#f1f5f9]"
                >
                  Schedule a Demo
                </button>
                <button
                  onClick={() => setShowContactDialog(true)}
                  className="rounded-lg border border-white px-6 py-2 font-medium text-white transition-colors hover:bg-white/10"
                >
                  Contact Sales
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="relative">
                <Globe className="h-48 w-48 text-[#2563eb] opacity-30" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-24 w-24 rounded-full border-2 border-[#2563eb] opacity-50"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Schedule Demo Dialog */}
      <Modal
        open={showDemoDialog}
        onClose={() => setShowDemoDialog(false)}
        title="Schedule a Demo"
        description="Fill out the form below and our team will reach out to schedule a personalized demo."
      >
        {formSubmitted ? (
          <div className="py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium text-[#0f172a]">Request Submitted!</p>
            <p className="text-sm text-[#6b7280]">We&apos;ll contact you soon.</p>
          </div>
        ) : (
          <form onSubmit={handleDemoSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Full Name</label>
              <input
                required
                value={demoForm.name}
                onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                placeholder="Enter your name"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Work Email</label>
              <input
                required
                type="email"
                value={demoForm.email}
                onChange={(e) => setDemoForm({ ...demoForm, email: e.target.value })}
                placeholder="you@organization.gov.gh"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Organization</label>
              <input
                required
                value={demoForm.organization}
                onChange={(e) => setDemoForm({ ...demoForm, organization: e.target.value })}
                placeholder="Ministry / Agency name"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Preferred Date</label>
              <input
                type="date"
                value={demoForm.date}
                onChange={(e) => setDemoForm({ ...demoForm, date: e.target.value })}
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#2563eb] py-2 font-medium text-white transition-colors hover:bg-[#004fcb]">
              Request Demo
            </button>
          </form>
        )}
      </Modal>

      {/* Contact Sales Dialog */}
      <Modal
        open={showContactDialog}
        onClose={() => setShowContactDialog(false)}
        title="Contact Sales"
        description="Get in touch with our sales team for pricing and enterprise solutions."
      >
        {formSubmitted ? (
          <div className="py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium text-[#0f172a]">Message Sent!</p>
            <p className="text-sm text-[#6b7280]">Our team will respond shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleContactSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Full Name</label>
              <input
                required
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                placeholder="Enter your name"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Work Email</label>
              <input
                required
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                placeholder="you@organization.gov.gh"
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#424656] mb-1">Message</label>
              <textarea
                required
                value={contactForm.message}
                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                placeholder="Tell us about your requirements..."
                rows={4}
                className="w-full px-3 py-2 border border-[#e2e2e2] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#2563eb] py-2 font-medium text-white transition-colors hover:bg-[#004fcb]">
              Send Message
            </button>
          </form>
        )}
      </Modal>
    </>
  )
}
