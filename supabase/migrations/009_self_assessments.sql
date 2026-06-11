-- 009_self_assessments
--
-- Stores results of self-assessment runs: auto-generated test questions
-- (from financial_facts ground truth) replayed through the chat pipeline,
-- scored for numeric accuracy, and aggregated into an accuracy/confidence
-- score shown on the Training page.

create table public.self_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_by uuid references auth.users(id) on delete set null,
  document_id uuid references public.documents(id) on delete cascade,
  total_questions int not null,
  passed int not null,
  accuracy numeric(5,2) not null,
  avg_confidence numeric(5,2) not null,
  results jsonb not null default '[]',
  created_at timestamptz default now()
);

create index on public.self_assessments (tenant_id, document_id, created_at desc);

alter table public.self_assessments enable row level security;

create policy "self_assessments_select" on public.self_assessments
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = self_assessments.tenant_id
    )
  );
