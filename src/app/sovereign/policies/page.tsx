import Link from "next/link"
import { FileText, Shield, Scale, Users, ArrowRight } from "lucide-react"

const policies = [
  {
    icon: FileText,
    title: "Data Governance Framework",
    description: "Comprehensive guidelines for data handling, storage, and processing within the NyansaPo ecosystem.",
    updated: "Updated March 2024",
  },
  {
    icon: Shield,
    title: "Privacy & Security Standards",
    description: "Protecting citizen data with world-class security measures and privacy-first design principles.",
    updated: "Updated February 2024",
  },
  {
    icon: Scale,
    title: "AI Ethics Guidelines",
    description: "Ensuring responsible AI deployment with transparency, fairness, and accountability at the core.",
    updated: "Updated January 2024",
  },
  {
    icon: Users,
    title: "Accessibility Standards",
    description: "Making digital services accessible to all Ghanaians, regardless of ability or location.",
    updated: "Updated December 2023",
  },
]

export default function PoliciesPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="px-6 py-16 bg-[#f8fafc]">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-[#0f172a] mb-4">
            Policies & Guidelines
          </h1>
          <p className="text-lg text-[#64748b]">
            Our commitment to transparent governance, ethical AI, and citizen-first digital services.
          </p>
        </div>
      </section>

      {/* Policies Grid */}
      <section className="px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {policies.map((policy) => {
              const Icon = policy.icon
              return (
                <div
                  key={policy.title}
                  className="bg-white rounded-2xl border border-[#e2e2e2] p-8 hover:border-[#2563eb] transition-colors group"
                >
                  <div className="h-14 w-14 rounded-xl bg-[#f1f5f9] flex items-center justify-center mb-6 group-hover:bg-[#2563eb]/10 transition-colors">
                    <Icon className="h-7 w-7 text-[#424656] group-hover:text-[#2563eb] transition-colors" />
                  </div>
                  <h3 className="text-xl font-bold text-[#0f172a] mb-3">{policy.title}</h3>
                  <p className="text-[#64748b] mb-4">{policy.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#6b7280]">{policy.updated}</span>
                    <button className="flex items-center text-[#2563eb] hover:text-[#004fcb] font-medium">
                      Read More <ArrowRight className="h-4 w-4 ml-1" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-16 bg-[#0f172a]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Have Questions About Our Policies?
          </h2>
          <p className="text-[#94a3b8] mb-8">
            Our team is here to help you understand how NyansaPo protects your data and serves your organization.
          </p>
          <Link
            href="/sovereign/contact"
            className="inline-flex items-center justify-center rounded-lg bg-[#2563eb] px-8 py-3 font-medium text-white transition-colors hover:bg-[#004fcb]"
          >
            Contact Our Policy Team
          </Link>
        </div>
      </section>
    </>
  )
}
