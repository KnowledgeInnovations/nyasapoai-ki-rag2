-- 031_dashboard_themes_and_pins
--
-- Backs the new single, self-organizing dashboard (replacing the 8 fixed
-- department dashboards, which assumed every tenant maps onto Sales/
-- Marketing/HR/Finance/Executive/Development/Client-Service/Communications —
-- confirmed live that most tenants don't cleanly fit that template).
--
-- dashboard_themes_cache: the AI-discovered theme set (grouped insight
-- questions derived from THIS tenant's own document inventory/facts) is
-- expensive to regenerate on every page load, so it's cached per tenant and
-- only refreshed on demand or when stale.
--
-- dashboard_pinned_insights: lets a user ask an ad-hoc question on the
-- dashboard and pin the answer as a persistent card, shared with the whole
-- tenant (not just that browser) — the dashboard becomes something people
-- actively shape rather than a fixed template nobody customizes.
--
-- Same RLS pattern as financial_facts/document_facts (030) — the app writes
-- both tables via the service-role client (bypasses RLS), so only a
-- select policy is needed; enabling RLS with no insert/update/delete policy
-- makes those default-deny for anon/authenticated, closing the same
-- direct-REST-API cross-tenant read/write vector that motivated 030.

create table public.dashboard_themes_cache (
  tenant_id    uuid primary key references public.tenants(id) on delete cascade,
  themes       jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.dashboard_themes_cache enable row level security;

create policy "dashboard_themes_cache_tenant_read" on public.dashboard_themes_cache
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = dashboard_themes_cache.tenant_id
    )
  );

create table public.dashboard_pinned_insights (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  question   text not null,
  insight    text not null,
  sentiment  text not null default 'neutral',
  sources    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index dashboard_pinned_insights_tenant_idx on public.dashboard_pinned_insights(tenant_id, created_at desc);

alter table public.dashboard_pinned_insights enable row level security;

create policy "dashboard_pinned_insights_tenant_read" on public.dashboard_pinned_insights
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = dashboard_pinned_insights.tenant_id
    )
  );
