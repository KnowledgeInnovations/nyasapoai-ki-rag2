-- 007_financial_facts
--
-- Structured financial facts extracted at ingestion time from document
-- chunks. Each row is a single (year, entity, metric, value) data point
-- with provenance (document/chunk/page) and a confidence score, used by
-- the chat route to ground fact_lookup/trend/comparison/forecast answers
-- in validated numbers instead of relying purely on raw chunk prose.

create table if not exists public.financial_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  fiscal_year text,
  entity text,
  entity_type text,
  metric text,
  value numeric not null,
  unit text not null,
  value_millions numeric,
  page_number int,
  section_title text,
  is_table boolean default false,
  confidence numeric(5,2) not null,
  flags text[] default '{}',
  created_at timestamptz default now()
);

create index if not exists financial_facts_lookup_idx
  on public.financial_facts (tenant_id, fiscal_year, entity_type, metric);

create index if not exists financial_facts_document_idx
  on public.financial_facts (document_id);
