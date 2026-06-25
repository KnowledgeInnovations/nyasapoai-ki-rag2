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

import { getAnthropicHeaders, CLAUDE_MODEL } from './claude'
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

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

async function callClaude(system: string, messages: AnthropicMessage[], timeoutMs: number, forceFinalAnswer = false): Promise<{
  content: AnthropicContentBlock[]
  stop_reason: string
}> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      temperature: 0,
      system,
      ...(forceFinalAnswer ? { tool_choice: { type: 'none' } } : { tools: AGENT_TOOLS }),
      messages,
    }),
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  })
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`)
  return res.json()
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
}): Promise<AgenticAnswerResult> {
  const deadline = opts.deadline ?? Date.now() + DEFAULT_LOOP_DEADLINE_MS
  const messages: AnthropicMessage[] = [
    ...(opts.history ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  const toolCalls: AgenticToolCallLog[] = []

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const remaining = deadline - Date.now()
    const response = await callClaude(opts.systemPrompt, messages, Math.min(DEFAULT_TIMEOUT_MS, remaining))

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
      const finalResponse = await callClaude(opts.systemPrompt, messages, Math.max(5000, deadline - Date.now()), true)
      return { answerText: textOf(finalResponse.content), toolCalls, iterations: iteration, hitIterationCap: true }
    }
  }

  // Unreachable (loop always returns), but keeps TypeScript satisfied.
  return { answerText: '', toolCalls, iterations: MAX_ITERATIONS, hitIterationCap: true }
}
