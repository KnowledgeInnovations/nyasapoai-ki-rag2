/**
 * Outbound transactional email via Outlook/Microsoft 365 SMTP. Separate from
 * Supabase Auth's own emails (magic link, invite, password reset) — those
 * are sent by Supabase's infrastructure and configured in the Supabase
 * Dashboard under Authentication → Emails → SMTP Settings, not through this
 * module.
 */

import nodemailer from 'nodemailer'

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransporter() {
  if (cachedTransporter) return cachedTransporter
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  })
  return cachedTransporter
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailOptions): Promise<void> {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
      replyTo,
    })
    console.log(`[email] sent "${subject}" to ${Array.isArray(to) ? to.join(', ') : to} — messageId: ${info.messageId}`)
  } catch (e) {
    console.error(`[email] failed to send "${subject}" to ${Array.isArray(to) ? to.join(', ') : to}:`, (e as Error).message)
    throw e
  }
}
