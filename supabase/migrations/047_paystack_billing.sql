-- Billing through Paystack.
--
-- Migration 034 built the workspace lifecycle — pending, payment_required,
-- active, past_due, suspended, with access_until for a grace period — and
-- nothing has ever moved a workspace through it, because there was no
-- payment provider. This is that provider.
--
-- Purely additive: columns on tenants and one new table. Nothing is dropped
-- or renamed and no existing row's data changes. Every existing workspace
-- keeps status 'active' and a null paid_until, which the cron reads as "not
-- on paid billing" and leaves alone — nobody is suspended by this landing.

alter table public.tenants
  -- Paid up to this instant. Null means this workspace is not on paid
  -- billing at all: it was created before billing existed, or its plan has
  -- no published price. The billing cron must ignore those rather than
  -- treat them as overdue, or applying this migration would close every
  -- workspace on the platform.
  add column if not exists paid_until timestamptz,
  -- Paystack's customer record, so repeat payments attach to one customer.
  add column if not exists paystack_customer_code text,
  -- A reusable card authorization. Cards can be charged again without the
  -- customer present; mobile money cannot (Paystack does not support
  -- recurring MoMo), so for a MoMo payer this stays null and every renewal
  -- is a fresh charge they approve. That difference is the whole reason
  -- billing is driven by paid_until here rather than by Paystack
  -- subscriptions.
  add column if not exists paystack_authorization_code text,
  -- What the authorization is, for showing "renews automatically" honestly
  -- rather than promising it to someone paying by MoMo.
  add column if not exists paystack_channel text;

-- Every payment attempt, successful or not. The audit trail for money.
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- Our reference, sent to Paystack and echoed back on the webhook. Unique
  -- so a webhook delivered twice — which Paystack does retry — cannot be
  -- applied twice.
  reference       text not null unique,
  plan            text not null,
  -- Minor units, as Paystack counts them: pesewas for GHS. Stored as sent so
  -- a later dispute compares like with like.
  amount_minor    bigint not null,
  currency        text not null default 'GHS',
  period          text not null default 'month' check (period in ('month', 'year')),
  status          text not null default 'pending'
                  check (status in ('pending', 'success', 'failed', 'abandoned')),
  -- 'card', 'mobile_money', 'bank', … as Paystack reports it.
  channel         text,
  -- Paystack's own verification response, kept whole. When money and access
  -- disagree later, this is the only record of what they actually told us.
  provider_response jsonb not null default '{}'::jsonb,
  initiated_by    uuid references public.users(id),
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists payments_tenant_created_idx
  on public.payments (tenant_id, created_at desc);

create index if not exists payments_status_idx
  on public.payments (status, created_at desc);

-- Service role only. Payment records are read through the app by a Senior of
-- that workspace and by platform admins, both of which go through routes
-- that check first; no policy is granted, so nothing else can reach them.
alter table public.payments enable row level security;

comment on table public.payments is
  'Every Paystack payment attempt. Written only by the billing routes via the '
  'service role. `reference` is unique so a retried webhook cannot be applied '
  'twice. Access is never granted from a browser callback — only from a '
  'signature-verified webhook that was then re-verified against Paystack.';

comment on column public.tenants.paid_until is
  'Paid up to this instant. Null means not on paid billing — the billing cron '
  'skips those workspaces entirely.';
