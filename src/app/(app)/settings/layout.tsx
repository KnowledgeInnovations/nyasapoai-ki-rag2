import { getMembership, getTenant } from '@/lib/supabase/server'
import { canAccessTraining, canManageUsers, isPlatformTenant, normalizeRole } from '@/lib/roles'
import SettingsTabs, { type SettingsTab } from '@/components/app/SettingsTabs'

// Users and Training used to be top-level nav entries of their own. Both are
// administration of this workspace rather than places you go to work, so they
// are tabs here, beside Profile, Security and Workspace. Each is its own
// route, so the heavy one (Training reads every chunk row for the tenant)
// only runs when it is actually opened.
//
// The route still guards itself — see each page's own redirect. The gating
// here only decides whether a tab is worth showing.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const membership = await getMembership()
  const tenant = membership ? await getTenant(membership.tenant_id) : null
  const role = normalizeRole(membership?.role)
  const platform = isPlatformTenant(tenant)

  const tabs: SettingsTab[] = [
    { href: '/settings',           label: 'Profile',   icon: 'profile'   },
    { href: '/settings/security',  label: 'Security',  icon: 'security'  },
    { href: '/settings/workspace', label: 'Workspace', icon: 'workspace' },
    ...(canManageUsers(role)    && !platform ? [{ href: '/settings/users',    label: 'Users',    icon: 'users'    } as const] : []),
    ...(canAccessTraining(role) && !platform ? [{ href: '/settings/training', label: 'Training', icon: 'training' } as const] : []),
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-editorial text-2xl font-normal text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your profile, security, workspace, people and AI training.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsTabs tabs={tabs} />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  )
}
