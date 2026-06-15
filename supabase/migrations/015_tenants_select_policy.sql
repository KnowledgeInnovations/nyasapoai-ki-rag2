-- tenants has RLS enabled but no SELECT policy, so getTenant() (run as the
-- logged-in user) always returned 0 rows — tenant name/is_platform always
-- fell back to defaults. Let members read their own tenant row.
create policy "tenants_read_own" on public.tenants
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = tenants.id
    )
  );
