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
  // Epoch ms after which to stop retrying network-class failures and throw
  // instead — lets a long outage degrade gracefully (caller drops this one
  // batch, route still finishes on time) rather than retrying past Vercel's
  // hard maxDuration kill, which would leave the document stuck "processing"
  // forever with no persisted status at all. Callers that don't pass one
  // get the old fixed-attempt-count behavior.
  deadline?: number
}

// Single non-streaming completion — returns the assistant's text response.
// Retries on 429 (the Claude org's 10k input-tokens/min limit is a per-minute
// throughput cap, not a balance issue — a short backoff almost always
// succeeds). Without this, callers like the dashboard insights batch (which
// fires several of these in parallel) silently swallow 429s via .catch(() =>
// ''), surfacing as "Insight temporarily unavailable" even though the org has
// plenty of credit.
const MAX_CLAUDE_COMPLETE_ATTEMPTS = 3
// No caller currently passes its own `signal` — a stalled TCP connection (no
// error, no response) on an unstable network previously hung this fetch
// indefinitely, which is what blocked an upload/training pipeline until
// Vercel's hard maxDuration kill rather than failing fast and retrying.
const DEFAULT_CLAUDE_TIMEOUT_MS = 45000
// Growing backoff for network-class failures when a deadline is supplied —
// a real connectivity drop is rarely fixed in 1-2s (the old fixed backoff),
// but most blips clear well within a minute or two, which this comfortably
// covers without needing more than a handful of retries.
const NETWORK_RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000]
// Leaves enough headroom for the response itself plus whatever the caller
// still needs to do after this call returns, instead of starting a retry
// wait that the deadline would cut off mid-sleep anyway.
const DEADLINE_SAFETY_MARGIN_MS = 5000

// Anything where the request never reached/returned from the server — as
// opposed to the server responding with an error status — is a transient
// network condition worth waiting out, not a genuine API/content problem
// retrying won't fix.
export function isNetworkError(e: unknown): boolean {
  const err = e as { name?: string; code?: string; message?: string; cause?: { code?: string } }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return true
  const code = err?.code ?? err?.cause?.code
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code)) return true
  // "terminated" is undici's message when the underlying connection is
  // aborted/closed mid-request (observed live: a document_chunks fetch that
  // failed this way wasn't recognized as network-class, so it skipped
  // straight to "not found" instead of retrying — same failure mode this
  // whole classifier exists to catch, just a message format it didn't cover).
  return /fetch failed|network|getaddrinfo|terminated|socket hang up|other side closed/i.test(err?.message ?? '')
}

// Generic retry-on-network-error wrapper for any operation that returns a
// Supabase-style { data, error } result (or throws) — used by the standalone
// corpus-maintenance script (refacts-all.ts) and the auto-reprocess trigger
// (autoReprocess.ts) so a transient connectivity blip mid-run is retried
// with growing backoff instead of being misread as "document not found" / a
// genuine empty result. Non-network errors are not retried — they won't
// resolve themselves by waiting.
const RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000]
export async function withRetry<T>(
  fn: () => PromiseLike<{ data: T; error: unknown } | { data: null; error: unknown }>,
  label: string,
): Promise<{ data: T | null; error: unknown }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fn()
      if (res.error && isNetworkError(res.error) && attempt <= RETRY_BACKOFF_MS.length) {
        console.error(`  [${label}] network error, retrying:`, (res.error as Error).message)
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]))
        continue
      }
      return res
    } catch (e) {
      if (isNetworkError(e) && attempt <= RETRY_BACKOFF_MS.length) {
        console.error(`  [${label}] network error, retrying:`, (e as Error).message)
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]))
        continue
      }
      throw e
    }
  }
}

export async function claudeComplete({ system, messages, maxTokens = 1024, temperature = 0, signal, deadline }: ClaudeCompleteOptions): Promise<string> {
  let res: Response | undefined
  for (let attempt = 1; ; attempt++) {
    try {
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
        signal: signal ?? AbortSignal.timeout(DEFAULT_CLAUDE_TIMEOUT_MS),
      })
    } catch (e) {
      // A caller-provided signal aborting is the caller's own cancellation —
      // respect it immediately rather than retrying. Anything else (our own
      // timeout firing, or a genuine network failure) is retried below.
      if (signal?.aborted) throw e

      if (deadline != null && isNetworkError(e)) {
        const wait = NETWORK_RETRY_BACKOFF_MS[Math.min(attempt - 1, NETWORK_RETRY_BACKOFF_MS.length - 1)]
        if (Date.now() + wait > deadline - DEADLINE_SAFETY_MARGIN_MS) throw e
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (attempt === MAX_CLAUDE_COMPLETE_ATTEMPTS) throw e
      await new Promise(r => setTimeout(r, attempt * 1000))
      continue
    }
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

// Scans from `start` (the index of an opening [ or {) and returns the
// substring up to its balanced closing bracket, tracking string literals
// (with escapes) so a bracket character inside a quoted value doesn't throw
// off the depth count. Used to recover the JSON value itself when Claude
// appends trailing prose after it (e.g. "[...]\n\nNo other facts found.").
function sliceBalanced(text: string, start: number): string {
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start) // unbalanced (likely truncated) — let JSON.parse surface the real error
}

// Claude has no response_format:"json_object" mode — it sometimes wraps JSON
// in a ```json fence despite being asked for raw JSON, and sometimes adds
// leading/trailing prose around (or instead of) a fence ("[...]\n\nNo other
// facts found in this table."), which an anchored fence-only regex doesn't
// strip, leaving JSON.parse to choke on the trailing text. Finds the fenced
// block (anywhere in the response, not just spanning the whole thing) or
// failing that, the first balanced top-level [...]/{...} and discards
// anything outside it.
export function extractJSON(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch) return fenceMatch[1]
  const start = trimmed.search(/[[{]/)
  return start === -1 ? trimmed : sliceBalanced(trimmed, start)
}
