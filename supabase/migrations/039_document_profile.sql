-- Caches what shape a document has, so every later stage can adapt to the
-- document instead of assuming the layout we happened to build for.
--
-- Purely additive: one column. Nothing is dropped, renamed or deleted, and
-- no existing row's data changes. NULL means "not profiled", which is the
-- correct state for every document that exists today, and every stage that
-- reads it falls back to its previous rule-based behaviour.
--
-- What it holds. The document's own column and field headings, verbatim;
-- whether it is a set of repeating records, continuous prose, a form, or
-- both; what one record is about; and real examples of its headings.
--
-- Why it earns a column. Extraction named attributes one model call at a
-- time, so a single column arrived under many names. Measured on six
-- excerpts of a station register: 18 distinct attribute names for its 8
-- real columns, including five different names for the authorisation date
-- alone — which makes counting across the document a matter of guessing
-- which names mean the same thing, and caps how confident any answer can
-- honestly be. Handed the document's own headings, the same six excerpts
-- produced 9 names, and 27% more facts.
--
-- Cached because it costs one model call and does not change unless the
-- file does.

alter table public.documents
  add column if not exists extraction_profile jsonb;

comment on column public.documents.extraction_profile is
  'What shape this document has, from documentProfile.ts: its own column/field headings, whether it holds repeating records or prose, and examples of its headings. Used as the controlled vocabulary for fact extraction and to adapt chunking. NULL means not yet profiled.';
