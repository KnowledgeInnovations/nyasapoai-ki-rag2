'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Loader2, X, Plus, User, ShieldCheck, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeRole, ROLE_LABELS, ROLE_DESCRIPTIONS, canUploadDocuments } from '@/lib/roles'
import PasswordSettings from './PasswordSettings'
import TwoFactorSettings from './TwoFactorSettings'
import EmailSettings from './EmailSettings'

interface Props {
  email: string
  name: string
  role: string
  emailDomains: string[]
  isPlatformTenant: boolean
}

type TabId = 'profile' | 'security' | 'workspace'

const ROLE_BADGES: Record<string, string> = {
  senior: 'bg-gold/15 text-yellow-700 border-gold/30',
  middle: 'bg-brand-light text-brand border-brand/20',
  junior: 'bg-gray-100 text-gray-600 border-gray-200',
}

function initialsFor(name: string, email: string): string {
  const trimmed = name.trim()
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean)
    return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export default function SettingsClient({ email, name, role, emailDomains, isPlatformTenant }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('profile')

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

  const normalizedRole = normalizeRole(role)
  const roleLabel = ROLE_LABELS[normalizedRole]
  const roleBadge = ROLE_BADGES[normalizedRole]
  const roleDescription = ROLE_DESCRIPTIONS[normalizedRole]

  const [domains,      setDomains]      = useState(emailDomains)
  const [domainInput,  setDomainInput]  = useState('')
  const [domainsSaving, setDomainsSaving] = useState(false)
  const [domainsSaved,  setDomainsSaved]  = useState(false)
  const [domainsError,  setDomainsError]  = useState('')

  async function saveDomains(next: string[]) {
    setDomainsSaving(true)
    setDomainsSaved(false)
    setDomainsError('')
    try {
      const res = await fetch('/api/tenants/email-domains', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update')
      setDomains(data.domains)
      setDomainsSaved(true)
      setTimeout(() => setDomainsSaved(false), 3000)
    } catch (e) {
      setDomainsError((e as Error).message)
    } finally {
      setDomainsSaving(false)
    }
  }

  function addDomain() {
    const d = domainInput.trim().toLowerCase()
    if (!d || domains.includes(d)) { setDomainInput(''); return }
    setDomainInput('')
    saveDomains([...domains, d])
  }

  function removeDomain(d: string) {
    saveDomains(domains.filter(x => x !== d))
  }

  const TABS: { id: TabId; label: string; icon: typeof User }[] = [
    { id: 'profile',   label: 'Profile',   icon: User },
    { id: 'security',  label: 'Security',  icon: ShieldCheck },
    { id: 'workspace', label: 'Workspace', icon: Building2 },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-editorial text-2xl font-normal text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your profile, security, and workspace preferences.</p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Tab nav — horizontal scroll on mobile, vertical sidebar from md up */}
        <nav className="flex gap-1.5 overflow-x-auto pb-1 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:pb-0">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap  px-4 py-2.5 text-sm font-semibold transition',
                activeTab === tab.id ? 'bg-brand text-white shadow-md shadow-brand/20' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
              )}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Active tab content */}
        <div className="min-w-0 flex-1 space-y-6">
          {activeTab === 'profile' && (
            <>
            <section className="overflow-hidden  border border-gray-200/80 bg-white p-6 shadow-2xl shadow-black/5 md:p-8">
              <div className="mb-6 flex flex-wrap items-center gap-4  border border-gray-100 bg-gray-50/60 p-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center  bg-brand text-lg font-bold text-white shadow-md shadow-brand/20">
                  {initialsFor(displayName, email)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-gray-900">{displayName.trim() || 'Unnamed'}</p>
                  <p className="truncate text-sm text-gray-500">{email}</p>
                </div>
                <span className={cn('shrink-0  border px-3 py-1.5 text-sm font-semibold', roleBadge)}>
                  {roleLabel}
                </span>
              </div>

              <form onSubmit={handleSave} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="mt-1.5 w-full  border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                  />
                </div>

                {error && (
                  <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
                )}

                {saved && (
                  <div className="flex items-center gap-2  border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Profile updated successfully.
                  </div>
                )}

                <button type="submit" disabled={saving || !displayName.trim()}
                  className="flex items-center gap-2  bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save changes'}
                </button>
              </form>
            </section>
            <EmailSettings email={email} />
            </>
          )}

          {activeTab === 'security' && (
            <>
              <PasswordSettings email={email} />
              <TwoFactorSettings />
            </>
          )}

          {activeTab === 'workspace' && (
            <>
              <section className="overflow-hidden  border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
                  <h2 className="text-sm font-bold text-gray-800">Workspace Access</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Permissions for your current role.</p>
                </div>
                <div className="space-y-2 p-6">
                  <p className="text-sm text-gray-600">{roleDescription}</p>
                  <p className="text-sm text-gray-600">
                    {canUploadDocuments(normalizedRole)
                      ? 'You have access to upload documents, manage categories, and view dashboards.'
                      : 'Document uploads and dashboards are available to Senior and Middle roles. Contact your workspace admin for access.'}
                  </p>
                </div>
              </section>

              {normalizedRole === 'senior' && !isPlatformTenant && (
                <section className="overflow-hidden  border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
                    <h2 className="text-sm font-bold text-gray-800">Invite Restrictions</h2>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Only email addresses from these domains can be invited to this workspace.
                      Leave empty to allow any email domain.
                    </p>
                  </div>
                  <div className="space-y-4 p-6">
                    {domains.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {domains.map(d => (
                          <span key={d}
                            className="flex items-center gap-1.5  border border-brand/20 bg-brand-light px-3 py-1.5 text-sm font-medium text-brand">
                            {d}
                            <button onClick={() => removeDomain(d)} disabled={domainsSaving}
                              className="text-brand/60 transition hover:text-brand disabled:opacity-50">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {domains.length === 0 && (
                      <p className="text-sm text-gray-400">No restriction — any email domain can be invited.</p>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. yourcompany.com"
                        value={domainInput}
                        onChange={e => setDomainInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDomain() } }}
                        disabled={domainsSaving}
                        className="flex-1  border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-50"
                      />
                      <button onClick={addDomain} disabled={domainsSaving || !domainInput.trim()}
                        className="flex items-center gap-1.5  border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50">
                        <Plus className="h-4 w-4" /> Add
                      </button>
                    </div>

                    {domainsError && (
                      <p className=" border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{domainsError}</p>
                    )}
                    {domainsSaved && (
                      <div className="flex items-center gap-2  border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> Saved.
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
