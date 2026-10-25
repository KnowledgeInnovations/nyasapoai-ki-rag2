-- A chat's position in the sidebar history should follow the last thing said
-- in it, not the first. conversations only recorded created_at, so a thread
-- answered again this morning sat wherever it was first opened — days down
-- the list, under the wrong date heading.
--
-- Nothing is deleted or rewritten: existing rows are backfilled from
-- created_at, which for a single-exchange chat is the same instant anyway.

alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

-- The add column above stamps every existing row with now(), which is later
-- than any created_at — so a guard of "updated_at < created_at" excludes
-- precisely the rows it was meant to repair, and the backfill silently does
-- nothing. See migration 043, which repairs the database this shipped to.
update public.conversations
set    updated_at = created_at
where  updated_at <> created_at;

-- The sidebar reads 60 of these per user, newest activity first.
create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

-- Appending a turn is the event that makes a conversation recent, so the
-- bump belongs in the same statement that appends it — a separate update
-- from the route could fail on its own and leave the two disagreeing.
create or replace function public.append_conversation_messages(
  p_conversation_id  uuid,
  p_user_id          uuid,
  p_new_messages     jsonb
) returns void
language plpgsql security definer as $$
begin
  update public.conversations
  set    messages   = messages || p_new_messages,
         updated_at = now()
  where  id      = p_conversation_id
    and  user_id = p_user_id;
end;
$$;
