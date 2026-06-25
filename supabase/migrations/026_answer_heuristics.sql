-- 026_answer_heuristics
--
-- Self-improvement, phase 3: closes the loop for regression-suite failures
-- that phase 2 (auto_reprocess_log / runAutoReprocess) can't touch — gaps
-- like "currency_boundary" and "insufficiency" aren't a stale-extraction
-- problem (there's no document to re-extract), they're an answer-time
-- hedging gap. This table is where a candidate prompt instruction, once
-- generated and verified against the FULL regression suite with zero
-- regressions introduced, becomes a permanent, hot-reloaded addition to the
-- chat system prompt — analogous to fact_resolutions/applyLearnedHeuristics,
-- but for answering behavior instead of extraction.
--
-- status is the safety gate: a row only affects live answers once it's
-- 'confirmed' (set exclusively by runAutoPromptFix after the candidate
-- passed the whole suite, not just the category it targets). 'candidate'/
-- 'rejected' rows are kept for visibility into what was tried and why it
-- wasn't promoted, never read by the chat route.

create table if not exists public.answer_heuristics (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  category        text not null,
  instruction     text not null,
  status          text not null check (status in ('candidate', 'confirmed', 'rejected')) default 'candidate',
  source_reason   text not null,
  test_detail     text,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  unique (tenant_id, category)
);

create index if not exists answer_heuristics_confirmed_idx
  on public.answer_heuristics (tenant_id) where status = 'confirmed';

alter table public.answer_heuristics enable row level security;

create policy "answer_heuristics_tenant_read" on public.answer_heuristics
  for select using (tenant_id = (select tenant_id from public.memberships where user_id = auth.uid() limit 1));
