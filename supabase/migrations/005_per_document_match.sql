-- 005_per_document_match
--
-- match_document_chunks does a single global top-K vector search across the
-- whole tenant. For "across all years/documents" questions (e.g. "total
-- budget allocation for each year from 1999-2026" against 27 separate
-- budget documents), a global top-8 search can only ever surface chunks
-- from a handful of the most-similar documents — most years are silently
-- dropped, so the AI reports "not available" even though every year's
-- document is trained and ready.
--
-- This function instead returns the top N chunks PER DOCUMENT, guaranteeing
-- every ready document contributes at least one chunk to broad/aggregation
-- queries. The chat route uses this in addition to the global search when it
-- detects a multi-document/aggregation-style question.

create or replace function public.match_document_chunks_per_doc(
  query_embedding      vector(1536),
  p_tenant_id          uuid,
  match_count_per_doc  int   default 2,
  match_threshold      float default 0.0
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
    where dc.tenant_id = p_tenant_id
      and d.status = 'ready'
      and 1 - (dc.embedding <=> query_embedding) > match_threshold
  ) ranked
  where rn <= match_count_per_doc
  order by document_id, rn;
$$;
