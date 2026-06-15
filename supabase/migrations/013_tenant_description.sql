-- Per-tenant description used to personalize the AI assistant's persona
-- (e.g. "a Ghanaian AI strategy, FinTech, and digital transformation
-- consultancy") instead of hardcoding Knowledge Innovations' description
-- for every tenant.
alter table public.tenants add column if not exists description text;

update public.tenants
set description = 'a Ghanaian AI strategy, FinTech, and digital transformation consultancy'
where subdomain = 'knowledge-innovations' and description is null;
