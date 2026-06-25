-- 024_membership_activity
--
-- Supabase's own auth.users.last_sign_in_at only updates on sign-in, not on
-- ongoing use — useless for showing "is this person actually using the app
-- right now" in a long-lived-session app like this one (cookies persist
-- 400 days, see src/lib/supabase/middleware.ts). last_active_at is touched
-- on every protected-route request instead (debounced, see
-- touchLastActive() in src/lib/supabase/server.ts), so it reflects real
-- recent usage, not just the last login.

alter table public.memberships add column if not exists last_active_at timestamptz;
