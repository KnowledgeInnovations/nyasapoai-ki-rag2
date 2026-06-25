-- 028_or_based_fts
--
-- websearch_to_tsquery ANDs every non-stopword term together by default.
-- Confirmed live: "GAIMS" alone matched 4 chunks, but the natural question
-- "what is the meaning of GAIMS" matched ZERO — "meaning" doesn't appear
-- near "GAIMS" in the source, so the AND-combined query excluded the
-- correct chunk entirely. This silently starved the FTS leg of hybrid
-- retrieval for any natural-language question containing words not
-- present in the target chunk, which is the normal case, not an edge case.
--
-- Replaces websearch_to_tsquery with an OR-combined query built from the
-- same lexemes plainto_tsquery would produce (still gets English stemming
-- and stopword removal — "what"/"is"/"the"/"of" are still dropped), so a
-- chunk now only needs to match ANY significant query term, not all of
-- them. This widens the candidate pool rather than narrowing it; ts_rank
-- still favors chunks matching more/rarer terms, and the result still
-- passes through RRF fusion with the vector leg plus LLM reranking
-- downstream, so broader recall here doesn't mean worse final answers.
--
-- Each of these 3 functions has two live overloads (base, and one with a
-- trailing p_platform_tenant_id uuid param that's accepted but never
-- referenced in the body — confirmed via pg_get_functiondef before writing
-- this, not assumed). Both overloads are replaced identically below so
-- neither is left on the old AND-based query.

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
             order by ts_rank(dc.fts, to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))) desc
           ) as rnk
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and length(plainto_tsquery('english', query_text)::text) > 0
      and dc.fts @@ to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))
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

create or replace function public.match_document_chunks_hybrid(
  query_embedding  vector(1536),
  query_text       text,
  p_tenant_id      uuid,
  match_count      int default 30,
  p_platform_tenant_id uuid default null
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
             order by ts_rank(dc.fts, to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))) desc
           ) as rnk
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and length(plainto_tsquery('english', query_text)::text) > 0
      and dc.fts @@ to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))
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
             order by ts_rank(dc.fts, to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))) desc
           ) as TS_rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and (p_fiscal_year is null or dc.fiscal_year = p_fiscal_year)
      and (p_ministry is null or dc.ministry ilike '%' || p_ministry || '%')
      and (p_sector is null or dc.sector ilike '%' || p_sector || '%')
      and length(plainto_tsquery('english', query_text)::text) > 0
      and dc.fts @@ to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))
    limit 60
  ),
  combined as (
    select coalesce(v.id, f.id) as id,
           coalesce(v.similarity, 0) as similarity,
           coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.TS_rank), 0) as rrf_score
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
  query_embedding  vector(1536),
  query_text       text,
  p_tenant_id      uuid,
  match_count      int default 30,
  p_fiscal_year    text default null,
  p_ministry       text default null,
  p_sector         text default null,
  p_platform_tenant_id uuid default null
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
             order by ts_rank(dc.fts, to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))) desc
           ) as TS_rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and (p_fiscal_year is null or dc.fiscal_year = p_fiscal_year)
      and (p_ministry is null or dc.ministry ilike '%' || p_ministry || '%')
      and (p_sector is null or dc.sector ilike '%' || p_sector || '%')
      and length(plainto_tsquery('english', query_text)::text) > 0
      and dc.fts @@ to_tsquery('english', regexp_replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ', 'g'))
    limit 60
  ),
  combined as (
    select coalesce(v.id, f.id) as id,
           coalesce(v.similarity, 0) as similarity,
           coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + f.TS_rank), 0) as rrf_score
    from vector_ranked v
    full outer join fts_ranked f on f.id = v.id
  )
  select dc.id, dc.document_id, dc.chunk_text, dc.metadata, c.similarity, c.rrf_score
  from combined c
  join public.document_chunks dc on dc.id = c.id
  order by c.rrf_score desc
  limit match_count;
$$;
