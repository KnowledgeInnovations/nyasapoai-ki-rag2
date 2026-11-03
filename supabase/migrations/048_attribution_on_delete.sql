-- "Who did this" pointers must not make that person undeletable.
--
-- plan_prices.updated_by (migration 046) and payments.initiated_by
-- (migration 047) both reference users(id) with no ON DELETE action, which
-- is NO ACTION — so once somebody has set a price or started a payment,
-- deleting their account fails with "Database error deleting user". Found
-- the first time an account that had set a price needed removing.
--
-- SET NULL is the right answer for both: the row is about the price or the
-- payment, and the person is attribution. Losing the attribution when the
-- account goes is a smaller loss than being unable to remove the account.
--
-- Purely additive in effect: only the delete behaviour of two foreign keys
-- changes. No column is dropped or renamed and no row's data changes.

alter table public.plan_prices
  drop constraint if exists plan_prices_updated_by_fkey;
alter table public.plan_prices
  add constraint plan_prices_updated_by_fkey
  foreign key (updated_by) references public.users(id)
  on delete set null;

alter table public.payments
  drop constraint if exists payments_initiated_by_fkey;
alter table public.payments
  add constraint payments_initiated_by_fkey
  foreign key (initiated_by) references public.users(id)
  on delete set null;

-- Deliberately NOT changed here: audit_logs.user_id, which has the same
-- shape and the same problem. SET NULL is wrong for it — the reader renders
-- a null actor as "Nyansa AI — automatic", so a deleted person's actions
-- would be relabelled as things the system did on its own, which is worse
-- than either alternative. Fixing that properly means keeping the id and
-- dropping the constraint, so the existing "Removed user" path in
-- /api/audit takes over. Left for its own change rather than smuggled into
-- this one.
