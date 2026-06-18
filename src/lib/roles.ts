/**
 * Nyasapo RBAC model — three roles: senior, middle, junior.
 *
 * Legacy/alias role strings (admin, exco, senior_manager, staff, etc.) are
 * normalized to the new model so older membership rows keep working without
 * a hard DB migration. Run supabase/migrations/004_normalize_roles.sql to
 * normalize stored values too.
 */

export type Role = 'senior' | 'middle' | 'junior'

const ROLE_ALIASES: Record<string, Role> = {
  senior:         'senior',
  admin:          'senior',
  exco:           'senior',
  senior_manager: 'senior',
  middle:         'middle',
  junior:         'junior',
  staff:          'junior',
}

export function normalizeRole(role: string | null | undefined): Role {
  return ROLE_ALIASES[role ?? ''] ?? 'junior'
}

export const ROLE_LABELS: Record<Role, string> = {
  senior: 'Senior',
  middle: 'Middle',
  junior: 'Junior',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  senior: 'C-Suite, Directors & Executives — organization-wide visibility, governance and user management.',
  middle: 'Managers, Analysts & Team Leads — operational analysis and report preparation.',
  junior: 'Officers & Staff — information retrieval and task support.',
}

/* ── Permission helpers ──────────────────────────────────────── */

// Documents: senior + middle can upload; junior is view-only
export const canUploadDocuments = (role: Role) => role === 'senior' || role === 'middle'

// Only senior can permanently delete documents
export const canDeleteDocuments = (role: Role) => role === 'senior'

// Dashboards / insights: senior + middle. Junior cannot access dashboards.
export const canAccessDashboards = (role: Role) => role === 'senior' || role === 'middle'

// AI Training console: senior only (tenant-wide AI configuration)
export const canAccessTraining = (role: Role) => role === 'senior'

// Creating/editing/deleting document categories: senior + middle (document organisation)
export const canManageCategories = (role: Role) => role === 'senior' || role === 'middle'

// User management (invite, assign roles, remove users): senior only
export const canManageUsers = (role: Role) => role === 'senior'

// Org-wide governance (audit logs, approval workflows, tenant settings): senior only
export const canAccessGovernance = (role: Role) => role === 'senior'

// The platform-operator tenant (NyasapoAI's own workspace, tenant.is_platform
// === true) manages every client tenant and uploads/trains its own reference
// documents, but has no end-users of its own — Ask/Users/Dashboards are
// client-tenant-facing features and don't apply to it.
export const isPlatformTenant = (tenant: { is_platform?: boolean | null } | null | undefined) =>
  tenant?.is_platform === true
