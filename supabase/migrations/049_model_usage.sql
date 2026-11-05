-- Real token usage, and what it costs.
--
-- Until now nothing recorded what the models were actually used for. The
-- figure on /admin/tenants was a model-based estimate — a flat assumption
-- per question and per document — which is fine for a rough budget and no
-- use at all for reconciling against an Anthropic or OpenAI invoice.
--
-- Two tables:
--
--   model_usage   one row per API call, with the token counts the provider
--                 itself reported. This is the measurement.
--   model_prices  the rate card. Separate because rates are a commercial
--                 fact that changes without the code changing, and because
--                 only the account holder knows the rates they are actually
--                 charged.
--
-- Cost is stored on the usage row rather than computed at read time. A rate
-- change must not silently rewrite last month's bill, and that is exactly
-- what joining to a mutable price table at read time would do.
--
-- Purely additive. No existing table, column or row is altered.

create table if not exists public.model_usage (
  id                 bigserial primary key,

  -- Nullable, and ON DELETE SET NULL rather than CASCADE. Deleting a
  -- workspace must not erase the money already spent on its behalf, or the
  -- platform total silently shrinks and stops matching the invoice. Such
  -- rows become unattributed, which is the truth: the spend happened, the
  -- workspace it belonged to is gone.
  tenant_id          uuid references public.tenants(id) on delete set null,
  user_id            uuid references public.users(id)   on delete set null,

  -- Snapshot of the workspace name at the time of the call, so a report
  -- covering a deleted workspace can still say whose spend it was.
  tenant_label       text,

  provider           text not null check (provider in ('anthropic', 'openai')),
  model              text not null,

  -- What the call was for: 'chat', 'agentic', 'rerank', 'embed', 'extract',
  -- 'verify', 'insight', 'vision', 'profile', 'heuristics', 'assessment',
  -- 'search'. Free text rather than an enum: a new pipeline stage should not
  -- need a migration, and an unknown value groups as itself rather than
  -- failing a constraint mid-request.
  operation          text not null,

  input_tokens       integer not null default 0 check (input_tokens       >= 0),
  output_tokens      integer not null default 0 check (output_tokens      >= 0),
  -- Anthropic prices prompt-cache writes and reads differently from ordinary
  -- input, so they are counted separately or the cost is wrong in both
  -- directions. Zero for providers that do not report them.
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens  >= 0),

  -- Null means "the rate card had no price for this model at the time".
  -- That is not zero: zero would quietly understate the bill. A null shows
  -- up on the page as unpriced, with the tokens still counted.
  cost_usd           numeric(14,8),

  created_at         timestamptz not null default now()
);

-- The three ways this gets read: one workspace over a window, the whole
-- platform over a window, and a breakdown by model.
create index if not exists model_usage_tenant_time_idx on public.model_usage (tenant_id, created_at desc);
create index if not exists model_usage_time_idx        on public.model_usage (created_at desc);
create index if not exists model_usage_model_time_idx  on public.model_usage (model, created_at desc);

alter table public.model_usage enable row level security;

-- No policy is created deliberately: with RLS on and no policy, the
-- anon and authenticated roles can read nothing at all. Every read goes
-- through the service role in a route that has already checked for a
-- platform admin. Per-workspace spend is commercial information about other
-- customers, so a tenant must not be able to reach it even accidentally.

-- ── the rate card ────────────────────────────────────────────
create table if not exists public.model_prices (
  model                    text primary key,
  provider                 text not null check (provider in ('anthropic', 'openai')),

  -- US dollars per million tokens, which is how both providers publish.
  -- All four are nullable and all four are seeded null ON PURPOSE: inventing
  -- a rate would put a confident, wrong number in front of someone
  -- reconciling an invoice. Unpriced is visible; wrong is not.
  input_usd_per_mtok       numeric(12,4),
  output_usd_per_mtok      numeric(12,4),
  cache_write_usd_per_mtok numeric(12,4),
  cache_read_usd_per_mtok  numeric(12,4),

  -- Null until someone has actually checked these against a real invoice.
  -- The page uses this to say whether the figures are confirmed or guesses.
  confirmed_at             timestamptz,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.users(id) on delete set null
);

-- One row per model the code can currently reach, so the admin screen always
-- has something to edit and an unpriced call is visibly unpriced rather than
-- missing. Includes the Claude 5 ids as well as the 4-series in use today,
-- so upgrading the model constants does not start producing unpriced rows.
insert into public.model_prices (model, provider) values
  ('claude-opus-4-8',        'anthropic'),
  ('claude-sonnet-4-6',      'anthropic'),
  ('claude-opus-5-5',        'anthropic'),
  ('claude-sonnet-5-5',      'anthropic'),
  ('claude-haiku-5-5',       'anthropic'),
  ('gpt-4o-mini',            'openai'),
  ('text-embedding-3-small', 'openai')
on conflict (model) do nothing;

alter table public.model_prices enable row level security;

-- Same reasoning as model_usage: service-role only, through a route that
-- checks for a platform admin. A rate card is not public here — unlike
-- plan_prices, which the marketing page shows to anyone.
