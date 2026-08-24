import { redirect } from 'next/navigation'

// The 8 fixed department dashboards (this one included) were replaced by a
// single self-organizing dashboard at /dashboards — see that page and
// AdaptiveDashboard.tsx. Kept as a redirect so old bookmarks/links still
// land somewhere useful instead of 404ing.
export default function ExecutiveDashboardRedirect() {
  redirect('/dashboards')
}
