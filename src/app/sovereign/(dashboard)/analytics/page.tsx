"use client"

import { BarChart3, TrendingUp, Users, FileText, ArrowUp, ArrowDown } from "lucide-react"

const metrics = [
  {
    title: "Total Documents",
    value: "1,284",
    change: "+12.5%",
    trend: "up",
    icon: FileText,
  },
  {
    title: "AI Processing",
    value: "98.4%",
    change: "+2.1%",
    trend: "up",
    icon: TrendingUp,
  },
  {
    title: "Active Users",
    value: "342",
    change: "+8.3%",
    trend: "up",
    icon: Users,
  },
  {
    title: "Translation Requests",
    value: "5,621",
    change: "-3.2%",
    trend: "down",
    icon: BarChart3,
  },
]

const recentActivity = [
  { action: "Document processed", user: "Ministry of Finance", time: "2 min ago" },
  { action: "Translation completed", user: "Regional Office", time: "5 min ago" },
  { action: "New policy uploaded", user: "Legal Department", time: "12 min ago" },
  { action: "AI analysis completed", user: "Admin Portal", time: "18 min ago" },
  { action: "Document exported", user: "External Affairs", time: "25 min ago" },
]

export default function AnalyticsPage() {
  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-[#0f172a] mb-2">Analytics Dashboard</h1>
        <p className="text-[#64748b] mb-8">
          Monitor platform usage, AI processing metrics, and user engagement across the NyansaPo ecosystem.
        </p>

        {/* Metrics Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <div
                key={metric.title}
                className="bg-white rounded-xl border border-[#e2e2e2] p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="h-10 w-10 rounded-lg bg-[#f1f5f9] flex items-center justify-center">
                    <Icon className="h-5 w-5 text-[#6b7280]" />
                  </div>
                  <span
                    className={`flex items-center gap-1 text-sm font-medium ${
                      metric.trend === "up" ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {metric.trend === "up" ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )}
                    {metric.change}
                  </span>
                </div>
                <p className="text-2xl font-bold text-[#0f172a] mb-1">{metric.value}</p>
                <p className="text-sm text-[#6b7280]">{metric.title}</p>
              </div>
            )
          })}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Chart Placeholder */}
          <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
            <h3 className="font-semibold text-[#0f172a] mb-4">Processing Volume</h3>
            <div className="h-64 flex items-end gap-2">
              {[65, 40, 80, 55, 90, 70, 85, 60, 75, 95, 50, 88].map((height, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[#2563eb] rounded-t-sm transition-all hover:bg-[#004fcb]"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-[#6b7280]">
              <span>Jan</span>
              <span>Feb</span>
              <span>Mar</span>
              <span>Apr</span>
              <span>May</span>
              <span>Jun</span>
              <span>Jul</span>
              <span>Aug</span>
              <span>Sep</span>
              <span>Oct</span>
              <span>Nov</span>
              <span>Dec</span>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
            <h3 className="font-semibold text-[#0f172a] mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {recentActivity.map((activity, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-[#f1f5f9] last:border-0"
                >
                  <div>
                    <p className="font-medium text-sm text-[#0f172a]">{activity.action}</p>
                    <p className="text-xs text-[#6b7280]">{activity.user}</p>
                  </div>
                  <span className="text-xs text-[#6b7280]">{activity.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
