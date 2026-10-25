import type { Metadata } from 'next'
import SettingsClient from '@/components/app/SettingsClient'
import { settingsSectionProps } from '../sectionProps'

export const metadata: Metadata = { title: 'Workspace — Nyansa AI' }

export default async function WorkspaceSettingsPage() {
  return <SettingsClient section="workspace" {...await settingsSectionProps()} />
}
