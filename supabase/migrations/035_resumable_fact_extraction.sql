-- Make generic fact extraction resumable, so a large document converges
-- instead of failing at the same place on every attempt.
--
-- Purely additive: adds one column and one index. Nothing is dropped,
-- renamed or deleted, and no existing row's data changes.
--
-- The problem this solves. Fact extraction is the last stage of training and
-- shares one wall-clock budget with PDF extraction, chunking and embedding.
-- On a large document the earlier stages consume most of that budget, so the
-- per-call allowance shrinks toward zero and every remaining batch aborts.
-- Retraining does not help, because retraining deletes the chunks and starts
-- again from the beginning — re-paying for extraction, chunking and
-- embedding before reaching facts, and then running out in the same place.
-- Observed on a 40-page, 58-chunk station register: 45 of 58 excerpts were
-- never checked for facts, and the document held zero facts after repeated
-- attempts.
--
-- With a per-chunk marker, a facts-only pass can process just the chunks
-- that have not been done yet and record its progress. Successive passes —
-- whether triggered by an administrator or by the existing auto-reprocess
-- cron — then make cumulative progress and the document completes.
--
-- NULL means "not yet checked for facts", which is the correct state for
-- every chunk that exists today: none of them carry this marker, and any
-- that were in fact processed will simply be re-checked once, harmlessly.

alter table public.document_chunks
  add column if not exists facts_extracted_at timestamptz;

-- The queue query is "chunks of this document still awaiting fact
-- extraction". A partial index keeps it cheap as the table grows, since
-- processed rows leave the index entirely.
create index if not exists document_chunks_pending_facts_idx
  on public.document_chunks (document_id)
  where facts_extracted_at is null;

comment on column public.document_chunks.facts_extracted_at is
  'When this chunk was last checked for generic facts. NULL means still pending, which is what the resumable facts-only pass queues on.';
