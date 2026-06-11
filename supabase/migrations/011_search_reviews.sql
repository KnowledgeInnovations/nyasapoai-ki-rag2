-- 011_search_reviews
--
-- Records a correctness verdict for a manual document-search question
-- (Training page "Document Search"). Each row is one judgment —
-- "Direct Answer / excerpts were correct" or "incorrect / missing" — for a
-- given question, automatically produced by an AI grading pass over the
-- Direct Answer facts and verbatim excerpts (no AI-generated answer text
-- involved). The Training page aggregates these into an overall (and
-- per-document) performance percentage.

create table public.search_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reviewed_by uuid references auth.users(id) on delete set null,
  document_id uuid references public.documents(id) on delete cascade, -- null = whole knowledge base
  question text not null,
  verdict text not null check (verdict in ('correct', 'incorrect')),
  reasoning text,
  reviewer text not null default 'ai' check (reviewer in ('ai', 'manual')),
  created_at timestamptz default now()
);

create index on public.search_reviews (tenant_id, document_id, created_at desc);

alter table public.search_reviews enable row level security;

create policy "search_reviews_select" on public.search_reviews
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = search_reviews.tenant_id
    )
  );
