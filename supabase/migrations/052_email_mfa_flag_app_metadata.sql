-- 052_email_mfa_flag_app_metadata
--
-- Email two-factor was switched on by a flag in user_metadata, which the
-- signed-in user can rewrite from the browser (supabase.auth.updateUser).
-- So a session holding only a stolen password could clear the flag and skip
-- the email step entirely. See src/lib/emailMfaFlag.ts.
--
-- The authoritative flag is now app_metadata.email_mfa_enabled, which only
-- the service role can write. This copies every existing opt-in across, so
-- accounts that turned email 2FA on before this change stay protected even
-- if their user_metadata copy is later cleared.
--
-- Additive and idempotent:
--   - it only ever ADDS email_mfa_enabled = true to app_metadata;
--   - it never removes a flag, never touches user_metadata, and never
--     touches an account that had not opted in;
--   - a row already carrying the flag is skipped, so re-running is a no-op.
--
-- The new value reaches each user's access token at their next refresh. Until
-- then the server still honours the user_metadata copy, so there is no window
-- in which an opted-in account goes unprotected.

update auth.users
set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('email_mfa_enabled', true)
where raw_user_meta_data ->> 'email_mfa_enabled' = 'true'
  and coalesce(raw_app_meta_data ->> 'email_mfa_enabled', '') <> 'true';
