import { SovereignSidebar } from '@/components/sovereign/Sidebar'

export default function SovereignDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1">
      <SovereignSidebar />
      <main className="flex flex-1 flex-col">
        <div className="flex-1">{children}</div>
      </main>
    </div>
  )
}
