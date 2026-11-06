/**
 * Token accounting.
 *
 * Every call to Anthropic or OpenAI comes back with the token counts the
 * provider itself will bill for. Nothing used to read them: the figure on
 * /admin/tenants was a flat assumption per question and per document, which
 * cannot be reconciled against an invoice. This records what was actually
 * spent, per workspace.
 *
 * Two rules shaped this file:
 *
 * 1. **Accounting must never break the thing it is measuring.** A failure to
 *    record usage must not fail a user's question, so every write here is
 *    fire-and-forget and every error is swallowed after being logged once.
 *    Losing a usage row is a reporting gap; throwing would be an outage.
 *
 * 2. **An unknown price is not a price of zero.** If the rate card has no
 *    rate for a model, cost is stored as null and the page shows the tokens
 *    as unpriced. A zero would quietly understate the bill, which is the one
 *    wrong answer for a number someone is checking against a statement.
 *
 * Attribution uses AsyncLocalStorage rather than threading a tenant id
 * through every signature. There are ten separate fetch boundaries to the
 * two providers, several of them four or five calls deep inside the
 * extraction pipeline; passing an id through all of that would touch far
 * more code than it is worth and would be silently dropped the first time
 * someone added a call site.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { builtinRate, BUILTIN_RATES } from './modelRates'

export type Provider = 'anthropic' | 'openai'

/** What the call was for. Free text by design — see the migration's note. */
export type Operation =
  | 'chat' | 'agentic' | 'rerank' | 'embed' | 'extract' | 'verify'
  | 'insight' | 'vision' | 'profile' | 'heuristics' | 'assessment' | 'search'

export interface UsageContext {
  tenantId?: string | null
  tenantLabel?: string | null
  userId?: string | null
}

export interface TokenCounts {
  inputTokens?: number
  outputTokens?: number
  cacheWriteTokens?: number
  cacheReadTokens?: number
}

const store = new AsyncLocalStorage<UsageContext>()

/**
 * Run `fn` with usage attributed to a workspace.
 *
 * Wrap a route handler in this and every model call underneath it — however
 * deep — is attributed without being passed anything.
 */
export function withUsage<T>(ctx: UsageContext, fn: () => T): T {
  return store.run(ctx, fn)
}

/** The current attribution, or an empty context outside a wrapped call. */
export function currentUsageContext(): UsageContext {
  return store.getStore() ?? {}
}

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/* ── the rate card ────────────────────────────────────────────
 * Cached briefly: it is read on every model call and changes when a person
 * edits it, so staleness of a few minutes is harmless and a lookup per call
 * is not.
 */
export interface ModelPrice {
  model: string
  provider: Provider
  inputUsdPerMTok: number | null
  outputUsdPerMTok: number | null
  cacheWriteUsdPerMTok: number | null
  cacheReadUsdPerMTok: number | null
  confirmedAt: string | null
  updatedAt: string | null
  /**
   * Where the rate came from. 'builtin' is the provider's published list
   * price shipped in src/lib/modelRates.ts, which is what makes this work
   * with nothing entered; 'override' is a rate someone set deliberately
   * because theirs differs.
   */
  source: 'builtin' | 'override'
}

const PRICE_TTL_MS = 5 * 60 * 1000
let priceCache: { at: number; byModel: Map<string, ModelPrice> } | null = null

// Before migration 049 has run, every model call would log the same failure.
// Worth saying, not worth saying thousands of times.
let warnedMissingPrices = false
let warnedMissingUsage = false

