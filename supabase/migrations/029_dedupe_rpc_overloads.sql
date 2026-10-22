-- 029_dedupe_rpc_overloads
--
-- Removes the redundant "base" overloads of the three retrieval RPCs, leaving
-- exactly one signature per function so PostgREST can resolve each call
-- unambiguously.
--
-- Background: migration 016 (the platform-shared-chunks ROLLBACK) recreated
-- these functions with `create or replace function` at their ORIGINAL, shorter
-- signatures. Because `create or replace` only replaces a function of the
-- *same* signature, the earlier platform-sharing overloads (which carried a
-- trailing `p_platform_tenant_id uuid` param) were left in place instead of
-- being replaced — so each function ended up with TWO live overloads. Migration
-- 028 then re-`create or replace`d BOTH overloads (base + platform) on the new
-- OR-based FTS body, preserving the duplication.
--
-- The extra `p_platform_tenant_id` param is vestigial — it's accepted but never
-- referenced in any function body (confirmed via pg_get_functiondef, and noted
-- in 028's header). With both overloads present, a PostgREST `.rpc()` call that
-- omits `p_platform_tenant_id` fails with PGRST203 "Could not choose the best
-- candidate function", silently dropping hybrid/filtered/per-doc retrieval back
-- to the FTS/direct-scan fallback. Every application call site now passes
-- `p_platform_tenant_id: null` (which uniquely selects the platform overload),
-- so dropping the base overloads is safe and removes the latent ambiguity for
-- any future call site that forgets the param.
--
-- Confirmed live before writing (calling each fn without p_platform_tenant_id
-- returned PGRST203; calling WITH it returned OK): all three functions have the
-- duplicate. Idempotent — safe to re-run.
--
-- Must run AFTER 028 (which defines both overloads). If the whole migration set
-- is ever replayed from scratch, 028 creates base+platform and this drops base.

drop function if exists public.match_document_chunks_hybrid(
  vector, text, uuid, integer
);

drop function if exists public.match_document_chunks_hybrid_filtered(
  vector, text, uuid, integer, text, text, text
);

drop function if exists public.match_document_chunks_per_doc(
  vector, uuid, integer, double precision
);
