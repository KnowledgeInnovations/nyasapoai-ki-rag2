-- 012_citation_message_index
--
-- citations rows were only ever inserted for the FIRST AI message of a
-- conversation (the `newSession` insert path) — follow-up turns
-- (appendConv) never wrote citation rows. On reload, GET /api/chat?citations=
-- returned only that first message's citations, and the client applied that
-- single flat list to every AI message with empty citations — so a later
-- message's [n] markers resolved against the wrong (or missing) citation
-- and rendered as dead, non-clickable text.
--
-- Adds `message_index` (the index of the AI message within
-- conversations.messages) so each turn's citations can be inserted and
-- restored independently.

alter table public.citations
  add column message_index integer;

create index citations_conversation_message_idx
  on public.citations (conversation_id, message_index);
