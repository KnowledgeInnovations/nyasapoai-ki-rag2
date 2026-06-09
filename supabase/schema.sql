-- Enable pgvector for embeddings
create extension if not exists vector;

-- ─────────────────────────────────────────
-- TENANTS
-- ─────────────────────────────────────────
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subdomain   text not null unique,
  plan        text not null default 'starter' check (plan in ('starter', 'professional', 'enterprise')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- USERS  (mirrors auth.users)
-- ─────────────────────────────────────────
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data->>'name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────
-- MEMBERSHIPS  (user ↔ tenant with role)
-- ─────────────────────────────────────────
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  role        text not null default 'junior' check (role in ('senior', 'middle', 'junior')),
  created_at  timestamptz not null default now(),
  unique(user_id, tenant_id)
);

-- ─────────────────────────────────────────
-- DOCUMENTS
-- ─────────────────────────────────────────
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  uploaded_by  uuid not null references public.users(id),
  title        text not null,
  source       text,                          -- original filename or URL
  department   text,
  sensitivity  text not null default 'internal'
               check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  status       text not null default 'processing'
               check (status in ('processing', 'ready', 'failed')),
  file_path    text,                          -- Supabase Storage path
  file_size    bigint,
  mime_type    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DOCUMENT CHUNKS  (with vector embedding)
-- ─────────────────────────────────────────
create table public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  chunk_text   text not null,
  chunk_index  integer not null,
  embedding    vector(1536),                  -- OpenAI text-embedding-3-small dimension
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- No ANN index on `embedding` — at our current scale (low thousands of
-- chunks) an exact sequential scan is a few milliseconds and guarantees
-- correct recall. An ivfflat index with lists=100 was tried and removed
-- (see migrations/003_fix_vector_search_recall.sql): with so few rows per
-- cluster, semantically relevant chunks were routinely missed. Add a
-- properly-sized HNSW index only once the corpus reaches the tens of
-- thousands of chunks.

-- ─────────────────────────────────────────
-- CONVERSATIONS
-- ─────────────────────────────────────────
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  query            text not null,
  response         text,
  confidence_score numeric(3,2),
  risks            text[],
  recommendations  text[],
  messages         jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- CITATIONS  (which chunks supported an answer)
-- ─────────────────────────────────────────
create table public.citations (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  document_chunk_id   uuid not null references public.document_chunks(id) on delete cascade,
  relevance_score     numeric(4,3),
  created_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- AUDIT LOGS
-- ─────────────────────────────────────────
create table public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid references public.users(id),
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────
alter table public.tenants         enable row level security;
alter table public.users           enable row level security;
alter table public.memberships     enable row level security;
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations   enable row level security;
alter table public.citations       enable row level security;
alter table public.audit_logs      enable row level security;

-- Helper: get the calling user's tenant_id for a given subdomain
create or replace function public.current_tenant_id(p_subdomain text)
returns uuid as $$
  select t.id from public.tenants t
  join public.memberships m on m.tenant_id = t.id
  where t.subdomain = p_subdomain
    and m.user_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- Helper: get the calling user's role within a tenant
create or replace function public.current_user_role(p_tenant_id uuid)
returns text as $$
  select role from public.memberships
  where tenant_id = p_tenant_id and user_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- Users: can only read/update own profile
create policy "users_read_own" on public.users
  for select using (auth.uid() = id);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- Memberships: members can see their own memberships
create policy "memberships_read_own" on public.memberships
  for select using (auth.uid() = user_id);

-- Documents: tenant members can read; only middle/senior can insert
create policy "documents_select" on public.documents
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = documents.tenant_id
    )
  );

create policy "documents_insert" on public.documents
  for insert with check (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid()
        and tenant_id = documents.tenant_id
        and role in ('senior', 'middle')
    )
  );

-- Document chunks: same tenant isolation
create policy "chunks_select" on public.document_chunks
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid() and tenant_id = document_chunks.tenant_id
    )
  );

-- Conversations: users can only see their own
create policy "conversations_select" on public.conversations
  for select using (auth.uid() = user_id);

create policy "conversations_insert" on public.conversations
  for insert with check (auth.uid() = user_id);

create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id);

-- Citations: accessible if the conversation is yours
create policy "citations_select" on public.citations
  for select using (
    exists (
      select 1 from public.conversations
      where id = citations.conversation_id and user_id = auth.uid()
    )
  );

-- Audit logs: only senior role can read
create policy "audit_logs_select" on public.audit_logs
  for select using (
    exists (
      select 1 from public.memberships
      where user_id = auth.uid()
        and tenant_id = audit_logs.tenant_id
        and role = 'senior'
    )
  );

-- ─────────────────────────────────────────
-- CONVERSATION MESSAGE APPEND
-- ─────────────────────────────────────────
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

-- ─────────────────────────────────────────
-- VECTOR SIMILARITY SEARCH FUNCTION
-- ─────────────────────────────────────────
create or replace function public.match_document_chunks(
  query_embedding  vector(1536),
  p_tenant_id      uuid,
  match_threshold  float default 0.7,
  match_count      int   default 10
)
returns table (
  id              uuid,
  document_id     uuid,
  chunk_text      text,
  metadata        jsonb,
  similarity      float
) language sql stable as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_text,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.tenant_id = p_tenant_id
    and d.status = 'ready'
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
