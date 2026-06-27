/**
 * Branded HTML for every Supabase auth email, built and sent by
 * src/app/api/auth/send-email-hook/route.ts via sendEmail() (the same
 * Microsoft 365 relay that already reliably lands the 2FA code email in
 * inbox) instead of Supabase's own mailer. Mirrors supabase/email-templates/
 * — keep both in sync if the brand styling ever changes; those static files
 * stay around purely as a human-readable reference / dashboard fallback.
 */

function shell(badgeLabel: string, badgeBg: string, badgeColor: string, heading: string, bodyHtml: string, footnote: string) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${heading}</title></head>
<body style="margin:0;padding:0;background-color:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);max-width:480px;">
        <tr><td style="background-color:#2029bd;padding:28px 32px;">
          <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.2px;">Nyansa<span style="background-color:#ffffff;color:#2029bd;border-radius:6px;padding:2px 6px;font-size:12px;font-weight:700;margin-left:4px;">AI</span></span>
        </td></tr>
        <tr><td style="padding:36px 32px 16px 32px;">
          ${badgeLabel ? `<span style="display:inline-block;margin:0 0 14px 0;padding:4px 10px;background-color:${badgeBg};color:${badgeColor};font-size:11px;font-weight:700;letter-spacing:0.4px;border-radius:999px;">${badgeLabel}</span>` : ''}
          <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:800;color:#0f172a;">${heading}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #f1f5f9;">
          <p style="margin:0;font-size:11px;color:#cbd5e1;">${footnote}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function ctaBody(text: string, url: string, ctaLabel: string) {
  return `<p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#475569;">${text}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:12px;background-color:#2029bd;">
              <a href="${url}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${ctaLabel}</a>
            </td>
          </tr></table>`
}

function codeBody(text: string, code: string) {
  return `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#475569;">${text}</p>
          <div style="text-align:center;margin:0 0 4px 0;">
            <span style="display:inline-block;padding:14px 28px;background-color:#e8fbff;border-radius:12px;font-size:30px;font-weight:800;letter-spacing:8px;color:#2029bd;">${code}</span>
          </div>`
}

function alertBody(text: string) {
  return `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#475569;">${text}</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#c2410c;font-weight:600;">If you didn't make this change, contact your workspace admin immediately.</p>`
}

const EXPIRES_FOOTNOTE = 'This link will expire shortly and can only be used once.'
const NOTIFICATION_FOOTNOTE = 'This is an automatic security notification.'

export interface BuiltEmail { subject: string; html: string; text: string }

export function buildAuthEmail(actionType: string, vars: { confirmationURL?: string; token?: string }): BuiltEmail | null {
  const url = vars.confirmationURL ?? ''
  switch (actionType) {
    case 'signup':
      return {
        subject: 'Confirm your Nyansa AI account',
        html: shell('', '', '', 'Confirm your email', ctaBody('Welcome to Nyansa AI. Click below to confirm your email address and finish setting up your account.', url, 'Confirm email'), EXPIRES_FOOTNOTE),
        text: `Confirm your email: ${url}`,
      }
    case 'invite':
      return {
        subject: "You've been invited to Nyansa AI",
        html: shell('', '', '', "You've been invited", ctaBody("You've been invited to join a workspace on Nyansa AI. Click below to accept the invitation and set up your account.", url, 'Accept invitation'), EXPIRES_FOOTNOTE),
        text: `Accept your invitation: ${url}`,
      }
    case 'magiclink':
      return {
        subject: 'Your Nyansa AI sign-in link',
        html: shell('', '', '', 'Sign in to Nyansa AI', ctaBody('Click below to securely sign in. No password needed.', url, 'Sign in'), EXPIRES_FOOTNOTE),
        text: `Sign in: ${url}`,
      }
    case 'recovery':
      return {
        subject: 'Reset your Nyansa AI password',
        html: shell('', '', '', 'Reset your password', ctaBody('We received a request to reset your password. Click below to choose a new one.', url, 'Reset password'), EXPIRES_FOOTNOTE),
        text: `Reset your password: ${url}`,
      }
    case 'email_change':
    case 'email_change_current':
    case 'email_change_new':
      return {
        subject: 'Confirm your new email address',
        html: shell('', '', '', 'Confirm your new email', ctaBody('Click below to confirm this address as your new Nyansa AI account email.', url, 'Confirm new email'), EXPIRES_FOOTNOTE),
        text: `Confirm your new email: ${url}`,
      }
    case 'reauthentication':
      return {
        subject: "Confirm it's you",
        html: shell('', '', '', "Confirm it's you", codeBody("You're about to perform a sensitive action. Enter this code to confirm it's really you.", vars.token ?? ''), 'This code expires shortly.'),
        text: `Your verification code is ${vars.token}`,
      }
    case 'password_changed':
      return {
        subject: 'Your password was changed',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'Your password was changed', alertBody('The password for your Nyansa AI account was just changed.'), NOTIFICATION_FOOTNOTE),
        text: 'Your password was changed. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'email_changed':
      return {
        subject: 'Your email address was changed',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'Your email address was changed', alertBody('The email address on your Nyansa AI account was just changed.'), NOTIFICATION_FOOTNOTE),
        text: 'Your email address was changed. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'phone_changed':
      return {
        subject: 'Your phone number was changed',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'Your phone number was changed', alertBody('The phone number on your Nyansa AI account was just changed.'), NOTIFICATION_FOOTNOTE),
        text: 'Your phone number was changed. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'mfa_factor_enrolled':
      return {
        subject: 'Two-factor authentication was enabled',
        html: shell('SECURITY UPDATE', '#ecfdf5', '#047857', 'Two-factor authentication was enabled', alertBody('A new two-factor authentication method was just added to your Nyansa AI account, making it more secure.'), NOTIFICATION_FOOTNOTE),
        text: 'Two-factor authentication was enabled on your account. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'mfa_factor_unenrolled':
      return {
        subject: 'Two-factor authentication was disabled',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'Two-factor authentication was disabled', alertBody('A two-factor authentication method was just removed from your Nyansa AI account.'), NOTIFICATION_FOOTNOTE),
        text: 'Two-factor authentication was disabled on your account. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'identity_linked':
      return {
        subject: 'A new sign-in method was added',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'A new sign-in method was added', alertBody('A new way to sign in was just linked to your Nyansa AI account.'), NOTIFICATION_FOOTNOTE),
        text: 'A new sign-in method was added to your account. If this wasn\'t you, contact your workspace admin immediately.',
      }
    case 'identity_unlinked':
      return {
        subject: 'A sign-in method was removed',
        html: shell('SECURITY ALERT', '#fff7ed', '#c2410c', 'A sign-in method was removed', alertBody('A sign-in method was just removed from your Nyansa AI account.'), NOTIFICATION_FOOTNOTE),
        text: 'A sign-in method was removed from your account. If this wasn\'t you, contact your workspace admin immediately.',
      }
    default:
      return null
  }
}
