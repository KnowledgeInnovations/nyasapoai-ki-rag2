-- 051_enforce_document_sensitivity
--
-- SECURITY FIX. documents.sensitivity ('public' | 'internal' | 'confidential'
-- | 'restricted') was a label with no teeth: the documents_select and
-- chunks_select RLS policies gated on tenant membership ONLY, so any member —
-- including a Junior — could read a document (and its chunks) marked
-- "Confidential — Senior members only" or "Restricted — Admins only" by
-- querying /rest/v1 directly with the workspace's anon key and their own JWT.
--
-- This closes the direct anon/authenticated-key path at the database. The
-- application's own read paths (documents/preview and the chat RAG retrieval)
-- use the SERVICE ROLE, which bypasses RLS by design, so they are fixed
-- separately in code (src/lib/sensitivity.ts + the two routes). The two
-- layers share one mapping — the SQL helpers below mirror
-- src/lib/sensitivity.ts exactly. If you change one, change the other.
--
-- Safe to run more than once: helpers use CREATE OR REPLACE and policies are
-- dropped-if-exists before being recreated. No data is modified.

-- ── Role -> numeric rank ───────────────────────────────────────────────
-- Mirrors ROLE_RANK in src/lib/sensitivity.ts and normalizeRole() in
-- src/lib/roles.ts (legacy aliases included so rows that predate migration
-- 004's normalization still resolve correctly). Unknown -> junior (1), the
-- least-privileged rank, so a stray value never grants extra access.
create or replace function public.role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_role, ''))
    when 'senior'         then 3
    when 'admin'          then 3
    when 'exco'           then 3
    when 'senior_manager' then 3
    when 'middle'         then 2
    when 'junior'         then 1
    when 'staff'          then 1
    else 1
  end
$$;

-- ── Sensitivity -> minimum rank required to read ───────────────────────
-- Mirrors SENSITIVITY_MIN_RANK in src/lib/sensitivity.ts. Unknown/NULL ->
-- 'internal' (members-only), never 'public' — fail closed.
create or replace function public.sensitivity_min_rank(p_sensitivity text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_sensitivity, 'internal'))
    when 'public'       then 1
    when 'internal'     then 1
    when 'confidential' then 3
    when 'restricted'   then 3
    else 1   -- 'internal' default: all members, but not public
  end
$$;

-- ── documents: tenant membership AND sufficient rank ───────────────────
drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents
  for select using (
    exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = documents.tenant_id
        and public.role_rank(m.role) >= public.sensitivity_min_rank(documents.sensitivity)
    )
  );

-- ── document_chunks: inherit the parent document's sensitivity ─────────
-- Chunks carry no sensitivity column of their own, so the gate joins up to
-- the parent document. Without this, chunks_select would still leak the body
-- of a confidential document one chunk at a time even after documents_select
-- is tightened.
drop policy if exists "chunks_select" on public.document_chunks;
create policy "chunks_select" on public.document_chunks
  for select using (
    exists (
      select 1
      from public.documents d
      join public.memberships m on m.tenant_id = d.tenant_id
      where d.id = document_chunks.document_id
        and m.user_id = auth.uid()
        and public.role_rank(m.role) >= public.sensitivity_min_rank(d.sensitivity)
    )
  );
