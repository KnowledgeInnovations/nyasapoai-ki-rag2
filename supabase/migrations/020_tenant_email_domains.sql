-- 020_tenant_email_domains
--
-- Restricts which email domains can be invited to a tenant. Empty array
-- (the default) means unrestricted — existing tenants aren't suddenly
-- locked out until an admin explicitly sets domains via Settings. A
-- self-provisioned tenant auto-captures its creator's email domain at
-- creation time (see POST /api/tenants), so new tenants are protected from
-- day one without manual setup.
--
-- Enforced only at invite time (POST /api/users) — does not retroactively
-- affect existing memberships, so a tenant with legitimate pre-existing
-- cross-domain members (e.g. consultants) isn't broken by adopting this.

alter table public.tenants
  add column if not exists email_domains text[] not null default '{}';

update public.tenants set email_domains = array['devtraco.com'] where subdomain = 'devtraco';
update public.tenants set email_domains = array['knowledgeinnovations.com'] where subdomain = 'knowledge';
