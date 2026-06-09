-- 003_fix_vector_search_recall
--
-- The document_chunks_embedding_idx ivfflat index was created with
-- `lists = 100`, a setting meant for corpora of hundreds of thousands of
-- rows. With only ~700 chunks in the table, each of the 100 clusters holds
-- a handful of vectors, and the default `probes = 1` means most searches
-- only inspect one near-empty cluster — so semantically relevant chunks are
-- routinely missed (verified: random query vectors returned zero matches
-- roughly half the time, even with match_threshold = -1).
--
-- At this scale, an exact sequential scan over the embeddings is a few
-- milliseconds and guarantees correct, complete results. Drop the
-- approximate index so match_document_chunks always finds the true nearest
-- neighbours. Revisit with a properly-sized HNSW/ivfflat index only once the
-- corpus grows into the tens of thousands of chunks.

drop index if exists public.document_chunks_embedding_idx;
