# Engine advancement brief — Nyansa AI

> Written 2026-11-05, for an AI coding agent working in this repository.
> Hand it over whole; it is a brief, not documentation of current state.
> Facts in it decay — check the "Since this was written" section at the end
> before trusting any specific line number or claim about what exists.

The hosting plan changed from Vercel Hobby to Pro. Functions may now run to
300s; previously every `maxDuration` above 60 was silently capped to 60. A
large part of this engine was shaped around that cap. Your job is to find and
remove the compromises it forced, and to raise answer quality measurably.

## Read first
- `AGENTS.md`: this is Next.js 16 with breaking changes. Read the relevant
  guide in `node_modules/next/dist/docs/` before writing any Next code.
- `src/app/api/chat/route.ts` (2,320 lines) — the answering pipeline.
- `src/lib/ragAnalysis.ts`, `src/lib/factsAnalysis.ts` — the deterministic
  arithmetic layer. Nothing here calls an LLM, by design. Keep it that way.
- `src/lib/agenticAnswer.ts`, `src/lib/agentTools.ts` — the tool-calling loop.
- `src/lib/factExtraction.ts`, `src/lib/tableExtraction.ts`,
  `src/lib/documentProcess.ts` — ingestion.

## Non-negotiable constraints
1. **Measure, don't assert.** Two harnesses already exist and are the only
   acceptable evidence of improvement:
   - `scripts/extraction_probe.mts` with `scripts/extraction_corpus.json`
     — run before and after ANY extraction change.
   - `scripts/golden_run.mts` with the `golden_seed*.json` files — run
     before and after ANY answering change.
   Record both numbers in the PR. "Looks better" is not a result.
2. **Never delete or mutate tenant data.** Anything in `supabase/migrations/`
   reaches the live database quickly, so write it defensively: additive,
   idempotent, guarded. Verify a backfill by reading rows back, and check
   that any guard clause can actually match.
3. **Test locally with `npm run dev` before pushing**, not after deploying.
   Multi-tenant routes are host-dependent: app routes serve only on a tenant
   subdomain (`sub.localhost:3000`), and the platform admin area serves only
   on the root host (`localhost:3000`).
4. **Keep the deterministic layer deterministic.** The engine's value is that
   numbers come from arithmetic over extracted facts and are verified against
   source chunks afterwards. Do not replace computation with model output.
5. **Cost is a measured quantity.** Model upgrades and higher iteration caps
   raise per-question spend. Every provider call now records the tokens the
   provider itself reported, priced from `src/lib/modelRates.ts`, visible
   per workspace on `/admin/usage`. So the cost delta is observable, not
   estimated — measure it and report it alongside the quality delta.
6. **A new model call must be reachable by the off switch.** Every call to
   Anthropic or OpenAI passes `assertModelEnabled` / `isModelEnabled` from
   `src/lib/modelSwitch.ts` before the request leaves. An ungated call site
   silently escapes a control an owner believes stopped everything. For
   `claudeComplete` this is automatic via the operation name; a direct
   `fetch` to a provider must add the check itself.
7. **Record usage on any new call site.** `recordUsage` from
   `src/lib/usage.ts`, with the provider's own token counts. It is
   fire-and-forget and cannot fail the call.

## Workstream 1 — models are a generation behind (highest leverage)
`src/lib/claude.ts` pins `CLAUDE_MODEL = 'claude-sonnet-4-6'` and
`CLAUDE_REASONING_MODEL = 'claude-opus-4-8'`. The current family is Claude 5:
`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`.

Confirm the current model IDs before editing — do not take the names above
on trust, they age. Then upgrade and re-run `golden_run.mts` and
`extraction_probe.mts`. Check
`ADAPTIVE_THINKING` and `getAnthropicHeaders` still apply to the new models,
and whether any beta header is now unnecessary. Expect prompt behaviour to
shift: verify the hallucination-prevention instructions still hold, because
several comments in `ragAnalysis.ts` record the model correctly declining to
answer when nothing backed a figure. That behaviour must survive.

## Workstream 2 — spend the time budget Pro unlocked
- `api/chat/route.ts` is `maxDuration = 90`. Raise it toward 300 and widen
  what the pipeline can afford: more retrieval candidates before rerank, a
  second retrieval pass on low-confidence answers, more verification.
- `agenticAnswer.ts` has `MAX_ITERATIONS = 5`, chosen against a tight budget.
  Raise it and measure where the quality curve flattens. Keep the
  forced-synthesis path at the cap: a `tool_use` block with no text must
  never be returned to a user as a blank answer.
