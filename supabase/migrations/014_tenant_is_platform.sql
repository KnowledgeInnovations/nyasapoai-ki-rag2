-- Marks the NyasapoAI platform-operator tenant. Senior members of this
-- tenant get a read-only view of all tenants on the platform.
alter table tenants add column if not exists is_platform boolean not null default false;

update tenants set is_platform = true where id = 'f1f12b56-b0bb-488b-b931-61431c1f8245';
