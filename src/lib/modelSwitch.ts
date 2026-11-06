/**
 * The off switch for the AI models.
 *
 * An owner needs to be able to stop the models running — right now, across
 * every workspace, without a deploy — and turn them back on the same way.
 * That is the whole job of this file.
 *
 * Three decisions worth knowing about:
 *
 * 1. **Two switches, not one.** Document processing and question answering
 *    fail very differently. Stopping processing pauses a background cost
 *    nobody is waiting on; stopping answers takes the product away from
 *    every user in every workspace. Keeping them separate means "stop
 *    spending money on extraction while we choose a model" does not have to
 *    mean "take the product down". Turning both off is still one click.
 *
 * 2. **It fails ON.** A missing row, an unreachable database, a malformed
 *    value — all read as enabled. The alternative is a Supabase hiccup
 *    silently disabling the product for everyone, which is a far worse
 *    outage than the one this protects against. Off is a deliberate state
 *    that a row has to assert.
 *
 * 3. **It is checked late, not early.** The check sits next to the provider
 *    call rather than at the top of a request, so there is no path that
 *    reaches Anthropic or OpenAI by going around it. Routes also check
 *    early, but only to produce a readable message — the guarantee is here.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'

export type ModelArea = 'training' | 'chat'

const KEY: Record<ModelArea, string> = {
  training: 'ai_training_enabled',
  chat:     'ai_chat_enabled',
}

export interface ModelSwitches {
  training: boolean
  chat: boolean
  /** False when the switches could not be read and both defaulted to on. */
  known: boolean
}

const ALL_ON: ModelSwitches = { training: true, chat: true, known: false }

/**
 * Five seconds.
 *
 * A kill switch that takes five minutes to take effect is not a kill
 * switch; someone watching a bill climb will click it and then watch it
 * keep climbing. Five seconds is short enough to feel immediate and long
 * enough that a batch of forty excerpt calls shares one lookup.
 */
const TTL_MS = 5_000

let cache: { at: number; value: ModelSwitches } | null = null
let warned = false

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Accepts true, "true" and 1 — a jsonb column read back by three clients. */
function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string')  return v.toLowerCase() !== 'false'
  if (typeof v === 'number')  return v !== 0
  return true
}

export async function getModelSwitches(force = false): Promise<ModelSwitches> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value

  try {
    const { data, error } = await svc()
      .from('platform_settings')
      .select('key, value')
      .in('key', [KEY.training, KEY.chat])

    if (error) throw new Error(error.message)

    const byKey = new Map((data ?? []).map(r => [r.key, r.value]))
    const value: ModelSwitches = {
      // A key that is absent has never been set, which is on.
      training: byKey.has(KEY.training) ? truthy(byKey.get(KEY.training)) : true,
      chat:     byKey.has(KEY.chat)     ? truthy(byKey.get(KEY.chat))     : true,
      known:    true,
    }
    cache = { at: Date.now(), value }
    warned = false
    return value
  } catch (e) {
    // Said once, not once per model call. See the header: this path keeps
    // the models running on purpose.
    if (!warned) {
      warned = true
      console.warn(`[modelSwitch] could not read the AI switches (${(e as Error).message}) — treating both as ON. Has migration 050 run?`)
    }
    // Cached too, briefly: a database that is down will be down for the
    // next call as well, and hammering it from every model call does not
    // help it recover.
    cache = { at: Date.now(), value: ALL_ON }
    return ALL_ON
  }
}

/** Drop the cache so a flip of the switch is visible on the next call. */
export function invalidateModelSwitchCache() { cache = null }

export async function isModelEnabled(area: ModelArea): Promise<boolean> {
  return (await getModelSwitches())[area]
}

/**
 * Raised instead of calling a provider while that area is switched off.
 *
 * A distinct class, so the pipeline's error handling can tell "an owner
 * turned this off" apart from "the call failed" — the first must not be
 * retried, must not be reported as a degraded step, and must not be
 * described to a user as a problem with their document.
 */
export class ModelsDisabledError extends Error {
  readonly modelsDisabled = true
  readonly area: ModelArea
  constructor(area: ModelArea) {
    super(area === 'training'
      ? 'Document processing by AI is currently switched off by the Nyansa AI administrator. Your documents are safe and will be processed once it is switched back on.'
      : 'AI answering is currently switched off by the Nyansa AI administrator. Please try again shortly.')
    this.name = 'ModelsDisabledError'
    this.area = area
  }
}

export function isModelsDisabledError(e: unknown): boolean {
  return (e as { modelsDisabled?: boolean })?.modelsDisabled === true
}

/** Throws ModelsDisabledError when that area is switched off. */
export async function assertModelEnabled(area: ModelArea): Promise<void> {
  if (!(await isModelEnabled(area))) throw new ModelsDisabledError(area)
}

/** The message to show a user, or null when the area is running. */
export async function modelDisabledMessage(area: ModelArea): Promise<string | null> {
  return (await isModelEnabled(area)) ? null : new ModelsDisabledError(area).message
}
