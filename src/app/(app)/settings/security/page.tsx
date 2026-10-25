import type { Metadata } from 'next'
import SettingsClient from '@/components/app/SettingsClient'
import { settingsSectionProps } from '../sectionProps'

export const metadata: Metadata = { title: 'Security — Nyansa AI' }

export default async function SecuritySettingsPage() {
  return <SettingsClient section="security" {...await settingsSectionProps()} />
}
