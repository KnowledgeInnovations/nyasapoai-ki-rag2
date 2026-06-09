-- 002_conversation_messages
-- Store the full multi-turn message thread inside each conversation row.

alter table public.conversations
  add column if not exists messages jsonb not null default '[]'::jsonb;

-- Users may update their own conversation rows (needed for the append RPC below).
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id);

-- Atomically append a pair of messages (user + AI) to an existing conversation.
create or replace function public.append_conversation_messages(
  p_conversation_id  uuid,
  p_user_id          uuid,
  p_new_messages     jsonb
) returns void
language plpgsql security definer as $$
begin
  update public.conversations
  set    messages = messages || p_new_messages
  where  id      = p_conversation_id
    and  user_id = p_user_id;
end;
$$;
