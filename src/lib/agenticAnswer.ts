/**
 * Agentic RAG, Day 1: the tool-calling loop itself. Replaces "one fixed
 * retrieve -> generate -> verify sequence" with Claude deciding, turn by
 * turn, whether it has enough to answer or needs to call a tool first
 * (search_documents, lookup_financial_fact, compute_aggregate,
 * verify_figure — see agentTools.ts). Bounded to MAX_ITERATIONS so a
 * confused loop can't run away in cost or latency.
 *
 * Confirmed live (a "Ministry of Energy vs national budget" question that
 * kept refining its search instead of settling): hitting the cap while the
 * model still wants another tool call must NOT just return whatever text
 * happened to be in its last response — that response can be a pure
 * tool_use block with no text at all, returning a BLANK answer to the
 * user, which is worse than not having the agentic loop at all. Instead,
 * the pending tool calls are executed (required — Anthropic's API doesn't
 * allow a dangling tool_use with no tool_result), then one final call is
 * made with tool_choice forced to "none" so the model must synthesize a
 * real answer from everything gathered so far.
 *
 * Deliberately a separate module from chat/route.ts's existing pipeline,
 * not a replacement — see agentTools.ts's header comment for why.
 */

import { getAnthropicHeaders, CLAUDE_REASONING_MODEL, ADAPTIVE_THINKING } from './claude'
import { AGENT_TOOLS, executeAgentTool, type AgentToolContext } from './agentTools'

const MAX_ITERATIONS = 5
const DEFAULT_TIMEOUT_MS = 60000
// chat/route.ts's maxDuration is 90s, but that has to cover retrieval/rerank
// before this runs and a verifyAnswerWithAI pass + persistence after it —
// this loop shouldn't be allowed to consume the whole budget by itself.
// Each per-call AbortSignal timeout below is also clamped to whatever's
// actually left of this, so a single slow call can't blow past it either.
const DEFAULT_LOOP_DEADLINE_MS = 55000

export interface AgenticToolCallLog {
  name: string
  input: Record<string, unknown>
  result: unknown
}

export interface AgenticAnswerResult {
  answerText: string
  toolCalls: AgenticToolCallLog[]
  iterations: number
  hitIterationCap: boolean
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  // Adaptive thinking (Opus 4.8) emits thinking blocks in content. They're
  // pushed back verbatim on the next iteration (messages.push below sends
  // response.content unchanged, which the API requires for tool-use loops) —
  // textOf()/the tool_use filter ignore them via their type guards.
  | { type: 'thinking'; thinking: string; signature?: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

// Streams every call (not just the one we already know is terminal) so the
// common single-iteration case — the model just answers, no tool needed —
// can show text live instead of waiting for the whole loop to finish.
// Whether THIS call turns out to be terminal is only certain once we've
// seen its content blocks: Claude can, in principle, emit a leading text
// block before a tool_use block in the same turn (rare with adaptive
// thinking on, since reasoning normally lives in its own thinking block,
// but not impossible). So text is forwarded live as it streams, and if a
// tool_use block start ever arrives after some text was already forwarded
// THIS call, onRetract fires once so the caller can tell the client to
// discard that speculative text — the loop then continues normally
// (the tool executes, another iteration runs) and the real final answer
// streams fresh afterward. A tool_use block that arrives before any text
// (the common case) needs no retraction: nothing was ever shown.
async function callClaude(
  system: string, messages: AnthropicMessage[], timeoutMs: number, forceFinalAnswer = false,
  onToken?: (token: string) => void,
  onRetract?: () => void,
): Promise<{
  content: AnthropicContentBlock[]
  stop_reason: string
}> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model: CLAUDE_REASONING_MODEL,
      // Opus 4.8 rejects temperature (400) — omitted. Adaptive thinking lets
      // the model reason before/between tool calls; thinking tokens count
      // against max_tokens, hence the raise from the old 1200.
      thinking: ADAPTIVE_THINKING,
      max_tokens: 8000,
      system,
      ...(forceFinalAnswer ? { tool_choice: { type: 'none' } } : { tools: AGENT_TOOLS }),
      messages,
      stream: true,
    }),
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  })
  if (!res.ok || !res.body) throw new Error(`Claude API error ${res.status}: ${await res.text().catch(() => '')}`)

  interface BlockAcc { type: string; text: string; toolName?: string; toolId?: string; inputJson: string; thinking: string; signature?: string }
  const blocks: BlockAcc[] = []
  let stopReason = 'end_turn'
  let sawToolUse = false
  let forwardedText = false

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw) continue
      let evt: {
        type?: string; index?: number
        content_block?: { type: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string; stop_reason?: string }
      }
      try { evt = JSON.parse(raw) } catch { continue }

      if (evt.type === 'content_block_start' && evt.content_block && evt.index != null) {
        const cb = evt.content_block
        blocks[evt.index] = cb.type === 'tool_use'
          ? { type: 'tool_use', toolName: cb.name, toolId: cb.id, inputJson: '', thinking: '', text: '' }
          : { type: cb.type, inputJson: '', thinking: '', text: '' }
        if (cb.type === 'tool_use') {
          if (!sawToolUse && forwardedText) onRetract?.()
          sawToolUse = true
        }
      } else if (evt.type === 'content_block_delta' && evt.delta && evt.index != null) {
        const b = blocks[evt.index]
        const d = evt.delta
        if (d.type === 'text_delta' && d.text) {
          b.text += d.text
          if (!sawToolUse) { onToken?.(d.text); forwardedText = true }
        } else if (d.type === 'input_json_delta' && d.partial_json) {
          b.inputJson += d.partial_json
        } else if (d.type === 'thinking_delta' && d.thinking) {
          b.thinking += d.thinking
        } else if (d.type === 'signature_delta' && d.signature) {
          b.signature = (b.signature ?? '') + d.signature
        }
      } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
        stopReason = evt.delta.stop_reason
      }
    }
  }

  const content: AnthropicContentBlock[] = blocks.filter(Boolean).map(b => {
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.toolId!, name: b.toolName!, input: b.inputJson ? JSON.parse(b.inputJson) : {} }
    if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking, signature: b.signature }
    return { type: 'text', text: b.text }
  })
  return { content, stop_reason: stopReason }
}

