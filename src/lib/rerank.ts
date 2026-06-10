/**
 * Lightweight LLM-based reranker.
 *
 * We don't have a dedicated cross-encoder reranker (Cohere/Jina/BGE) wired
 * up — that needs a separate paid API key/infrastructure decision. Instead
 * we use a single cheap gpt-4o-mini call to score each retrieved candidate's
 * relevance to the query (0-10), then keep only the top N. This still gives
 * a real second-pass relevance judgment beyond raw vector/BM25 scores, with
 * scores logged for internal visibility.
 */

const OPENAI_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
}

export interface RankableChunk {
  id: string
  chunk_text: string
  similarity?: number
  rrf_score?: number
}

export interface RerankedChunk extends RankableChunk {
  rerank_score: number
}

export async function rerankChunks<T extends RankableChunk>(
  query: string,
  chunks: T[],
  topN = 10,
): Promise<(T & { rerank_score: number })[]> {
  if (chunks.length <= topN) {
    return chunks.map(c => ({ ...c, rerank_score: c.similarity ?? c.rrf_score ?? 0 }))
  }

  const list = chunks
    .map((c, i) => `[${i + 1}] ${c.chunk_text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n\n')

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: OPENAI_HEADERS,
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0, max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a retrieval relevance grader. Given a question and numbered excerpts, '
              + 'score how relevant each excerpt is to answering the question, from 0 (irrelevant) to '
              + '10 (directly answers it). Respond with JSON: {"scores": [n1, n2, ...]} — one number '
              + 'per excerpt, in order, same length as the input.',
          },
          { role: 'user', content: `Question: ${query}\n\nExcerpts:\n${list}` },
        ],
      }),
    })
    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}')
    const scores: number[] = Array.isArray(parsed.scores) ? parsed.scores : []

    if (scores.length === chunks.length) {
      return chunks
        .map((c, i) => ({ ...c, rerank_score: Math.max(0, Math.min(10, Number(scores[i]) || 0)) / 10 }))
        .sort((a, b) => b.rerank_score - a.rerank_score)
        .slice(0, topN)
    }
  } catch (err) {
    console.error('[Rerank] failed, falling back to retrieval order:', err)
  }

  // Fallback: keep original retrieval order
  return chunks
    .map(c => ({ ...c, rerank_score: c.similarity ?? c.rrf_score ?? 0 }))
    .slice(0, topN)
}
