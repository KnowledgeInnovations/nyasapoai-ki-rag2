/**
 * Whether an account uses email as its second factor.
 *
 * The flag used to live only in user_metadata, which the signed-in user can
 * rewrite from the browser with supabase.auth.updateUser(). That made it a
 * switch the attacker holds: sign in with a stolen password, write
 * `email_mfa_enabled: false`, and the step-up is gone — the one session the
 * second factor exists to stop could turn it off.
 *
 * The authoritative copy is now app_metadata, which only the service role can
 * write, through /api/auth/email-mfa/settings, and only from a session that
 * has already passed the email check. Migration 052 copies every existing
 * user_metadata flag across.
 *
 * user_metadata is still honoured as an OR, never as an off switch: it can
 * only add the requirement, so a flag set before the migration ran keeps
 * protecting its account, and clearing it achieves nothing while the
 * app_metadata copy is set.
 *
 * Plain module, no server imports — the login and settings screens read the
 * same rule in the browser.
 */
export interface MfaFlagSource {
  app_metadata?: Record<string, unknown> | null
  user_metadata?: Record<string, unknown> | null
}

export function isEmailMfaEnabled(user: MfaFlagSource | null | undefined): boolean {
  return user?.app_metadata?.email_mfa_enabled === true
    || user?.user_metadata?.email_mfa_enabled === true
}
