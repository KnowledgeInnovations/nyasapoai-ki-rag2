/**
 * Shared helpers for non-streaming Claude (Anthropic Messages API) calls —
 * used for everything except the main chat answer stream (which streams
 * directly in src/app/api/chat/route.ts). Embeddings remain on OpenAI since
 * Anthropic has no embeddings endpoint.
 */

// A function, not a module-level constant — in the Next.js dev server,
// .env.local reloads ("Reload env: .env.local") can transiently clear
// process.env before a hot-reloaded module re-evaluates, baking an
// undefined/stale key into a constant captured at import time. Reading
// process.env at call time avoids that race.
export function getAnthropicHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY!,
    'anthropic-version': '2023-06-01',
  }
}

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeCompleteOptions {
  system?: string
  messages: ClaudeMessage[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

// Single non-streaming completion — returns the assistant's text response.
// Retries on 429 (the Claude org's 10k input-tokens/min limit is a per-minute
// throughput cap, not a balance issue — a short backoff almost always
// succeeds). Without this, callers like the dashboard insights batch (which
// fires several of these in parallel) silently swallow 429s via .catch(() =>
// ''), surfacing as "Insight temporarily unavailable" even though the org has
// plenty of credit.
const MAX_CLAUDE_COMPLETE_ATTEMPTS = 3

export async function claudeComplete({ system, messages, maxTokens = 1024, temperature = 0, signal }: ClaudeCompleteOptions): Promise<string> {
  let res: Response
  for (let attempt = 1; attempt <= MAX_CLAUDE_COMPLETE_ATTEMPTS; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: getAnthropicHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages,
      }),
      signal,
    })
    if (res.ok) break
    if (res.status !== 429 || attempt === MAX_CLAUDE_COMPLETE_ATTEMPTS) {
      throw new Error(`Claude API error ${res.status}: ${await res.text()}`)
    }
    const retryAfter = Number(res.headers.get('retry-after'))
    await new Promise(r => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt) * 1000))
  }
  const data = await res!.json()
  return (data.content?.[0]?.text ?? '').trim()
}

// Claude has no response_format:"json_object" mode — it sometimes wraps JSON
// in a ```json fence despite being asked for raw JSON. Strips that fence
// before JSON.parse.
export function extractJSON(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenceMatch ? fenceMatch[1] : trimmed
}
