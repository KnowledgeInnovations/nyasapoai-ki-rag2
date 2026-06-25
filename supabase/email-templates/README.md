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
| `confirm-signup.html` | Confirm signup | Confirm your NyasapoAI account |
| `invite.html` | Invite user | You've been invited to NyasapoAI |
| `magic-link.html` | Magic Link | Your NyasapoAI sign-in link |
| `reset-password.html` | Reset Password | Reset your NyasapoAI password |
| `change-email.html` | Change Email Address | Confirm your new email address |

All five reuse the same brand header/button styling as the app (`#2029bd`
brand blue, `#e8fbff` light accent) and the existing 2FA code email
(`src/lib/emailMfa.ts`) — keep that file's inline template in sync if the
brand colors here ever change.

Every template uses `{{ .ConfirmationURL }}`, which Supabase substitutes
automatically — don't change that token's name.
