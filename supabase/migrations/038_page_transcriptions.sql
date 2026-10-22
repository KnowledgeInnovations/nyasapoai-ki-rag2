-- Keeps the page transcriptions a scanned document needed, so reading it
-- is work done once rather than work repeated.
--
-- Purely additive: one table and one column. Nothing is dropped, renamed
-- or deleted, and no existing row's data changes.
--
-- The problem. A document that is a photograph of paper has no text to
-- extract, so each page has to be read as an image. That costs about ten
-- seconds a page, which means a single pass budget reaches perhaps a third
-- of a 26-page volume — and because extraction starts from the file every
-- time, the next attempt re-read the same first pages and reached the same
-- place. A scanned document could therefore never finish, however many
-- times it was trained.
--
-- With the transcriptions stored, each attempt begins with every page
-- already read and spends its whole budget on the pages still outstanding,
-- so the document converges. unread_pages on the document row is what the
-- Training page needs to offer "continue" rather than "retrain", and to say
-- how much is left.

create table if not exists public.document_page_text (
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null,
  text text not null,
  -- How this page was read. 'vision' means the page image was transcribed
  -- because the page carried no text layer; recorded so a reader knows the
  -- text is a transcription rather than the publisher's own.
  method text not null default 'vision',
  created_at timestamptz not null default now(),
  primary key (document_id, page_number)
);

alter table public.document_page_text enable row level security;

-- No policies: this is written and read only by the server's service role,
-- in the same way as the fact tables (migration 030). A tenant never
-- queries it directly — the text reaches them as chunks and citations.

comment on table public.document_page_text is
  'Transcriptions of pages that carried no extractable text, kept so repeated training does not re-read the same pages and a scanned document can converge.';

alter table public.documents
  add column if not exists unread_pages integer;

comment on column public.documents.unread_pages is
  'Pages that still hold no readable text after the last training pass. Above zero means training should be continued to read them; NULL means never assessed.';