- Lower-value routes (`contact` 20s, `dashboard/*` 30s) are fine as they are.
  Do not raise numbers without a reason.

## Workstream 3 — replace the stopgap reranker
`src/lib/rerank.ts` scores candidates 0–10 with a single `gpt-4o-mini` call.
Its own header says a real cross-encoder (Cohere/Jina/BGE) was never wired up
because it needed a separate paid-API decision, and that it stays on OpenAI
to avoid the Claude org's 10k input-tokens/min limit. With a larger time
budget, evaluate a real reranker against the current one on the golden set.
Report precision at the cut-off, latency and cost. If it does not beat the
current pass on the golden set, keep the current pass and say so.

## Workstream 4 — ingestion depth
- `tableExtraction.ts` reconstructs table grids from raw glyph positions
  because `pdfjs-dist` does not detect them. Measure its failure modes
  against `extraction_corpus.json` and improve the worst-performing shape.
- `visionExtraction.ts` exists for what text extraction cannot read. With
  300s, determine how many pages can be processed within budget and whether
  routing more documents through it improves extraction scores.
- `genericFactExtraction.ts` has several comments about operations that
  "could exceed the training route's maxDuration". Re-examine each now that
  the ceiling is real, and remove any limit that only existed for the cap.

## Workstream 5 — verified functional gaps
These are confirmed defects, not ideas:
1. **An existing user cannot be invited into a second workspace.**
   `src/app/api/users/route.ts:117` calls `inviteUserByEmail` unconditionally.
   Supabase refuses when the email already has an identity anywhere, so the
   route returns 500 and never reaches the membership insert three lines
   below. Add the branch: already a member → say so; account exists but not a
   member → insert the membership and send a sign-in link; no account →
   invite as today. Keep the seat-limit and email-domain checks above it.
2. **Auth email tokens interfere across types.** Measured: for one user only
   the most recently issued email token is valid, whatever its type. A
   password reset invalidates a pending invite and vice versa. The footnote in
   `src/lib/authEmailTemplates.ts` says "if you request another, it replaces
   this one", which reads as same-type resends only. Make it accurate.

## Definition of done
For each change: the two harness numbers before and after; the cost delta; a
local `npm run dev` exercise of the affected path; `npx tsc --noEmit`,
`npx eslint`, and `npx next build` all clean. Report regressions you caused
and did not fix. If a workstream turns out not to help, say so with the
numbers — a measured negative result is a successful outcome here.

## Do not
- Do not add a dependency to the auth-email path; a dependency there can
  break sign-in.
- Do not raise the email pool's `maxConnections` in `src/lib/email.ts`; the
  ceiling is Microsoft's, not ours.
- Do not touch `src/instrumentation.ts` polyfills without understanding that
  `pdf-parse` fails at import time without them.
- Do not change the 10-minute step-up code TTL in `src/lib/emailMfa.ts`
  without an explicit decision: it proves presence now, not yesterday.

## Since this was written

Changes landed after the brief was drafted. They do not alter the
workstreams; they change the ground a few of them stand on.

- **Spend is measured, not estimated.** `model_usage` (migration 049) holds
  one row per provider call with the tokens the provider reported.
  `src/lib/modelRates.ts` carries the published rates, so nothing has to be
  entered for a cost to appear. `/admin/usage` shows it per workspace, per
  model and per operation. This replaces the flat per-question assumption
  the brief refers to.
- **There is an AI off switch.** `platform_settings` (migration 050), two
  keys, read at request time, flipped from `/admin/tenants`. Document
  processing and answering stop independently. Constraint 6 above is the
  obligation this creates for new code.
- **Document status has one definition.** `src/lib/documentStatus.ts`. A
  `processing_warnings` entry with `level: 'note'` records a step that
  SUCCEEDED and must never be displayed as a warning; queued fact
  extraction is "still reading", not a degradation. Both pages use this
  helper — do not reintroduce a second rule.
- **Workstream 5 is still open.** Neither defect has been fixed: the invite
  branch at `src/app/api/users/route.ts` and the email-expiry wording in
  `src/lib/authEmailTemplates.ts`. Line numbers may have moved; the
  descriptions still hold.
- `api/auth/send-email-hook` is now `maxDuration = 300`, after a measured
  burst showed the slowest of 50 concurrent sends finishing at 61.3s
  against the old 60s ceiling. Workstream 2's point about the cap is real
  and this is one instance of it already corrected.
