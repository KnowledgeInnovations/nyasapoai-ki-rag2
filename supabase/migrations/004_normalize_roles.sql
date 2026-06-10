-- 004_normalize_roles
--
-- The Nyasapo RBAC model defines exactly three roles: senior, middle, junior.
-- The memberships.role check constraint already enforces this, but rows
-- created before the constraint existed (or via direct inserts) may still
-- carry legacy values: admin, exco, senior_manager, staff. Normalize them:
--
--   admin, exco, senior_manager -> senior
--   staff                       -> junior
--   senior, middle, junior      -> unchanged

update public.memberships
set role = 'senior'
where role in ('admin', 'exco', 'senior_manager');

update public.memberships
set role = 'junior'
where role = 'staff';
