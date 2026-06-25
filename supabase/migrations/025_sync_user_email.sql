-- 025_sync_user_email
--
-- public.users.email was only ever populated at signup (on_auth_user_created,
-- INSERT-only) — nothing kept it in sync afterward. Confirmed live: an
-- admin-confirmed email change (auth.users.email) left public.users.email
-- silently stale, which the Users admin page reads directly, so a member
-- who'd changed their email would show the OLD address to admins forever.
-- The new self-service email-change flow (Settings -> Profile) would hit
-- the exact same gap once a change is actually confirmed.

create or replace function public.handle_user_email_change()
returns trigger as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_email_updated
  after update on auth.users
  for each row execute procedure public.handle_user_email_change();
