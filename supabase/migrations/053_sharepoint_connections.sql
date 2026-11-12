-- Documents that live in SharePoint, kept in step with a workspace.
--
-- A customer's documents are usually already somewhere — most often a
-- SharePoint document library — and asking them to re-upload is asking
-- them to maintain two copies. This is the state a connector needs to
-- mirror one library without re-reading all of it every time.
--
-- Two tables, and the split matters:
--
--   sharepoint_connections  one per library a workspace has connected,
--                           holding the cursor into that library's change
--                           feed.
--   sharepoint_items        one per file, mapping SharePoint's id to the
--                           document we created from it. Without this a
--                           second sync re-imports everything as new
--                           documents, and a file deleted in SharePoint
--                           stays answerable here forever.
--
-- ── On credentials ───────────────────────────────────────────────────
-- There are deliberately none here. The platform registers ONE Azure
-- application; each customer's administrator consents to it in their own
-- Microsoft 365 tenant and grants it access to specific sites. We store
-- only which Azure tenant to ask for a token — the client secret is ours,
-- lives in the environment, and is shared by every connection.
--
-- The alternative, asking each customer for a client secret and storing
-- it, would make this table the most valuable row in the database: a
-- credential that reads their entire document estate, held by us, in a
-- table a single SQL injection away. Not storing it is the whole design.
--
-- ── On permissions ───────────────────────────────────────────────────
-- Application access reads everything in a granted site regardless of who
-- could see it in SharePoint. A file restricted to three people becomes
-- answerable by the whole workspace. That is the same defect migration
-- 051 closed for uploaded documents, one layer out, so it is handled the
-- same way: a connection carries a sensitivity, every document it creates
-- inherits it, and 051's enforcement does the rest. Mirroring SharePoint's
-- own ACLs is a larger project and needs far broader consent.
--
-- Purely additive. No existing table, column or row is altered.

create table if not exists public.sharepoint_connections (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,

  -- What the workspace calls this library, e.g. "Finance — Board Papers".
  display_name      text not null,

  -- Microsoft's identifiers. azure_tenant_id is the customer's Microsoft
  -- 365 tenant, which is who we request a token for; site_id and drive_id
  -- name the library inside it.
  azure_tenant_id   text not null,
  site_id           text not null,
  drive_id          text not null,
  -- For showing a human where this points, and for support.
  site_url          text,

  -- Applied to every document this connection creates. See the note above.
  sensitivity       text not null default 'internal'
                    check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  department        text,

  -- The administrator who connected it. Documents are attributed to them,
  -- because `documents.uploaded_by` must point at a real person and "the
  -- connector" is not one.
  connected_by      uuid references public.users(id) on delete set null,

  -- The cursor into this library's change feed (Graph's @odata.deltaLink).
  -- Null means nothing has been synced yet, so the next run reads the
  -- library from the beginning.
  delta_link        text,

  enabled           boolean not null default true,

  last_sync_at      timestamptz,
  -- 'ok' | 'partial' | 'failed' — 'partial' is a normal outcome, not an
  -- error: a large library is imported across several runs.
  last_sync_status  text,
  last_sync_detail  text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One connection per library per workspace. Connecting the same library
  -- twice would import every file twice.
  unique (tenant_id, drive_id)
);

comment on table public.sharepoint_connections is
  'One connected SharePoint document library per row, with its change-feed cursor. Holds no credentials by design — see the migration header.';
comment on column public.sharepoint_connections.delta_link is
  'Graph @odata.deltaLink: where the next sync resumes. Null means sync from the beginning.';
comment on column public.sharepoint_connections.sensitivity is
  'Applied to every document created from this library. Application access cannot see SharePoint''s per-file permissions, so the level is declared once here.';

create index if not exists sharepoint_connections_tenant_idx
  on public.sharepoint_connections (tenant_id);
create index if not exists sharepoint_connections_due_idx
  on public.sharepoint_connections (enabled, last_sync_at);

-- ── The file-to-document map ─────────────────────────────────────────
create table if not exists public.sharepoint_items (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.sharepoint_connections(id) on delete cascade,

  -- SharePoint's own id for the file. Stable across renames and moves,
  -- which is why it, and not the path, is the key.
  graph_item_id  text not null,

  -- The document we created from it. ON DELETE SET NULL rather than
  -- CASCADE: if someone deletes the document here, the mapping should
  -- survive long enough for the next sync to notice and re-import, rather
  -- than silently vanishing and leaving the file unimported forever.
  document_id    uuid references public.documents(id) on delete set null,

  -- Graph's version marker. Unchanged eTag means unchanged bytes, so the
  -- file is skipped — the single biggest saving in a routine sync, since
  -- re-reading a document costs extraction, embedding and fact work.
  etag           text,

  -- Where it sits in the library, for display. Not a key: files move.
  item_path      text,
  item_name      text,
  size_bytes     bigint,

  last_synced_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  unique (connection_id, graph_item_id)
);

comment on table public.sharepoint_items is
  'Maps a SharePoint file to the document created from it, so repeat syncs update rather than duplicate, and deletions propagate.';
comment on column public.sharepoint_items.etag is
  'Graph eTag at last import. Unchanged means the bytes are unchanged and the file is skipped.';

create index if not exists sharepoint_items_connection_idx
  on public.sharepoint_items (connection_id);
create index if not exists sharepoint_items_document_idx
  on public.sharepoint_items (document_id);

-- RLS on with no policy: the service role bypasses it, everyone else gets
-- nothing. These rows describe a workspace's integration state and are
-- read and written only by server-side sync code, never from a browser.
alter table public.sharepoint_connections enable row level security;
alter table public.sharepoint_items enable row level security;
