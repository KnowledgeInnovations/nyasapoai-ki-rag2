-- What each plan costs.
--
-- Until now nothing anywhere held a price: the pricing page listed three
-- tiers and what they include, and said nothing about money. Setting one
-- meant editing the marketing page and deploying, which is not a thing a
-- price should need.
--
-- Purely additive: one table, seeded with the three plans. No column is
-- dropped or renamed and no existing row's data changes.

create table if not exists public.plan_prices (
  plan       text primary key check (plan in ('starter', 'professional', 'enterprise')),
  -- Null means "no published price" — the page then says to get in touch
  -- rather than showing a confident zero, which is the one wrong answer.
  amount     numeric(12,2),
  currency   text not null default 'GHS',
  period     text not null default 'month' check (period in ('month', 'year')),
  -- Shown under the amount: "per workspace", "per user", whatever the
  -- commercial model turns out to be. Free text because that decision is
  -- not the database's to constrain.
  unit       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

-- One row per plan, always present, so reading a price never has to deal
-- with a missing row and the admin screen always has three things to edit.
insert into public.plan_prices (plan, amount, currency, period, unit)
values
  ('starter',      null, 'GHS', 'month', 'per workspace'),
  ('professional', null, 'GHS', 'month', 'per workspace'),
  ('enterprise',   null, 'GHS', 'month', 'per workspace')
on conflict (plan) do nothing;

alter table public.plan_prices enable row level security;

-- A price list is public by definition — the marketing pricing page is read
-- by people who are not signed in. Writes are service-role only, through
-- /api/plan-prices, which checks for a platform admin.
drop policy if exists "plan_prices_public_read" on public.plan_prices;
create policy "plan_prices_public_read" on public.plan_prices
  for select using (true);

comment on table public.plan_prices is
  'Published price per plan. Readable by anyone (the pricing page is public); '
  'written only by platform admins via /api/plan-prices. A null amount means '
  'no published price, which the pricing page renders as "Talk to us".';
