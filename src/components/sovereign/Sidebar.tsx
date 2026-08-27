"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, TrendingUp, Globe, FolderOpen, Settings, Sparkles, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { Modal } from "./Modal"

const sidebarItems = [
  { name: "Dashboard", href: "/sovereign/dashboard", icon: LayoutDashboard },
  { name: "Analytics", href: "/sovereign/analytics", icon: TrendingUp },
  { name: "AI Models", href: "/sovereign/ai-models", icon: Globe },
  { name: "Library", href: "/sovereign/library", icon: FolderOpen },
  { name: "Settings", href: "/sovereign/settings", icon: Settings },
]

const plans = [
  {
    name: "Basic",
    price: "Free",
    features: ["5,000 AI tokens/month", "Basic document editing", "2 translations/day"],
    current: false,
  },
  {
    name: "Pro",
    price: "GH₵ 99/mo",
    features: ["50,000 AI tokens/month", "Advanced AI features", "Unlimited translations", "Priority support"],
    current: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    features: ["Unlimited AI tokens", "Custom AI models", "Dedicated support", "SLA guarantee", "On-premise deployment"],
    current: false,
  },
]

export function SovereignSidebar() {
  const pathname = usePathname()
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)

  const handleUpgrade = (planName: string) => {
    setSelectedPlan(planName)
    setTimeout(() => {
      setShowUpgradeDialog(false)
      setSelectedPlan(null)
    }, 1500)
  }

  return (
    <>
      <aside className="flex min-h-[calc(100vh-64px)] w-[200px] flex-col border-r border-[#e2e2e2] bg-white">
        <div className="border-b border-[#e2e2e2] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e2e2e2] bg-[#f1f5f9]">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#785900] to-[#004fcb]">
                <span className="text-xs font-bold text-white">G</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0f172a]">Admin Portal</p>
              <p className="text-xs text-[#2563eb]">Verified Access</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2">
          {sidebarItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "bg-[#f1f5f9] text-[#2563eb]" : "text-[#424656] hover:bg-[#f8fafc]"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            )
          })}

          {/* AI Assistant Link */}
          <Link
            href="/sovereign/ai-assistant"
            className={cn(
              "mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname === "/sovereign/ai-assistant"
                ? "bg-[#f1f5f9] text-[#2563eb]"
                : "text-[#424656] hover:bg-[#f8fafc]"
            )}
          >
            <Bot className="h-5 w-5" />
            AI Assistant
          </Link>
        </nav>
        <div className="p-4">
          <div className="rounded-lg bg-[#f8fafc] p-4">
            <p className="mb-1 text-xs font-semibold text-[#2563eb]">PRO PLAN</p>
            <p className="mb-3 text-xs text-[#6b7280]">
              You&apos;ve used 85% of your AI generation tokens.
            </p>
            <div className="mb-3 h-2 rounded-full bg-[#e2e2e2]">
              <div className="h-2 rounded-full bg-[#2563eb]" style={{ width: "85%" }}></div>
            </div>
            <button
              onClick={() => setShowUpgradeDialog(true)}
              className="w-full rounded-lg bg-[#2563eb] py-2 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]"
            >
              Upgrade Plan
            </button>
          </div>
        </div>
      </aside>

      {/* Upgrade Dialog */}
      <Modal
        open={showUpgradeDialog}
        onClose={() => setShowUpgradeDialog(false)}
        title="Upgrade Your Plan"
        description="Choose the plan that best fits your organization's needs."
        className="max-w-2xl"
      >
        <div className="grid gap-4 py-4 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "rounded-xl border-2 p-4 transition-colors",
                plan.current ? "border-[#2563eb] bg-[#2563eb]/5" : "border-[#e2e2e2] hover:border-[#2563eb]"
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-[#0f172a]">{plan.name}</h3>
                {plan.current && (
                  <span className="rounded-full bg-[#2563eb]/10 px-2 py-0.5 text-xs font-medium text-[#2563eb]">
                    Current
                  </span>
                )}
              </div>
              <p className="mb-4 text-2xl font-bold text-[#0f172a]">{plan.price}</p>
              <ul className="mb-4 space-y-2">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#6b7280]">
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#2563eb]" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleUpgrade(plan.name)}
                disabled={plan.current || selectedPlan === plan.name}
                className={cn(
                  "w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none",
                  plan.current
                    ? "cursor-not-allowed bg-[#e2e2e2] text-[#6b7280]"
                    : selectedPlan === plan.name
                    ? "bg-green-500 text-white"
                    : "bg-[#2563eb] text-white hover:bg-[#004fcb]"
                )}
              >
                {selectedPlan === plan.name
                  ? "Processing..."
                  : plan.current
                  ? "Current Plan"
                  : plan.name === "Enterprise"
                  ? "Contact Sales"
                  : "Upgrade"}
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