export async function getModelPrices(force = false): Promise<Map<string, ModelPrice>> {
  if (!force && priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.byModel

  const { data, error } = await svc()
    .from('model_prices')
    .select('model, provider, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok, confirmed_at, updated_at')

  if (error) {
    if (!warnedMissingPrices) {
      warnedMissingPrices = true
      console.warn(`[usage] stored rate overrides unavailable (${error.message}) — falling back to published rates. Has migration 049 run?`)
    }
    // Still priced: the published rates live in code, not in the database.
    const builtinOnly = new Map<string, ModelPrice>()
    for (const [model, r] of Object.entries(BUILTIN_RATES)) {
      builtinOnly.set(model, {
        model, provider: r.provider,
        inputUsdPerMTok: r.input, outputUsdPerMTok: r.output,
        cacheWriteUsdPerMTok: r.cacheWrite, cacheReadUsdPerMTok: r.cacheRead,
        confirmedAt: null, updatedAt: null, source: 'builtin',
      })
    }
    priceCache = { at: Date.now(), byModel: builtinOnly }
    return builtinOnly
  }

  const byModel = new Map<string, ModelPrice>()

  // Published rates first, so every known model is priced with nothing
  // entered anywhere.
  for (const [model, r] of Object.entries(BUILTIN_RATES)) {
    byModel.set(model, {
      model,
      provider: r.provider,
      inputUsdPerMTok: r.input,
      outputUsdPerMTok: r.output,
      cacheWriteUsdPerMTok: r.cacheWrite,
      cacheReadUsdPerMTok: r.cacheRead,
      confirmedAt: null,
      updatedAt: null,
      source: 'builtin',
    })
  }

  // A stored rate replaces the published one. Only a row with an input rate
  // counts as an override: the seeded rows are deliberately empty, and an
  // empty row must not blank out a working published rate.
  for (const r of data ?? []) {
    if (r.input_usd_per_mtok === null) continue
    const fallback = builtinRate(r.model)
    byModel.set(r.model, {
      model: r.model,
      provider: r.provider as Provider,
      inputUsdPerMTok: Number(r.input_usd_per_mtok),
      outputUsdPerMTok: r.output_usd_per_mtok === null ? (fallback?.output ?? null) : Number(r.output_usd_per_mtok),
      cacheWriteUsdPerMTok: r.cache_write_usd_per_mtok === null ? (fallback?.cacheWrite ?? null) : Number(r.cache_write_usd_per_mtok),
      cacheReadUsdPerMTok: r.cache_read_usd_per_mtok === null ? (fallback?.cacheRead ?? null) : Number(r.cache_read_usd_per_mtok),
      confirmedAt: r.confirmed_at ?? null,
      updatedAt: r.updated_at ?? null,
      source: 'override',
    })
  }

  priceCache = { at: Date.now(), byModel }
  return byModel
}

/** Drop the cached rate card, so an edit shows up on the next call. */
export function invalidatePriceCache() { priceCache = null }

/**
 * Cost in USD, or null when the rate card cannot price it.
 *
 * Only the rates that are actually needed matter: a missing cache-read rate
 * is irrelevant to a call that read nothing from cache, so it does not make
 * the whole row unpriced.
 */
export function computeCost(price: ModelPrice | undefined, t: TokenCounts): number | null {
  if (!price) return null
  const parts: [number, number | null][] = [
    [t.inputTokens ?? 0, price.inputUsdPerMTok],
    [t.outputTokens ?? 0, price.outputUsdPerMTok],
    [t.cacheWriteTokens ?? 0, price.cacheWriteUsdPerMTok],
    [t.cacheReadTokens ?? 0, price.cacheReadUsdPerMTok],
  ]
  let total = 0
  for (const [tokens, rate] of parts) {
    if (tokens === 0) continue
    if (rate === null) return null      // needed and missing — unpriced
    total += (tokens / 1_000_000) * rate
  }
  return total
}

/* ── recording ───────────────────────────────────────────── */

/**
 * Record one API call. Never throws, never awaited by callers.
 *
 * Deliberately one insert per call rather than a batch flushed at the end of
 * the request: the chat route streams, so there is no single moment when a
 * request is known to be finished, and a buffer flushed at the wrong time
 * loses exactly the rows for the slowest questions. One small insert while
 * the request is still running is the reliable version.
 */
export function recordUsage(args: {
  provider: Provider
  model: string
  operation: Operation | string
  tokens: TokenCounts
  /** Overrides the ambient context, for callers that know better. */
  context?: UsageContext
}): void {
  void (async () => {
    try {
      const ctx = args.context ?? currentUsageContext()
      const t = args.tokens
      const anyTokens = (t.inputTokens ?? 0) + (t.outputTokens ?? 0)
        + (t.cacheWriteTokens ?? 0) + (t.cacheReadTokens ?? 0)
      // A call that reported nothing is not worth a row; it is almost always
      // a provider error path that never billed anything.
      if (anyTokens === 0) return

      const prices = await getModelPrices()
      const cost = computeCost(prices.get(args.model), t)

      const { error } = await svc().from('model_usage').insert({
        tenant_id:          ctx.tenantId ?? null,
        user_id:            ctx.userId ?? null,
        tenant_label:       ctx.tenantLabel ?? null,
        provider:           args.provider,
        model:              args.model,
        operation:          args.operation,
        input_tokens:       t.inputTokens ?? 0,
        output_tokens:      t.outputTokens ?? 0,
        cache_write_tokens: t.cacheWriteTokens ?? 0,
        cache_read_tokens:  t.cacheReadTokens ?? 0,
        cost_usd:           cost,
      })
      if (error && !warnedMissingUsage) {
        warnedMissingUsage = true
        console.warn(`[usage] could not record usage (${error.message}) — has migration 049 run?`)
      }
    } catch {
      // Swallowed on purpose. See the header: accounting must not break the
      // thing it measures.
    }
  })()
}

/* ── reading the providers' own numbers ───────────────────── */

/** Anthropic's `usage` block from /v1/messages. */
export function anthropicTokens(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    inputTokens:      n(u.input_tokens),
    outputTokens:     n(u.output_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    cacheReadTokens:  n(u.cache_read_input_tokens),
  }
}

/**
 * OpenAI's `usage` block from /v1/chat/completions and /v1/embeddings.
 *
 * `prompt_tokens` already includes anything served from their prompt cache,
 * and `cached_tokens` is reported separately inside prompt_tokens_details —
 * so it is subtracted out rather than added, or the input would be counted
 * twice.
 */
export function openaiTokens(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>
  const cached = n(details.cached_tokens)
  const prompt = n(u.prompt_tokens)
  return {
    inputTokens:     Math.max(0, prompt - cached),
    outputTokens:    n(u.completion_tokens),
    cacheReadTokens: cached,
  }
}
