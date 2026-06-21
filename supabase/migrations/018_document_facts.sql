-- 018_document_facts
--
-- Generic, domain-agnostic counterpart to financial_facts (007). The budget
-- pipeline (factExtraction.ts) only recognizes fiscal aggregates — it's
-- useless on a contract, HR policy, or technical spec. This table lets any
-- document type get a structured, citable fact layer: a flexible
-- subject/attribute/value shape instead of financial_facts' fiscal-year/
-- entity_type/metric columns, populated by genericFactExtraction.ts when a
-- document's budget-specific extraction yields little/nothing (a signal
-- that it isn't a budget statement).

create table public.document_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  category text,
  subject text,
  attribute text,
  value_text text not null,
  value_number numeric,
  value_date date,
  unit text,
  page_number int,
  section_title text,
  confidence numeric(5,2) not null,
  flags text[] default '{}',
  extraction_method text not null default 'ai',
  created_at timestamptz default now()
);

create index document_facts_lookup_idx
  on public.document_facts (tenant_id, category, attribute);

create index document_facts_document_idx
  on public.document_facts (document_id);
