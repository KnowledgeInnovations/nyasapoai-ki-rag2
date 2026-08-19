-- 030_enable_rls_facts_tables
--
-- financial_facts (007) and document_facts (018) were both created without
-- `enable row level security` — the only two tenant-scoped tables in the
-- whole schema missing it (every other table added since explicitly
-- enables RLS, several with a comment noting "no policies = default deny"
-- for service-only tables). Supabase/PostgREST grants default
-- select/insert/update/delete on every public-schema table to the anon/
-- authenticated roles unless RLS says otherwise, so with RLS off any
-- authenticated user of ANY tenant could read — and write — every other
-- tenant's extracted financial figures and document facts directly via the
-- Supabase REST API, completely bypassing the app's own tenant_id
-- filtering (which only applies to requests that go through the Next.js
-- routes). Since these rows are fed to the AI as "VALIDATED FACTS...use
-- these exact values", a write also means poisoning another tenant's
-- answers with fabricated figures, not just a read leak.
--
-- Select-only policy, same pattern as self_assessments (009) and
-- fact_resolutions (022) — the app only ever writes these tables via the
-- service-role client (which bypasses RLS entirely), so no insert/update/
-- delete policy is needed; enabling RLS with no matching policy for those
-- operations makes them default-deny for the anon/authenticated roles,
-- closing the write-poisoning vector too.

alter table public.financial_facts enable row level security;

create policy "financial_facts_tenant_read" on public.financial_facts
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = financial_facts.tenant_id
    )
  );

alter table public.document_facts enable row level security;

create policy "document_facts_tenant_read" on public.document_facts
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = document_facts.tenant_id
    )
  );
