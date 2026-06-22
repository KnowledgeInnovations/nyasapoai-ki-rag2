-- Surfaces processing outcomes that today only exist in server console.error
-- logs: a "ready" document gives no signal if an AI-enhancement step
-- (table cleaning, AI table facts, generic-fact fallback, cross-document
-- corroboration) silently failed and continued with partial data, and a
-- fatal training error never persisted a reason a tenant admin could see.

alter table public.documents
  add column if not exists status_detail text,
  add column if not exists processing_warnings jsonb not null default '[]'::jsonb;

comment on column public.documents.status_detail is
  'Human-readable reason for the most recent failure, or a degraded-run summary (e.g. "2 of 5 steps degraded"). Null when the last run was fully clean.';
comment on column public.documents.processing_warnings is
  'Array of {step, message, at} objects, one per degraded step in the most recent training run. Overwritten (not appended) on each run.';
