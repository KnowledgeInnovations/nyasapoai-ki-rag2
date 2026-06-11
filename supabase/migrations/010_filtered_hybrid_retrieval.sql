-- 010_filtered_hybrid_retrieval
--
-- match_document_chunks_hybrid (006) ranks purely on vector similarity + FTS
-- rank — for queries that name a specific fiscal year and/or
-- ministry/sector (e.g. "Ministry of Health allocation in 2021"), nothing
-- stops a chunk from a DIFFERENT year's budget document (which can be more
-- textually similar overall) from outranking the correct year's chunk.
--
-- match_document_chunks_hybrid_filtered adds optional p_fiscal_year /
-- p_ministry / p_sector filters, applied to both the vector and FTS
-- candidate sets via the generated columns added in 006. All filters are
-- optional (null = no restriction), so the chat route can pass through
-- whatever extractQueryFilters() finds for the query, falling back to the
-- unfiltered behavior when nothing is detected.

create or replace function public.match_document_chunks_hybrid_filtered(
  query_embedding  vector(1536),
  query_text       text,
  p_tenant_id      uuid,
  match_count      int default 30,
  p_fiscal_year    text default null,
  p_ministry       text default null,
  p_sector         text default null
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
    where dc.tenant_id = p_tenant_id
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
