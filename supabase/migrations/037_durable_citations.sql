-- Stop document maintenance from destroying the citations of past answers.
--
-- Two references made a citation depend on rows that routine maintenance
-- deletes:
--
--   document_chunk_id ... on delete cascade
--     Training deletes a document's chunks and rebuilds them, so every
--     retrain cascade-deleted every citation of every answer that had ever
--     cited that document. Measured on live data: a five-turn conversation
--     whose answers carry 18 distinct [n] markers held zero citation rows,
--     because its two documents were retrained half an hour after the
--     answers were given. The answers still show their markers, with
--     nothing behind them.
--
--   document_id ... on delete set null
--     Deleting a document left 117 fact citations (33% of all citations)
--     pointing at nothing openable at all.
--
-- A citation is a record of what an answer was based on at the time it was
-- given. It must not be editable — or erasable — by later work on the
-- document. So the chunk reference becomes advisory rather than
-- load-bearing, and the citation keeps its own copy of what it quoted.
-- After a retrain, a citation degrades from "this exact excerpt" to "this
-- document, this page, this text" — still checkable, which is the whole
-- point of a citation — instead of disappearing.
--
-- Nothing is deleted by this migration. One constraint is relaxed, one
-- column is added, and existing rows are filled in from the chunks they
-- still resolve to.

-- 1. The chunk reference stops being load-bearing.
alter table public.citations
  drop constraint if exists citations_document_chunk_id_fkey;

alter table public.citations
  add constraint citations_document_chunk_id_fkey
  foreign key (document_chunk_id)
  references public.document_chunks(id)
  on delete set null;

-- 2. The citation's own copy of the quoted text, so it survives the chunk.
alter table public.citations
  add column if not exists cited_text text;

comment on column public.citations.cited_text is
  'Snapshot of the excerpt this citation quoted, kept so the citation stays checkable after the chunk is replaced by a retrain. Display prefers the live chunk when it still exists.';

-- 3. Fill in every citation whose chunk still resolves, so today's rows get
--    the same durability as new ones.
update public.citations c
set cited_text     = coalesce(c.cited_text, dc.chunk_text),
    document_id    = coalesce(c.document_id, dc.document_id),
    page_number    = coalesce(c.page_number, (dc.metadata->>'page_number')::int),
    section_title  = coalesce(c.section_title, dc.metadata->>'section_title')
from public.document_chunks dc
where c.document_chunk_id = dc.id;
