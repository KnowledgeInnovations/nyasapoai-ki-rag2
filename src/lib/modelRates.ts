/**
 * Built-in published rates, so usage costs something without anyone typing a
 * number in.
 *
 * These are the providers' list prices in US dollars per million tokens. They
 * are the default for every model; a row in `model_prices` overrides one when
 * the rate you are actually charged differs — a negotiated rate, credits, or
 * a provider price change that this file has not caught up with yet.
 *
 * Two honest limits of this approach:
 *
 *   - These are LIST prices. They match your invoice when you are billed at
 *     standard rates, which is the normal case for a Console account, and do
 *     not when you are not. The page says which rate it used, so a figure
 *     that looks wrong can be traced to the rate behind it.
 *   - Prices change, and a constant in a file does not. Whenever this is
 *     wrong it is wrong silently, so the date below matters: the page shows
 *     it, and an old date is the signal to check.
 *
 * Cache columns: Anthropic bills prompt-cache writes above and reads well
 * below the input rate, so they are separate or the cost is wrong in both
 * directions. Where a provider publishes the cache-read rate directly it is
 * used as published; where it does not, the standard multipliers apply
 * (writes 1.25x input, reads 0.1x input) and the entry is marked derived.
 */

export interface BuiltinRate {
  provider: 'anthropic' | 'openai'
  /** USD per million tokens. Null where the model has no such dimension. */
  input: number
  output: number | null
  cacheWrite: number | null
  cacheRead: number | null
  /** True where a cache rate is the standard multiple rather than published. */
  cacheDerived?: boolean
}

/**
 * Last checked against the providers' own published pricing on this date.
 * Shown on the usage page so a stale rate card is visible rather than
 * assumed current.
 */
export const RATES_AS_OF = '2026-11-06'

export const BUILTIN_RATES: Record<string, BuiltinRate> = {
  /* ── Anthropic ─────────────────────────────────────────────
   * Cache reads are published for the 5-series; the 4-series entries use the
   * standard multipliers and are marked as derived.
   */
  'claude-opus-5-5':   { provider: 'anthropic', input: 4.00, output: 20.00, cacheWrite: 5.00,  cacheRead: 0.20 },
  'claude-sonnet-5-5': { provider: 'anthropic', input: 2.00, output: 10.00, cacheWrite: 2.50,  cacheRead: 0.20 },
  'claude-haiku-5-5':  { provider: 'anthropic', input: 0.10, output: 0.50,  cacheWrite: 0.125, cacheRead: 0.01, cacheDerived: true },

  // In use today.
  'claude-opus-4-8':   { provider: 'anthropic', input: 5.00, output: 25.00, cacheWrite: 6.25,  cacheRead: 0.50, cacheDerived: true },
  'claude-sonnet-4-6': { provider: 'anthropic', input: 3.00, output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30, cacheDerived: true },

  /* ── OpenAI ────────────────────────────────────────────────
   * No prompt-cache write charge; cached input is published directly.
   */
  'gpt-4o-mini':            { provider: 'openai', input: 0.15, output: 0.60, cacheWrite: null, cacheRead: 0.075 },
  'text-embedding-3-small': { provider: 'openai', input: 0.02, output: null, cacheWrite: null, cacheRead: null },
}

/** The published rate for a model, or undefined if this file has never heard of it. */
export function builtinRate(model: string): BuiltinRate | undefined {
  return BUILTIN_RATES[model]
}
