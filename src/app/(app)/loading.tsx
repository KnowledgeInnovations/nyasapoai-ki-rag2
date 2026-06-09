// Shown instantly when navigating between app pages —
// the sidebar + topnav stay in place; only this area transitions.
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Page title bar */}
      <div className="space-y-2">
        <div className="h-6 w-40 rounded-xl bg-gray-200" />
        <div className="h-4 w-64 rounded-lg bg-gray-100" />
      </div>

      {/* Stat / card row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-24 rounded-2xl border border-gray-100 bg-gray-50" />
        ))}
      </div>

      {/* Content block */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white px-5 py-4">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-3/4 rounded-full bg-gray-200" />
              <div className="h-3 w-1/2 rounded-full bg-gray-100" />
            </div>
            <div className="h-6 w-16 rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
