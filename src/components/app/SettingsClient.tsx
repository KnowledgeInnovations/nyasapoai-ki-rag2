'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Loader2 } from 'lucide-react'

interface Props {
  email: string
  name: string
  role: string
}

export default function SettingsClient({ email, name, role }: Props) {
  const [displayName, setDisplayName] = useState(name)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState('')
  const router = useRouter()

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!displayName.trim()) return
    setSaving(true)
    setSaved(false)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({
      data: { name: displayName.trim() },
    })

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  const ROLE_META: Record<string, { label: string; badge: string }> = {
    admin:          { label: 'Admin',           badge: 'bg-gold/15 text-yellow-700 border-gold/30' },
    exco:           { label: 'EXCO',            badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    senior_manager: { label: 'Senior Manager',  badge: 'bg-brand-light text-brand border-brand/20' },
    staff:          { label: 'Staff',           badge: 'bg-gray-100 text-gray-600 border-gray-200' },
    // legacy
    senior:         { label: 'Senior',          badge: 'bg-gold/15 text-yellow-700 border-gold/30' },
    middle:         { label: 'Middle',          badge: 'bg-brand-light text-brand border-brand/20' },
    junior:         { label: 'Junior',          badge: 'bg-gray-100 text-gray-600 border-gray-200' },
  }
  const { label: roleLabel, badge: roleBadge } = ROLE_META[role] ?? { label: role, badge: 'bg-gray-100 text-gray-600 border-gray-200' }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your profile and workspace preferences.</p>
      </div>

      {/* Profile */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <h2 className="text-sm font-bold text-gray-800">Profile</h2>
          <p className="mt-0.5 text-xs text-gray-500">Update your display name and view your account details.</p>
        </div>
        <form onSubmit={handleSave} className="space-y-5 p-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
            <input type="email" value={email} disabled
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-400 cursor-not-allowed" />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Role</label>
            <div className="mt-1.5">
              <span className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold ${roleBadge}`}>
                {roleLabel}
              </span>
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
          )}

          {saved && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Profile updated successfully.
            </div>
          )}

          <button type="submit" disabled={saving || !displayName.trim()}
            className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save changes'}
          </button>
        </form>
      </section>

      {/* Workspace */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <h2 className="text-sm font-bold text-gray-800">Workspace Access</h2>
          <p className="mt-0.5 text-xs text-gray-500">Permissions for your current role.</p>
        </div>
        <div className="p-6">
          <p className="text-sm text-gray-600">
            {['admin', 'exco', 'senior_manager', 'senior', 'middle'].includes(role)
              ? 'You have access to upload documents, manage categories, and view dashboards.'
              : 'Document uploads and dashboards are available to Admin, EXCO, and Senior Manager roles. Contact your admin for access.'}
          </p>
        </div>
      </section>
    </div>
  )
}
