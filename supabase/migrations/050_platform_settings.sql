-- Platform-wide switches, changeable without a deploy.
--
-- Written for one need: an owner must be able to stop the AI models from
-- running — all of them, immediately, across every workspace — while they
-- decide which model to use. An environment variable cannot do that; it
-- needs a redeploy, which is the wrong tool for something you want to flip
-- during a conversation and flip back twenty minutes later.
--
-- Deliberately a key/value table rather than a column per switch. The next
-- switch should be a row, not a migration.
--
-- Purely additive. No existing table, column or row is altered.

create table if not exists public.platform_settings (
  key        text primary key,
  -- jsonb rather than boolean: the next setting will not be a boolean, and
  -- a value column that has to be widened later is a migration nobody
  -- wants to write against live rows.
  value      jsonb not null,
  -- Why it was changed, in the words of whoever changed it. A kill switch
  -- found in the off position three days later with no explanation costs
  -- more time than the switch saves.
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

comment on table public.platform_settings is
  'Platform-wide operational switches, read at request time. Service-role only: these govern every tenant, so no tenant may read or write them.';
comment on column public.platform_settings.value is
  'JSON value. For the ai_*_enabled keys: true or false.';
comment on column public.platform_settings.note is
  'Free-text reason recorded when the value last changed.';

-- The two switches, both ON.
--
-- Seeding them ON matters more than it looks. The readers treat a missing
-- row and an unreachable database as ON, so that a Supabase blip can never
-- silently disable the product for every customer at once. The failure
-- direction is deliberate: an outage that leaves the models running costs
-- money, an outage that stops them costs the product. If the switch must be
-- off, it is off because a row says so.
insert into public.platform_settings (key, value, note) values
  ('ai_training_enabled', 'true'::jsonb, 'Default. Document processing — reading uploads, extracting facts, embeddings.'),
  ('ai_chat_enabled',     'true'::jsonb, 'Default. Answering questions — chat, search, dashboard insights.')
on conflict (key) do nothing;

-- RLS on with no policy: the service role bypasses RLS, everyone else gets
-- nothing. Same posture as model_prices — this is platform configuration,
-- not tenant data, and a tenant reading it would learn about other tenants'
-- service state.
alter table public.platform_settings enable row level security;
