-- 008_financial_facts_extraction_method
--
-- Distinguishes Phase 1 regex-derived facts ('regex') from Phase 2
-- table-derived facts ('table'). Lets re-runs of either extraction method
-- delete-and-replace only their own rows per document, and lets the chat
-- route / sanity checks treat table-sourced national aggregates as
-- inherently more reliable than prose-derived ones.

alter table public.financial_facts
  add column if not exists extraction_method text not null default 'regex';
