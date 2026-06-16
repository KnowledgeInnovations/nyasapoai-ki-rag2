-- 016_platform_shared_chunks
--
-- Adds an optional p_platform_tenant_id parameter to all three
-- document-chunk retrieval functions so that tenant workspaces can
-- also search the platform tenant's document base ("tenants are
-- powered by the main").
--
-- When p_platform_tenant_id is NULL (the default), behavior is
-- unchanged. When set to the platform tenant's UUID, both the tenant's
-- own chunks AND the platform's chunks are searched in the same RRF
-- pass, so only one RPC call is needed per query.
--
-- Using IN (p_tenant_id, COALESCE(p_platform_tenant_id, p_tenant_id))
-- is the cleanest form: when p_platform_tenant_id IS NULL the second
-- element collapses to p_tenant_id, making the IN semantically
-- identical to the old equality check.

create or replace function public.match_document_chunks_hybrid(
  query_embedding       vector(1536),
  query_text            text,
  p_tenant_id           uuid,
  match_count           int  default 30,
  p_platform_tenant_id  uuid default null
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
    where dc.tenant_id in (p_tenant_id, coalesce(p_platform_tenant_id, p_tenant_id))
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
    where dc.tenant_id in (p_tenant_id, coalesce(p_platform_tenant_id, p_tenant_id))
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

create or replace function public.match_document_chunks_hybrid_filtered(
  query_embedding       vector(1536),
  query_text            text,
  p_tenant_id           uuid,
  match_count           int  default 30,
  p_fiscal_year         text default null,
  p_ministry            text default null,
  p_sector              text default null,
  p_platform_tenant_id  uuid default null
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
    where dc.tenant_id in (p_tenant_id, coalesce(p_platform_tenant_id, p_tenant_id))
      and d.status = 'ready'
      and (p_fiscal_year is null or dc.fiscal_year = p_fiscal_year)
      and (p_ministry is null or dc.ministry ilike '%' || p_ministry || '%')
      and (p_sector is null or dc.sector ilike '%' || p_sector || '%')
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
    where dc.tenant_id in (p_tenant_id, coalesce(p_platform_tenant_id, p_tenant_id))
      and d.status = 'ready'
      and (p_fiscal_year is null or dc.fiscal_year = p_fiscal_year)
      and (p_ministry is null or dc.ministry ilike '%' || p_ministry || '%')
      and (p_sector is null or dc.sector ilike '%' || p_sector || '%')
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

create or replace function public.match_document_chunks_per_doc(
  query_embedding       vector(1536),
  p_tenant_id           uuid,
  match_count_per_doc   int   default 2,
  match_threshold       float default 0.0,
  p_platform_tenant_id  uuid  default null
)
returns table (
  id              uuid,
  document_id     uuid,
  chunk_text      text,
  metadata        jsonb,
  similarity      float
) language sql stable as $$
  select id, document_id, chunk_text, metadata, similarity
  from (
    select
      dc.id,
      dc.document_id,
      dc.chunk_text,
      dc.metadata,
      1 - (dc.embedding <=> query_embedding) as similarity,
      row_number() over (
        partition by dc.document_id
        order by dc.embedding <=> query_embedding
      ) as rn
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id in (p_tenant_id, coalesce(p_platform_tenant_id, p_tenant_id))
      and d.status = 'ready'
      and 1 - (dc.embedding <=> query_embedding) > match_threshold
  ) ranked
  where rn <= match_count_per_doc
  order by document_id, rn;
$$;
