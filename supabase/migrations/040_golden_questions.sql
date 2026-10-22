-- Questions whose correct answer is known, so correctness can be measured
-- instead of inferred.
--
-- Purely additive: one table. Nothing is dropped, renamed or deleted, and
-- no existing row's data changes.
--
-- Why this is the first thing. The existing regression suite scores an
-- answer on two tests — confidence above a generated threshold, and at
-- least one citation — and stores no expected answer anywhere. A
-- confidently wrong figure with a citation attached passes it. Its
-- questions are also generated from the facts we extracted, so a misread
-- value becomes a test built on the misreading, which the system then
-- passes by repeating it. And because answer confidence now routinely
-- scores 80-99 against thresholds generated in the 25-60 range, its pass
-- rate has risen with no change in correctness behind it.
--
-- Every improvement made to this pipeline so far was verified by a person
-- opening the source document and counting. That does not scale and it is
-- not a property of the product. A stored expected answer, checked once
-- against a named page, is.
--
-- expected_kind decides how the answer is graded:
--   'figure' — one number. expected_value is {"value": 793, "tolerance": 0}.
--   'set'    — a set of values that must all appear.
--              expected_value is {"members": ["Ashanti", "117"]}.
--   'absent' — the documents genuinely do not contain this; a correct
--              answer says so rather than producing a figure.
--   'claim'  — a prose statement. expected_value is
--              {"must_include": ["Responsible AI Authority"]}.

create table if not exists public.golden_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Which document the answer can be checked in, and on which page. Null
  -- document for a question deliberately about the whole knowledge base.
  document_id uuid references public.documents(id) on delete set null,
  source_page integer,
  question text not null,
  -- The answer in words, as a person would write it. Kept for review: a
  -- grader compares against expected_value, a human reads this.
  expected_answer text not null,
  expected_kind text not null check (expected_kind in ('figure', 'set', 'absent', 'claim')),
  expected_value jsonb not null default '{}'::jsonb,
  -- Who checked it against the source, and when. An unverified row is a
  -- guess wearing the authority of a test.
  verified_by text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists golden_questions_tenant_idx
  on public.golden_questions (tenant_id);

alter table public.golden_questions enable row level security;

-- Read-only to a workspace's own Senior users; written by the service role.
-- A tenant must be able to see what their system is being graded against,
-- or the grade means nothing to them.
create policy "golden_questions_select" on public.golden_questions
  for select using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = golden_questions.tenant_id
        and m.user_id = auth.uid()
    )
  );

comment on table public.golden_questions is
  'Questions with a verified expected answer and the page it can be checked on. The basis for measuring answer correctness and confidence calibration — see ACCURACY_LOOP_PROMPT.md section 1.';
