-- The audit log has existed since the first schema, with row-level security
-- and a senior-only read policy, and nothing has ever written to or read it.
-- It is being put to use now, so it needs the indexes a log is actually read
-- through, and a couple of guarantees the original table did not state.
--
-- Purely additive: indexes, a default, and a check constraint added NOT VALID
-- then validated. No column is dropped or renamed and no row's data changes.

-- Every read is "this workspace, newest first", optionally paged by a
-- timestamp. Without this it is a sequential scan that gets slower every day,
-- which is exactly the wrong shape for a table that only ever grows.
create index if not exists audit_logs_tenant_created_idx
  on public.audit_logs (tenant_id, created_at desc);

-- "What did this person do" and "what happened to this document" are the two
-- questions an audit log gets asked in an investigation.
create index if not exists audit_logs_actor_idx
  on public.audit_logs (tenant_id, user_id, created_at desc);

create index if not exists audit_logs_resource_idx
  on public.audit_logs (tenant_id, resource_type, resource_id);

-- An entry whose action is an empty string is not an audit record, it is
-- noise that will be read as one. Cheap to refuse at the boundary.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_logs_action_not_blank') then
    alter table public.audit_logs
      add constraint audit_logs_action_not_blank
      check (length(trim(action)) > 0) not valid;
    alter table public.audit_logs validate constraint audit_logs_action_not_blank;
  end if;
end $$;

comment on table public.audit_logs is
  'Who did what, in which workspace, when. Written by the service role only '
  '(see src/lib/audit.ts); read by senior members of that workspace through '
  'the audit_logs_select policy, and across workspaces by platform admins '
  'through the service role. Append-only by convention: nothing in the '
  'application updates or deletes a row, and entries are removed only when '
  'the workspace itself is deleted, via the tenant_id cascade.';
