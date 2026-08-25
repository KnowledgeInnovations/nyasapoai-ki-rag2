-- 032_document_auto_reprocess_tracking
--
-- Stage 3 of the extraction-completeness work: today, a document that
-- finishes training with processing_warnings (a degraded run — hit a
-- transient network error, exceeded its time budget mid-extraction, etc.)
-- just sits there until an admin happens to notice the "degraded" badge in
-- the documents list and clicks Retry. Most of these warnings genuinely
-- ARE transient (confirmed repeatedly this session) and would clear on a
-- simple re-run — there's no reason that has to be a human action.
--
-- These two columns let a scheduled job (api/cron/auto-reprocess-documents)
-- find degraded documents and retry them automatically, while capping how
-- many times any single document gets auto-retried — if it's still
-- degraded after a few attempts, the cause isn't a transient blip (which
-- retrying fixes) but something a human needs to look at, and retrying
-- forever would just waste API calls in a loop with no chance of a
-- different outcome. Mirrors the same "retry-until-a-cap-then-stop-and-
-- surface-it" philosophy already used for auto_reprocess_log (021).

alter table public.documents
  add column if not exists auto_reprocess_count int not null default 0,
  add column if not exists last_auto_reprocess_at timestamptz;

comment on column public.documents.auto_reprocess_count is
  'How many times the scheduled auto-heal job has automatically retried this document after it finished with processing_warnings. The job caps this (see api/cron/auto-reprocess-documents) so a document with a genuinely unrecoverable problem (corrupt file, password-protected, etc.) does not get retried forever.';
comment on column public.documents.last_auto_reprocess_at is
  'When the auto-heal job last retried this document — enforces a cooldown between attempts so a document is not hammered repeatedly within the same or adjacent cron runs.';