function textOf(content: AnthropicContentBlock[]): string {
  return content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n')
}

export async function runAgenticAnswer(opts: {
  systemPrompt: string
  userMessage: string
  toolCtx: AgentToolContext
  // Prior turns (already trimmed/bounded by the caller, same as the
  // non-agentic path's historyMsgs) — without these, a follow-up question
  // ("how does that compare to...") has no idea what "that" refers to,
  // confirmed live: the model said outright "I don't have full context of
  // your previous question" on a multi-turn conversation with this omitted.
  history?: { role: 'user' | 'assistant'; content: string }[]
  // Absolute deadline (epoch ms) — defaults to "now + the loop's own
  // budget" so existing callers (the chat route) don't need to compute one,
  // but a caller closer to its own hard limit (e.g. a future background job
  // with less headroom) can pass a tighter one.
  deadline?: number
  // Called live as text tokens stream in from whichever call turns out to
  // be — or is speculatively assumed to be, see callClaude above — the
  // terminal, user-facing one. Optional: omit for callers that just want
  // the final answerText (e.g. a background job with no live UI to feed).
  onToken?: (token: string) => void
  // Called at most once per call if that call's speculatively-streamed
  // text (already sent via onToken) turned out to belong to a non-final,
  // tool-calling round — the caller should discard whatever it displayed
  // from this call's tokens so far and fall back to a "working" state
  // until the next onToken burst (the real final answer) arrives.
  onRetract?: () => void
}): Promise<AgenticAnswerResult> {
  const deadline = opts.deadline ?? Date.now() + DEFAULT_LOOP_DEADLINE_MS
  const messages: AnthropicMessage[] = [
    ...(opts.history ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const toolCalls: AgenticToolCallLog[] = []

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const remaining = deadline - Date.now()
    const response = await callClaude(opts.systemPrompt, messages, Math.min(DEFAULT_TIMEOUT_MS, remaining), false, opts.onToken, opts.onRetract)

    if (response.stop_reason !== 'tool_use') {
      return { answerText: textOf(response.content), toolCalls, iterations: iteration, hitIterationCap: false }
    }

    const toolUseBlocks = response.content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
    messages.push({ role: 'assistant', content: response.content })

    const toolResults = await Promise.all(toolUseBlocks.map(async block => {
      const result = await executeAgentTool(opts.toolCtx, block.name, block.input)
      toolCalls.push({ name: block.name, input: block.input, result })
      return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
    }))
    messages.push({ role: 'user', content: toolResults as unknown as AnthropicContentBlock[] })

    // Cap hit either by iteration count OR by running low on time budget —
    // either way, the pending tool calls above are already executed
    // (required by the API), so force one final answer instead of starting
    // another full iteration that the deadline can't actually accommodate.
    if (iteration === MAX_ITERATIONS || deadline - Date.now() < 5000) {
      messages.push({ role: 'user', content: 'You must answer now, using everything gathered so far. Do not call any more tools.' })
      // forceFinalAnswer (tool_choice: 'none') means the API can never
      // return a tool_use block here — always safe to stream live, no
      // retraction possible.
      const finalResponse = await callClaude(opts.systemPrompt, messages, Math.max(5000, deadline - Date.now()), true, opts.onToken)
      return { answerText: textOf(finalResponse.content), toolCalls, iterations: iteration, hitIterationCap: true }
    }
  }

  // Unreachable (loop always returns), but keeps TypeScript satisfied.
  return { answerText: '', toolCalls, iterations: MAX_ITERATIONS, hitIterationCap: true }
}
