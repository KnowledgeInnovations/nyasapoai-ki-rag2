-- 017_fact_citations
--
-- factCitations (chat/route.ts) — synthetic [n] citations for VALIDATED
-- FACTS rows used in analysis blocks (cumulative/ranking/proportion/trend/
-- deviation/forecast, and the per-row VALIDATED FACTS table) — were only
-- ever sent in the live SSE response, never persisted. In a fact-heavy
-- answer these citations are commonly the MAJORITY of the [n] markers in
-- the prose (e.g. [11] through [43] in a "budget for every year" answer
-- that has 10 chunk citations [1]-[10]). Once a conversation is reopened
-- from history, GET /api/chat?citations= only ever returns chunk-backed
-- rows, so every fact citation number renders as dead, unresolvable text.
--
-- Adds nullable columns so a fact citation can be stored without a real
-- document_chunk_id, carrying its own synthetic label/page/section instead
-- of a joined chunk_text.

alter table public.citations
  alter column document_chunk_id drop not null,
  add column document_id uuid references public.documents(id) on delete set null,
  add column fact_label text,
  add column page_number integer,
  add column section_title text;
