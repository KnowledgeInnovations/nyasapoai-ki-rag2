-- 006_hybrid_retrieval
--
-- Adds the pieces needed for hybrid (vector + keyword) retrieval and richer
-- citation metadata, without requiring a new vector DB or paid reranker:
--
-- 1. A generated tsvector column + GIN index for Postgres full-text (BM25-ish)
--    search over chunk_text.
-- 2. Generated, indexable columns for page_number / section_title /
--    fiscal_year / ministry / sector, sourced from the existing `metadata`
--    jsonb (ingestion populates these keys; no data migration needed for
--    older chunks — they'll just be NULL and excluded from filtered
--    searches, but still returned by unfiltered ones).
-- 3. match_document_chunks_hybrid(): combines vector similarity and Postgres
--    full-text rank via Reciprocal Rank Fusion (RRF), returns up to
--    `match_count` candidates (default 30) for downstream reranking.

-- ─────────────────────────────────────────
-- Full-text search column + index
-- ─────────────────────────────────────────
alter table public.document_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', chunk_text)) stored;

create index if not exists document_chunks_fts_idx
  on public.document_chunks using gin (fts);

-- ─────────────────────────────────────────
-- Structured metadata columns (sourced from jsonb `metadata`)
-- ─────────────────────────────────────────
alter table public.document_chunks
  add column if not exists page_number  int
    generated always as (nullif(metadata->>'page_number', '')::int) stored,
  add column if not exists section_title text
    generated always as (metadata->>'section_title') stored,
  add column if not exists fiscal_year   text
    generated always as (metadata->>'fiscal_year') stored,
  add column if not exists ministry      text
    generated always as (metadata->>'ministry') stored,
  add column if not exists sector        text
    generated always as (metadata->>'sector') stored;

create index if not exists document_chunks_fiscal_year_idx
  on public.document_chunks (tenant_id, fiscal_year);

create index if not exists document_chunks_ministry_idx
  on public.document_chunks (tenant_id, ministry);

-- ─────────────────────────────────────────
-- Hybrid retrieval (dense vector + BM25-ish FTS via RRF)
-- ─────────────────────────────────────────
create or replace function public.match_document_chunks_hybrid(
  query_embedding  vector(1536),
  query_text       text,
  p_tenant_id      uuid,
  match_count      int default 30
)
returns table (
  id           uuid,
  document_id  uuid,
  chunk_text   text,
  metadata     jsonb,
  similarity   float,
  rrf_score    float
) language sql stable as $$
  with vector_ranked as (
    select dc.id,
           1 - (dc.embedding <=> query_embedding) as similarity,
           row_number() over (order by dc.embedding <=> query_embedding) as rnk
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
    order by dc.embedding <=> query_embedding
    limit 60
  ),
  fts_ranked as (
    select dc.id,
           row_number() over (
             order by ts_rank(dc.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rnk
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and length(coalesce(query_text, '')) > 0
      and dc.fts @@ websearch_to_tsquery('english', query_text)
    limit 60
  ),
  combined as (
    select coalesce(v.id, f.id) as id,
           coalesce(v.similarity, 0) as similarity,
           coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.rnk), 0) as rrf_score
    from vector_ranked v
    full outer join fts_ranked f on f.id = v.id
  )
  select dc.id, dc.document_id, dc.chunk_text, dc.metadata, c.similarity, c.rrf_score
  from combined c
  join public.document_chunks dc on dc.id = c.id
  order by c.rrf_score desc
  limit match_count;
$$;
