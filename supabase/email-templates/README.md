# Branded auth email templates

Supabase's auth emails (signup confirmation, invite, magic link, password
reset, email change) come from these templates, not from the app's own
`src/lib/email.ts` — they're configured in the Supabase Dashboard, not
through any API key this codebase has access to, so they have to be pasted
in by hand.

**Supabase Dashboard → Authentication → Emails → Templates.** For each
template below, open the matching tab, paste the HTML into the body editor,
and set the subject line shown.

| File | Template tab | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm sign up | Confirm your NyasapoAI account |
| `invite.html` | Invite user | You've been invited to NyasapoAI |
| `magic-link.html` | Magic link or OTP | Your NyasapoAI sign-in link |
| `reset-password.html` | Reset password | Reset your NyasapoAI password |
| `change-email.html` | Change email address | Confirm your new email address |
| `reauthentication.html` | Reauthentication | Confirm it's you |
| `security-password-changed.html` | Password changed | Your password was changed |
| `security-email-changed.html` | Email address changed | Your email address was changed |
| `security-phone-changed.html` | Phone number changed | Your phone number was changed |
| `security-signin-method-linked.html` | Sign-in method linked | A new sign-in method was added |
| `security-signin-method-removed.html` | Sign-in method removed | A sign-in method was removed |
| `security-mfa-added.html` | MFA method added | Two-factor authentication was enabled |
| `security-mfa-removed.html` | MFA method removed | Two-factor authentication was disabled |

All reuse the same brand header styling as the app (`#2029bd` brand blue,
`#e8fbff` light accent) and the existing 2FA code email
(`src/lib/emailMfa.ts`) — keep that file's inline template in sync if the
brand colors here ever change.

The first five (Authentication category) use `{{ .ConfirmationURL }}` as
the action link — don't rename that token. `reauthentication.html` uses
`{{ .Token }}` (it's a code, not a link). The seven Security-category
notifications are pure FYI emails with no action link or template
variable — Supabase sends them automatically when the matching event
happens, so there's nothing to substitute.
