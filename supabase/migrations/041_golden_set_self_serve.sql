-- Lets a workspace manage and run its own golden set, instead of someone
-- with database access doing it for them.
--
-- Purely additive: policies and one table. Nothing is dropped, renamed or
-- deleted, and no existing row's data changes.
--
-- Why it matters that the workspace does this. The answers have to be
-- checked by somebody who knows the documents, and the only such people
-- are in the workspace. A suite built from our own extractions and never
-- confirmed by a human tests that we faithfully repeat what we extracted,
-- including the mistakes — which is exactly the trap the older
-- self-assessment suite fell into. Hence `verified_by`: a question that
-- nobody has confirmed is a draft, and drafts are excluded from the
-- accuracy figure.

-- Senior users manage their own workspace's questions. Reads were already
-- allowed to every member (migration 040) so a team can see what their
-- system is being graded against.
create policy "golden_questions_insert" on public.golden_questions
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = golden_questions.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'senior'
    )
  );

create policy "golden_questions_update" on public.golden_questions
  for update using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = golden_questions.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'senior'
    )
  );

create policy "golden_questions_delete" on public.golden_questions
  for delete using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = golden_questions.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'senior'
    )
  );

-- What a run found, kept so accuracy can be compared over time rather than
-- read once and forgotten. A single number means little; the same number
-- next to last month's is the whole point.
create table if not exists public.golden_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ran_by uuid references auth.users(id) on delete set null,
  -- Only verified questions are counted, so this says how many of them
  -- there were at the time.
  questions integer not null,
  correct integer not null,
  -- Per-question outcomes and the confidence bands, as the run reported
  -- them. Stored whole because the interesting part of a regression is
  -- which question changed, not that the total moved.
  results jsonb not null default '[]'::jsonb,
  calibration jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists golden_runs_tenant_idx
  on public.golden_runs (tenant_id, created_at desc);

alter table public.golden_runs enable row level security;

create policy "golden_runs_select" on public.golden_runs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = golden_runs.tenant_id
        and m.user_id = auth.uid()
    )
  );

comment on table public.golden_runs is
  'Accuracy and calibration from each run of a workspace''s golden set. Written by the server; readable by that workspace. See ACCURACY_LOOP_PROMPT.md section 1.';
