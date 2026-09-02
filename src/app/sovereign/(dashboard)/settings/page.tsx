"use client"

import { useState } from "react"
import {
  User,
  Bell,
  Shield,
  Globe,
  Palette,
  Key,
  Mail,
  Building,
  Save,
  Check,
  Camera,
  Eye,
  EyeOff
} from "lucide-react"
import { Modal } from "@/components/sovereign/Modal"
import { cn } from "@/lib/utils"

const settingsSections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "language", label: "Language", icon: Globe },
  { id: "appearance", label: "Appearance", icon: Palette },
]

function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-[#2563eb]" : "bg-[#e2e2e2]"
      )}
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[calc(100%-2px)]" : "translate-x-0"
        )}
      />
    </button>
  )
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile")
  const [profileSaved, setProfileSaved] = useState(false)
  const [profile, setProfile] = useState({
    name: "Admin User",
    email: "admin@govai.gh",
    organization: "Ministry of Communications",
    role: "Senior Administrator",
  })
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    documents: true,
    aiUpdates: false,
  })
  const [theme, setTheme] = useState("light")
  const [interfaceLanguage, setInterfaceLanguage] = useState("en-uk")
  const [translationTarget, setTranslationTarget] = useState("twi-asante")
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [show2FADialog, setShow2FADialog] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    new: "",
    confirm: "",
    showCurrent: false,
    showNew: false,
  })
  const [twoFAEnabled, setTwoFAEnabled] = useState(false)

  const handleSaveProfile = () => {
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  const handleChangePassword = () => {
    if (passwordForm.new !== passwordForm.confirm) {
      alert("New passwords do not match")
      return
    }
    if (passwordForm.new.length < 8) {
      alert("Password must be at least 8 characters")
      return
    }
    setShowPasswordDialog(false)
    setPasswordForm({ current: "", new: "", confirm: "", showCurrent: false, showNew: false })
  }

  const handleEnable2FA = () => {
    setTwoFAEnabled(true)
    setShow2FADialog(false)
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-[#0f172a] mb-2">Settings</h1>
        <p className="text-[#64748b] mb-8">
          Manage your account preferences and platform settings.
        </p>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <div className="md:col-span-1">
            <nav className="space-y-1">
              {settingsSections.map((section) => {
                const Icon = section.icon
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                      activeSection === section.id
                        ? "bg-[#f1f5f9] text-[#2563eb]"
                        : "text-[#424656] hover:bg-[#f8fafc]"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {section.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Settings Content */}
          <div className="md:col-span-3">
            <div className="bg-white rounded-xl border border-[#e2e2e2] p-6">
              {activeSection === "profile" && (
                <div>
                  <h2 className="text-xl font-semibold text-[#0f172a] mb-6">Profile Settings</h2>
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="h-20 w-20 rounded-full bg-[#f1f5f9] flex items-center justify-center">
                          <User className="h-10 w-10 text-[#6b7280]" />
                        </div>
                        <button className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-[#2563eb] flex items-center justify-center text-white hover:bg-[#004fcb] transition-colors">
                          <Camera className="h-4 w-4" />
                        </button>
                      </div>
                      <div>
                        <p className="font-medium text-[#0f172a]">{profile.name}</p>
                        <p className="text-sm text-[#6b7280]">{profile.email}</p>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-[#424656] mb-2">
                          Full Name
                        </label>
                        <input
                          value={profile.name}
                          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                          className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[#424656] mb-2">
                          Email Address
                        </label>
                        <input
                          value={profile.email}
                          onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                          className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[#424656] mb-2">
                          Organization
                        </label>
                        <input
                          value={profile.organization}
                          onChange={(e) => setProfile({ ...profile, organization: e.target.value })}
                          className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[#424656] mb-2">
                          Role
                        </label>
                        <input
                          value={profile.role}
                          onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                          className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={handleSaveProfile}
                        className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]"
                      >
                        {profileSaved ? (
                          <>
                            <Check className="h-4 w-4" />
                            Saved!
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Save Changes
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "notifications" && (
                <div>
                  <h2 className="text-xl font-semibold text-[#0f172a] mb-6">Notification Preferences</h2>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between py-4 border-b border-[#f1f5f9]">
                      <div className="flex items-center gap-3">
                        <Mail className="h-5 w-5 text-[#6b7280]" />
                        <div>
                          <p className="font-medium text-[#0f172a]">Email Notifications</p>
                          <p className="text-sm text-[#6b7280]">Receive updates via email</p>
                        </div>
                      </div>
                      <Switch
                        checked={notifications.email}
                        onCheckedChange={(checked) =>
                          setNotifications({ ...notifications, email: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between py-4 border-b border-[#f1f5f9]">
                      <div className="flex items-center gap-3">
                        <Bell className="h-5 w-5 text-[#6b7280]" />
                        <div>
                          <p className="font-medium text-[#0f172a]">Push Notifications</p>
                          <p className="text-sm text-[#6b7280]">Receive push notifications in browser</p>
                        </div>
                      </div>
                      <Switch
                        checked={notifications.push}
                        onCheckedChange={(checked) =>
                          setNotifications({ ...notifications, push: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between py-4 border-b border-[#f1f5f9]">
                      <div className="flex items-center gap-3">
                        <Building className="h-5 w-5 text-[#6b7280]" />
                        <div>
                          <p className="font-medium text-[#0f172a]">Document Updates</p>
                          <p className="text-sm text-[#6b7280]">Get notified when documents change</p>
                        </div>
                      </div>
                      <Switch
                        checked={notifications.documents}
                        onCheckedChange={(checked) =>
                          setNotifications({ ...notifications, documents: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3">
                        <Globe className="h-5 w-5 text-[#6b7280]" />
                        <div>
                          <p className="font-medium text-[#0f172a]">AI Model Updates</p>
                          <p className="text-sm text-[#6b7280]">Updates about AI model improvements</p>
                        </div>
                      </div>
                      <Switch
                        checked={notifications.aiUpdates}
                        onCheckedChange={(checked) =>
                          setNotifications({ ...notifications, aiUpdates: checked })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "security" && (
                <div>
                  <h2 className="text-xl font-semibold text-[#0f172a] mb-6">Security Settings</h2>
                  <div className="space-y-6">
                    <div className="p-4 bg-[#f8fafc] rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <Key className="h-5 w-5 text-[#6b7280]" />
                        <p className="font-medium text-[#0f172a]">Password</p>
                      </div>
                      <p className="text-sm text-[#6b7280] mb-4">
                        Last changed 30 days ago
                      </p>
                      <button
                        className="rounded-lg border border-[#e2e2e2] px-4 py-2 font-medium text-[#424656] transition-colors hover:bg-white"
                        onClick={() => setShowPasswordDialog(true)}
                      >
                        Change Password
                      </button>
                    </div>
                    <div className="p-4 bg-[#f8fafc] rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <Shield className="h-5 w-5 text-[#6b7280]" />
                        <p className="font-medium text-[#0f172a]">Two-Factor Authentication</p>
                        {twoFAEnabled && (
                          <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[#6b7280] mb-4">
                        {twoFAEnabled
                          ? "Your account is protected with 2FA"
                          : "Add an extra layer of security to your account"
                        }
                      </p>
                      <button
                        className={cn(
                          "rounded-lg px-4 py-2 font-medium text-white transition-colors",
                          twoFAEnabled
                            ? "bg-red-600 hover:bg-red-700"
                            : "bg-[#2563eb] hover:bg-[#004fcb]"
                        )}
                        onClick={() => {
                          if (twoFAEnabled) {
                            setTwoFAEnabled(false)
                          } else {
                            setShow2FADialog(true)
                          }
                        }}
                      >
                        {twoFAEnabled ? "Disable 2FA" : "Enable 2FA"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "language" && (
                <div>
                  <h2 className="text-xl font-semibold text-[#0f172a] mb-6">Language Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[#424656] mb-2">
                        Interface Language
                      </label>
                      <select
                        value={interfaceLanguage}
                        onChange={(e) => setInterfaceLanguage(e.target.value)}
                        className="w-full px-3 py-2 border border-[#e2e2e2] rounded-lg bg-white text-[#424656] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      >
                        <option value="en-uk">English (UK)</option>
                        <option value="en-us">English (US)</option>
                        <option value="twi-asante">Twi (Asante)</option>
                        <option value="ga">Ga</option>
                        <option value="ewe">Ewe</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#424656] mb-2">
                        Default Translation Target
                      </label>
                      <select
                        value={translationTarget}
                        onChange={(e) => setTranslationTarget(e.target.value)}
                        className="w-full px-3 py-2 border border-[#e2e2e2] rounded-lg bg-white text-[#424656] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                      >
                        <option value="twi-asante">Twi (Asante)</option>
                        <option value="twi-akuapem">Twi (Akuapem)</option>
                        <option value="ga">Ga</option>
                        <option value="ewe">Ewe</option>
                        <option value="dagbani">Dagbani</option>
                      </select>
                    </div>
                    <div className="flex justify-end pt-4">
                      <button className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 font-medium text-white transition-colors hover:bg-[#004fcb]">
                        <Save className="h-4 w-4" />
                        Save Preferences
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === "appearance" && (
                <div>
                  <h2 className="text-xl font-semibold text-[#0f172a] mb-6">Appearance</h2>
                  <div className="space-y-4">
                    <p className="text-sm text-[#6b7280]">
                      Choose how NyansaPo looks to you. Select a theme preference below.
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <button
                        onClick={() => setTheme("light")}
                        className={cn(
                          "p-4 border-2 rounded-lg text-center transition-colors",
                          theme === "light"
                            ? "border-[#2563eb]"
                            : "border-[#e2e2e2] hover:border-[#2563eb]"
                        )}
                      >
                        <div className="h-12 bg-white border border-[#e2e2e2] rounded mb-2"></div>
                        <span className="text-sm font-medium text-[#0f172a]">Light</span>
                      </button>
                      <button
                        onClick={() => setTheme("dark")}
                        className={cn(
                          "p-4 border-2 rounded-lg text-center transition-colors",
                          theme === "dark"
                            ? "border-[#2563eb]"
                            : "border-[#e2e2e2] hover:border-[#2563eb]"
                        )}
                      >
                        <div className="h-12 bg-[#0f172a] rounded mb-2"></div>
                        <span className="text-sm font-medium text-[#0f172a]">Dark</span>
                      </button>
                      <button
                        onClick={() => setTheme("system")}
                        className={cn(
                          "p-4 border-2 rounded-lg text-center transition-colors",
                          theme === "system"
                            ? "border-[#2563eb]"
                            : "border-[#e2e2e2] hover:border-[#2563eb]"
                        )}
                      >
                        <div className="h-12 bg-gradient-to-r from-white to-[#0f172a] rounded mb-2"></div>
                        <span className="text-sm font-medium text-[#0f172a]">System</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Password Change Dialog */}
      <Modal
        open={showPasswordDialog}
        onClose={() => setShowPasswordDialog(false)}
        title="Change Password"
        description="Enter your current password and choose a new one."
        footer={
          <>
            <button
              onClick={() => setShowPasswordDialog(false)}
              className="rounded-lg border border-[#e2e2e2] px-4 py-2 text-sm font-medium text-[#424656] transition-colors hover:bg-[#f8fafc]"
            >
              Cancel
            </button>
            <button
              onClick={handleChangePassword}
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]"
            >
              Update Password
            </button>
          </>
        }
      >
        <div className="space-y-4 py-4">
          <div>
            <label className="block text-sm font-medium text-[#424656] mb-2">
              Current Password
            </label>
            <div className="relative">
              <input
                type={passwordForm.showCurrent ? "text" : "password"}
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
              <button
                type="button"
                onClick={() => setPasswordForm({ ...passwordForm, showCurrent: !passwordForm.showCurrent })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280]"
              >
                {passwordForm.showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#424656] mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                type={passwordForm.showNew ? "text" : "password"}
                value={passwordForm.new}
                onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
              />
              <button
                type="button"
                onClick={() => setPasswordForm({ ...passwordForm, showNew: !passwordForm.showNew })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280]"
              >
                {passwordForm.showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#424656] mb-2">
              Confirm New Password
            </label>
            <input
              type="password"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              className="w-full rounded-lg border border-[#e2e2e2] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb]"
            />
          </div>
        </div>
      </Modal>

      {/* 2FA Dialog */}
      <Modal
        open={show2FADialog}
        onClose={() => setShow2FADialog(false)}
        title="Enable Two-Factor Authentication"
        description="Scan the QR code with your authenticator app to enable 2FA."
        footer={
          <>
            <button
              onClick={() => setShow2FADialog(false)}
              className="rounded-lg border border-[#e2e2e2] px-4 py-2 text-sm font-medium text-[#424656] transition-colors hover:bg-[#f8fafc]"
            >
              Cancel
            </button>
            <button
              onClick={handleEnable2FA}
              className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#004fcb]"
            >
              <Check className="h-4 w-4" />
              Verify & Enable
            </button>
          </>
        }
      >
        <div className="py-4 flex flex-col items-center">
          <div className="w-48 h-48 bg-[#f1f5f9] rounded-lg flex items-center justify-center mb-4">
            <div className="grid grid-cols-8 gap-1">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-4 h-4",
                    Math.random() > 0.5 ? "bg-[#0f172a]" : "bg-white"
                  )}
                />
              ))}
            </div>
          </div>
          <p className="text-sm text-[#6b7280] text-center">
            Use your authenticator app (Google Authenticator, Authy, etc.) to scan this code.
          </p>
        </div>
      </Modal>
    </div>
  )
}
