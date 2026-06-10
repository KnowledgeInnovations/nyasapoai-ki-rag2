'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, UserPlus, CheckCircle2 } from 'lucide-react'
import { ROLE_LABELS, type Role } from '@/lib/roles'

export interface Member {
  id:        string
  email:     string
  name:      string
  role:      Role
  createdAt: string
  status:    'active' | 'pending'
}

interface Props {
  members:       Member[]
  currentUserId: string
}

const ROLES: Role[] = ['senior', 'middle', 'junior']

export default function UsersClient({ members, currentUserId }: Props) {
  const router = useRouter()
  const [list, setList] = useState(members)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removing, setRemoving] = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState<Role>('junior')
  const [inviting, setInviting]       = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSent, setInviteSent]   = useState(false)

  async function handleRoleChange(member: Member, role: Role) {
    setUpdatingId(member.id)
    try {
      const res = await fetch(`/api/users/${member.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role }),
      })
      if (res.ok) {
        setList(prev => prev.map(m => m.id === member.id ? { ...m, role } : m))
      }
    } catch {}
    setUpdatingId(null)
  }

  async function handleRemove() {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/users/${removeTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        setList(prev => prev.filter(m => m.id !== removeTarget.id))
      }
    } catch {}
    setRemoving(false)
    setRemoveTarget(null)
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError('')
    setInviteSent(false)
    try {
      const res  = await fetch('/api/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInviteError(data.error ?? 'Failed to send invite')
      } else {
        setInviteSent(true)
        setInviteEmail('')
        router.refresh()
        setTimeout(() => setInviteSent(false), 3000)
      }
    } catch {
      setInviteError('Failed to send invite')
    }
    setInviting(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Users</h1>
        <p className="mt-1 text-sm text-gray-500">Manage workspace members and their roles.</p>
      </div>

      {/* Invite */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <h2 className="text-sm font-bold text-gray-800">Invite a member</h2>
          <p className="mt-0.5 text-xs text-gray-500">They&apos;ll receive an email invitation to join this workspace.</p>
        </div>
        <form onSubmit={handleInvite} className="flex flex-col gap-3 p-6 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@company.com"
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Role</label>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as Role)}
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 sm:w-auto"
            >
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <button type="submit" disabled={inviting || !inviteEmail.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition hover:bg-brand-dark disabled:opacity-50">
            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Invite
          </button>
        </form>
        {inviteError && (
          <div className="px-6 pb-4">
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{inviteError}</p>
          </div>
        )}
        {inviteSent && (
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Invitation sent.
            </div>
          </div>
        )}
      </section>

      {/* Members */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/60 px-6 py-4">
          <h2 className="text-sm font-bold text-gray-800">Members</h2>
          <p className="mt-0.5 text-xs text-gray-500">{list.length} {list.length === 1 ? 'member' : 'members'} in this workspace.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {list.map(member => (
            <div key={member.id} className="flex items-center gap-4 px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-900">{member.name || member.email}</p>
                  {member.status === 'pending' && (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Invite pending
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-500">{member.email}</p>
              </div>
              <select
                value={member.role}
                disabled={updatingId === member.id || member.id === currentUserId}
                onChange={e => handleRoleChange(member, e.target.value as Role)}
                title={member.id === currentUserId ? "You can't change your own role" : undefined}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-50"
              >
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button
                onClick={() => setRemoveTarget(member)}
                disabled={member.id === currentUserId}
                title={member.id === currentUserId ? "You can't remove yourself" : 'Remove member'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Remove confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 border border-red-200">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <h3 className="mt-4 text-base font-bold text-gray-900">Remove {removeTarget.name || removeTarget.email}?</h3>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              They&apos;ll lose access to this workspace immediately. This can be undone by re-inviting them.
            </p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setRemoveTarget(null)} disabled={removing}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleRemove} disabled={removing}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50">
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
