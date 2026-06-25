-- 023_email_mfa
--
-- Supabase's native MFA only supports totp/phone/webauthn factor types —
-- there is no "email" factor, so an email-based second factor can't be
-- enrolled the way TOTP is. These tables back a parallel, custom
-- verification path used only when a user has chosen email over an
-- authenticator app (see src/lib/emailMfa.ts). Both tables are written and
-- read exclusively by server code via the service-role client — never
-- queried directly by the browser client — so RLS is enabled with no
-- policies (default-deny for anon/authenticated).

create table if not exists public.email_otp_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists email_otp_codes_user_idx
  on public.email_otp_codes (user_id, created_at desc);

alter table public.email_otp_codes enable row level security;

-- Tracks which already-authenticated sessions have completed an email OTP
-- challenge, keyed by the session_id claim from that session's JWT (stable
-- across token refreshes within one login, distinct for each new sign-in) —
-- the closest equivalent we can produce ourselves to Supabase's own aal2,
-- since we can't set that claim for a factor type Supabase doesn't know about.
create table if not exists public.email_mfa_verified_sessions (
  session_id  uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

alter table public.email_mfa_verified_sessions enable row level security;
