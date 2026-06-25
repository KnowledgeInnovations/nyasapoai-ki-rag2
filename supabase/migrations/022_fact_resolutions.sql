-- 022_fact_resolutions
--
-- The system's own persistent reasoning memory. Every other piece of
-- "intelligence" in this app is a stateless Claude API call — nothing is
-- remembered between requests, so the agentic loop re-derives the same
-- conflict resolution from scratch every time the same question comes up
-- (e.g. "which of these two conflicting Ministry of Education 2009 figures
-- is right"). This table is where a resolution, once reasoned through,
-- becomes the SYSTEM's own knowledge instead of being re-rented from
-- Anthropic on every call.
--
-- resolution_pattern is a closed enum, not free text, on purpose — a
-- structured pattern can be safely counted and generalized into a
-- deterministic rule (see applyLearnedHeuristics in factExtraction.ts);
-- free-text reasoning can't be safely promoted into code without an LLM
-- re-interpreting it, which would reintroduce the exact "re-reason every
-- time" problem this table exists to remove.

create table if not exists public.fact_resolutions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  entity                  text not null,
  entity_type             text not null check (entity_type in ('national', 'ministry', 'sector')),
  metric                  text not null,
  fiscal_year             text not null,
  resolved_value_millions numeric not null,
  unit                    text,
  resolution_pattern      text not null check (resolution_pattern in (
    'prefer_corroborated_over_flagged', 'prefer_actual_over_projection',
    'prefer_higher_confidence', 'other'
  )),
  reasoning               text not null,
  confidence              integer not null check (confidence between 0 and 100),
  source_fact_ids         uuid[] not null default '{}',
  resolved_at             timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  use_count               integer not null default 0,
  unique (tenant_id, entity, entity_type, metric, fiscal_year)
);

create index if not exists fact_resolutions_pattern_idx
  on public.fact_resolutions (tenant_id, resolution_pattern);

alter table public.fact_resolutions enable row level security;

create policy "fact_resolutions_tenant_read" on public.fact_resolutions
  for select using (tenant_id = (select tenant_id from public.memberships where user_id = auth.uid() limit 1));
