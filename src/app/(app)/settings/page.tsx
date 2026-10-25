import type { Metadata } from 'next'
import SettingsClient from '@/components/app/SettingsClient'
import { settingsSectionProps } from './sectionProps'

export const metadata: Metadata = { title: 'Settings — Nyansa AI' }

export default async function SettingsPage() {
  return <SettingsClient section="profile" {...await settingsSectionProps()} />
}
