"use client"

import { useState } from "react"
import Link from "next/link"
import {
  MessageCircle,
  Book,
  Video,
  Phone,
  Mail,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react"

const supportOptions = [
  {
    icon: MessageCircle,
    title: "Live Chat",
    description: "Get instant help from our support team",
    action: "Start Chat",
    available: "Available 24/7",
  },
  {
    icon: Book,
    title: "Documentation",
    description: "Browse our comprehensive guides",
    action: "View Docs",
    available: "500+ articles",
  },
  {
    icon: Video,
    title: "Video Tutorials",
    description: "Learn with step-by-step videos",
    action: "Watch Now",
    available: "50+ tutorials",
  },
  {
    icon: Phone,
    title: "Phone Support",
    description: "Speak directly with an expert",
    action: "Call Us",
    available: "Mon-Fri, 9AM-5PM",
  },
]

const faqs = [
  {
    question: "How do I get started with NyansaPo AI?",
    answer: "Getting started is easy! Simply click 'Access' in the navigation bar to create your account. Once registered, you'll have access to the dashboard where you can explore our AI tools, including document processing, translation, and policy analysis features.",
  },
  {
    question: "What languages does the translation engine support?",
    answer: "Our translation engine supports 12 Ghanaian dialects including Twi (Asante and Akuapem variants), Ga, Ewe, Dagbani, Hausa, and more. We continuously train our models to improve accuracy and add new language support.",
  },
  {
    question: "Is my data secure with NyansaPo?",
    answer: "Absolutely. Data sovereignty is at the core of our platform. All data is processed and stored within Ghana, complying with national data protection regulations. We use enterprise-grade encryption and never share your data with third parties.",
  },
  {
    question: "How does the AI document processing work?",
    answer: "Our AI analyzes documents using advanced natural language processing optimized for Ghanaian legal and administrative contexts. It can summarize, translate, refine, and extract key information from policy documents, reports, and official correspondence.",
  },
  {
    question: "What are the pricing plans available?",
    answer: "We offer flexible pricing tiers including a free trial, Professional plan for individual departments, and Enterprise plan for large-scale government deployments. Contact our sales team for custom pricing based on your organization's needs.",
  },
]

export default function SupportPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [searchQuery, setSearchQuery] = useState("")

  return (
    <>
      {/* Hero Section */}
      <section className="px-6 py-16 bg-[#f8fafc]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-[#0f172a] mb-4">
            How Can We Help?
          </h1>
          <p className="text-lg text-[#64748b] mb-8">
            Find answers, get support, and learn how to make the most of NyansaPo AI.
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6b7280]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for help articles..."
              className="w-full rounded-lg border border-[#e2e2e2] bg-white pl-12 py-3 text-lg outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
            />
          </div>
        </div>
      </section>

      {/* Support Options */}
      <section className="px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0f172a] mb-8 text-center">Get Support</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {supportOptions.map((option) => {
              const Icon = option.icon
              return (
                <div
                  key={option.title}
                  className="bg-white rounded-xl border border-[#e2e2e2] p-6 text-center hover:border-[#2563eb] transition-colors"
                >
                  <div className="h-14 w-14 rounded-xl bg-[#f1f5f9] flex items-center justify-center mx-auto mb-4">
                    <Icon className="h-7 w-7 text-[#2563eb]" />
                  </div>
                  <h3 className="font-semibold text-[#0f172a] mb-2">{option.title}</h3>
                  <p className="text-sm text-[#64748b] mb-3">{option.description}</p>
                  <p className="text-xs text-[#6b7280] mb-4">{option.available}</p>
                  <button className="w-full rounded-lg bg-[#2563eb] py-2 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]">
                    {option.action}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="px-6 py-16 bg-[#f8fafc]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-[#0f172a] mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-white rounded-xl border border-[#e2e2e2] overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className="font-semibold text-[#0f172a] pr-4">{faq.question}</span>
                  {openFaq === index ? (
                    <ChevronUp className="h-5 w-5 text-[#6b7280] flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-[#6b7280] flex-shrink-0" />
                  )}
                </button>
                {openFaq === index && (
                  <div className="px-6 pb-6 text-[#64748b]">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-[#0f172a] mb-4">
            Still Need Help?
          </h2>
          <p className="text-[#64748b] mb-8">
            Our support team is ready to assist you with any questions or issues.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="mailto:support@nyasapo.gov.gh"
              className="inline-flex items-center justify-center rounded-lg border border-[#e2e2e2] px-4 py-2 font-medium text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
            >
              <Mail className="h-4 w-4 mr-2" />
              Email Support
            </a>
            <Link
              href="/sovereign/contact"
              className="inline-flex items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
