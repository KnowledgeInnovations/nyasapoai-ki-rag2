-- 021_auto_reprocess_log
--
-- Self-improvement Phase 2: tracks which (document, recurring-gap-topic)
-- pairs have already had an automatic re-extraction attempt, so the
-- auto-reprocess trigger never retries the same pair more than once. If a
-- document still fails its regression question after one re-extraction,
-- the root cause isn't stale extraction (which re-running fixes) — it's
-- something a human needs to look at, and retrying again would just waste
-- AI calls in a loop with no chance of a different outcome.

create table if not exists public.auto_reprocess_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  gap_topic    text not null,
  triggered_at timestamptz not null default now(),
  result       text not null check (result in ('improved', 'unchanged', 'error')),
  detail       text
);

create unique index if not exists auto_reprocess_log_doc_topic_idx
  on public.auto_reprocess_log (document_id, gap_topic);

alter table public.auto_reprocess_log enable row level security;

create policy "auto_reprocess_log_tenant_read" on public.auto_reprocess_log
  for select using (tenant_id = (select tenant_id from public.memberships where user_id = auth.uid() limit 1));
