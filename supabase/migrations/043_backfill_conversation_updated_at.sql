-- Repairs what migration 042 got wrong on the database it was first applied
-- to. Its backfill was guarded on "updated_at < created_at", but the add
-- column had just stamped every row with now() — later than every created_at
-- — so the guard matched nothing and all 382 existing conversations ended up
-- sharing one timestamp: the instant the column was added. The sidebar would
-- have shown the entire history as a single block under "Today", which is
-- worse than the created_at ordering it replaced.
--
-- There is no record of when those conversations were last appended to: the
-- column did not exist, so nothing ever wrote it. created_at is therefore the
-- only honest value, and it is exactly what the sidebar used before. Scoped
-- to rows that predate the column so nothing written since is touched; on a
-- database where 042 ran in its corrected form, this matches no rows.
--
-- One row loses a real bump: a conversation appended to between the column
-- being added and this running falls back to its created_at. That is the
-- pre-042 behaviour for it, so nothing we ever had is lost.

update public.conversations
set    updated_at = created_at
where  created_at < timestamptz '2026-10-25 17:42:31.204359+00'
  and  updated_at <> created_at;
