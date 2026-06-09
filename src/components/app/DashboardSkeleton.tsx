export default function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-52 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-4 w-80 animate-pulse rounded-lg bg-gray-100" />
        </div>
        <div className="h-7 w-36 animate-pulse rounded-lg bg-gray-100" />
      </div>

      {/* Tab bar */}
      <div className="h-10 w-full animate-pulse rounded-xl bg-gray-100" />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 animate-pulse rounded-xl bg-gray-200" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-gray-100" />
            </div>
            <div className="mt-4 h-8 w-16 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-gray-100" />
            <div className="mt-1 h-3 w-24 animate-pulse rounded bg-gray-50" />
          </div>
        ))}
      </div>

      {/* AI insight cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              <div className="h-6 w-6 animate-pulse rounded-lg bg-gray-100" />
            </div>
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-4/6 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-3/6 animate-pulse rounded bg-gray-50" />
            </div>
          </div>
        ))}
      </div>

      {/* Document list */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="h-4 w-36 animate-pulse rounded bg-gray-200" />
          <div className="mt-1 h-3 w-20 animate-pulse rounded bg-gray-100" />
        </div>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5 last:border-0">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-gray-200" />
            <div className="flex-1 space-y-1">
              <div className="h-3.5 w-48 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-5 w-14 animate-pulse rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
