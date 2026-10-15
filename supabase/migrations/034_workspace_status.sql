-- Workspace lifecycle status, plus the fields a paid workspace needs before
-- any payment provider is wired in.
--
-- Purely additive: this migration adds columns and never drops, renames or
-- deletes anything. Every existing workspace is left exactly as it was and
-- becomes 'active', because every workspace in use today predates billing and
-- must keep working untouched. A default of anything else would lock out live
-- tenants the moment this ran.
--
-- The lifecycle:
--   pending           enquiry received, workspace not yet provisioned
--   payment_required  provisioned, awaiting first successful payment
--   active            paid (or manually activated) — full access
--   past_due          payment failed or lapsed; still usable during the grace period
--   suspended         grace period elapsed, or cancelled — access blocked, DATA RETAINED
--
-- Suspension never deletes anything. A suspended workspace keeps its
-- documents, extracted text, embeddings and conversation history, and regains
-- access the moment it returns to 'active'. That is a product requirement, not
-- an implementation detail: organisations must be able to settle an invoice
-- late without having lost their corpus.

alter table public.tenants
  add column if not exists status text not null default 'active';

-- Guard the vocabulary so a typo cannot quietly create a status nothing
-- recognises. Added as NOT VALID so the migration cannot fail on existing
-- rows, then validated separately — existing rows are all 'active' and will
-- pass, but this way the ordering is explicit rather than lucky.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_status_check'
  ) then
    alter table public.tenants
      add constraint tenants_status_check
      check (status in ('pending','payment_required','active','past_due','suspended'))
      not valid;
    alter table public.tenants validate constraint tenants_status_check;
  end if;
end $$;

-- When the current access period ends. While status is 'past_due', access is
-- still permitted until this moment passes, which is the configurable grace
-- period. NULL means no deadline is being tracked (e.g. a manually activated
-- Sovereign deployment billed annually offline).
alter table public.tenants
  add column if not exists access_until timestamptz;

-- Set when a workspace first becomes active, for reporting and support.
alter table public.tenants
  add column if not exists activated_at timestamptz;

-- Free-text note for manual activations: the invoice or contract reference an
-- Enterprise or Sovereign workspace was activated against. Payment for those
-- arrives by bank transfer against a contract, never through the gateway, so
-- there is no provider record to point at.
alter table public.tenants
  add column if not exists activation_note text;

-- Per-workspace limit overrides, as a partial PlanLimits object
-- (see src/lib/plans.ts). Lets a negotiated arrangement — an Enterprise
-- customer capped at 250 users, or a goodwill allowance — be recorded without
-- editing the tier every other customer shares. NULL means "use the tier".
alter table public.tenants
  add column if not exists plan_overrides jsonb;

-- Existing workspaces are already active; this is belt and braces in case the
-- column was added by an earlier partial run without the default applying.
update public.tenants set status = 'active' where status is null;

comment on column public.tenants.status is
  'Workspace lifecycle: pending, payment_required, active, past_due, suspended. Suspension blocks access but retains all data.';
comment on column public.tenants.access_until is
  'End of the paid period. While past_due, access continues until this passes (the grace period).';
comment on column public.tenants.plan_overrides is
  'Partial PlanLimits JSON overriding the tier defaults for this workspace only.';
