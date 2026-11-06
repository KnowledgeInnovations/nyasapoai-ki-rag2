# Open defects and unmeasured questions — Nyansa AI

> Written 2026-11-06, for an AI coding agent working in this repository.
> Every number below was measured on this date against the live database.
> Numbers decay; re-measure before trusting one, and say so if it has moved.
>
> Companion to `docs/ENGINE_UPGRADE_PROMPT.md`, which covers the engine
> workstreams. This covers what is actually broken.

Read `AGENTS.md` first: this is Next.js 16 with breaking changes, and the
relevant guide in `node_modules/next/dist/docs/` comes before any Next code.

## Ground rules

1. **Measure, don't assert.** `scripts/extraction_probe.mts` for extraction,
   `scripts/golden_run.mts` for correctness, and
   `scripts/answer_cost_probe.mts` for latency and real spend. Record before
   and after. "Looks better" is not a result, and a measured negative result
   is a successful outcome — say so with the numbers and revert.
2. **Never delete or mutate tenant data.** Anything written into
   `supabase/migrations/` reaches the live database quickly, so write it
   additive, idempotent and guarded. Verify a backfill by reading rows back.
3. **Test locally with `npm run dev` before pushing.** App routes serve on a
   tenant subdomain (`sub.localhost:3000`); the platform admin area serves
   on the root host. `next dev` moves to 3001/3002 when the port is taken —
   both probes take `--base`.
4. **Any new provider call must pass the off switch and record its usage.**
   `assertModelEnabled` / `isModelEnabled` from `src/lib/modelSwitch.ts`
   before the request leaves, and `recordUsage` from `src/lib/usage.ts`
   after. An ungated call site escapes a control an owner believes stopped
   everything. `claudeComplete` does both already; a direct `fetch` does not.
5. **Spending money is a decision, not a step.** Every probe run costs real
   money (~$0.08 per question on the agentic path). Get the owner's approval
   for a measurement budget before a sweep, and report what it cost.

---

## 1. Documents never finish being read (highest priority)

This is the defect behind the complaint that started this work. A workspace
owner saw eight documents badged with warnings and asked for the AI to be
turned off. The badge was separately wrong and is fixed. This is the part
that is still real.

Fact extraction runs against a wall-clock budget, gets as far as it gets,
writes how many excerpts remain, and is supposed to be finished by the
nightly job. Measured today:

```
Data Nyansa  Q3-2025-TV-DATA        10/10 queued  attempts=1  last=03:00 today  age=2.5d
Data Nyansa  HR_Training_Dataset    63/89 queued  attempts=0  last=never        age=2.4d
Data Nyansa  Q4-2024-FM-DATA        43/67 queued  attempts=0  last=never        age=2.5d
Data Nyansa  FM-LIST-2022           42/79 queued  attempts=0  last=never        age=2.5d
Data Nyansa  Q4-2023-FM-DATA        31/55 queued  attempts=0  last=never        age=2.5d
```

Four have never been touched in two and a half days. The one that was
touched made no progress at all — still 10 of 10 queued after its attempt.
The documents are usable and searchable; they are also incomplete, and
answers that count or list things across them will be wrong in a way
nothing surfaces.

Why, structurally — verify each before fixing, they are read off the code
and not off a running cron:

- `vercel.json` schedules `/api/cron/auto-reprocess-documents` **once a day**.
- That one invocation has `maxDuration = 300` and processes `BATCH_SIZE = 5`
  documents **in turn**, draining each retrain's SSE stream to completion.
  A single `/train` pass can itself use 240s. One document can consume the
  whole slot.
- The same invocation first runs the orphaned-file sweep and the billing
  job, before any document is touched.
- `MAX_AUTO_REPROCESS_ATTEMPTS = 3`. A document that needs four passes is
  abandoned permanently, still incomplete, with nothing saying so.
- `COOLDOWN_HOURS = 6` is moot against a daily schedule.

What to work out, in this order:

1. **Why did the one attempt make no progress?** Q3-2025-TV-DATA went from
   10 of 10 queued to 10 of 10 queued. Before changing any scheduling,
   establish whether `extract-facts` is making headway at all or failing
   silently. If a pass can return having checked nothing, that is the bug
   and the scheduling is a distraction.
2. **A budget-exhausted pass is progress, not a failure.** It should not
   consume one of three attempts the way a genuine failure does. Separate
   the two counters: attempts that made no progress are the ones worth
   capping.
3. **Nothing should be abandoned while incomplete and silent.** If a
   document gives up, the workspace's Senior users should know — the
   machinery already exists in `src/lib/trainingAlerts.ts`.
4. **Then scheduling.** More frequent invocations, or one document per
   invocation, or a cron slot of its own. Note that cron allowance depends
   on the hosting plan; check what the current plan permits rather than
   assuming.

Definition of done: the five documents above reach zero queued excerpts,
confirmed by reading the rows back, and a newly uploaded large document
reaches zero without anyone clicking anything.

## 2. Nothing here can be measured yet

The engine brief's first rule is "measure, don't assert", and the
measurement available does not support it.

- **The only golden set reachable is 4 questions, and it already scores
  4 of 4.** Correctness cannot move, so it detects large regressions and
  nothing else. Ghana AI Summit has 22 questions and Devtraco 10, but both
  are customer accounts and generating a session for one invalidates that
  customer's pending auth tokens — do not do it without the owner's
  agreement.
- **`golden_run.mts` measures a path no user takes.** It omits `agentic`,
  the chat route defaults it to false, and the UI always sends true. Every
  golden number recorded before 2026-11-06 is from the non-agentic path.
  `scripts/answer_cost_probe.mts` sends it correctly; `golden_run.mts`
  should too, and the historical numbers should be understood as measuring
  something else.

The highest-value work here is a real golden set — more questions, harder
questions, on a workspace the team controls — because every other change in
both briefs is unverifiable without one. Build it against documents whose
answers can be checked by hand, and include questions whose correct answer
is "the documents do not say".

## 3. Confidence is badly calibrated on the agentic path

Measured on the same four questions, agentic, all four answers correct:

```
confidence reported:  28%, 30%, 45%, 64%, 83%, 91%, 93%, 95%
```

Correct answers reported 28% and 30%. Confidence is shown to users and
drives the dashboard, so a correct answer wearing 28% teaches people to
distrust answers that deserve trust — the same failure mode as a warning
badge on a healthy document, one layer up.

Also unmeasured and worth settling: **is the agentic path better at all?**
On this set it costs about 25% more per question ($0.084 vs $0.067), is
slower, and scores the same 4 of 4 with worse calibration. That is four
questions and proves nothing on its own. It is a real question with a real
bill attached, and it needs the golden set from item 2 before it can be
answered.

## 4. One event is recorded as a hundred warnings

When fact extraction runs out of budget, each remaining in-flight call
reports its own expiry. The per-call allowance shrinks toward a 1s floor as
the deadline approaches (deliberately — see `DeadlineExceededError` in
`src/lib/claude.ts`), so the tail of a run produces a long run of
near-identical rows:

```
120x  generic_facts_resume   Time allowance of 1s for this call expired before the model responded.
 74x  generic_facts_fallback Time allowance of 1s for this call expired before the model responded.
```

One cause, two hundred rows, stored per document and read by the admin UI.
Collapse them at the point of writing: one warning per cause per run, with
a count. The budget-exhausted summary that already exists is the useful
record; these are its shrapnel.

## 5. Email still runs on the fragile path

- **`RESEND_API_KEY` is unset**, so mail goes over Microsoft 365 SMTP.
  Measured under a 50-message burst: every message arrived, but 29 of 50
  needed a retry against `432 4.3.2 Concurrent connections limit exceeded`,
  and the slowest took 61.3s. `maxDuration` on the hook is now 300s so
  nothing is cut off, but the contention is real and Resend removes it.
- **The Supabase email rate limit is about 30/hour.** A workspace inviting
  a team of forty hits it.
- **`linktest@nyansaai.com` exists** from a deep test on 2026-11-05 and
  should be removed once someone confirms it is not referenced.

## 6. Still open from the engine brief

- **Workstream 3, the reranker.** `src/lib/rerank.ts` scores candidates with
  a single `gpt-4o-mini` call as a stopgap. Evaluating a real cross-encoder
  needs a Cohere/Jina key, which is a spending decision for the owner, not a
  code change. Do not sign the project up for an API without asking.
- **Workstream 4, ingestion depth.** Untouched. `extraction_probe.mts`
  needs its corpus, and `scripts/extraction_corpus.json` names files that
  are not in the repository — they are downloadable from the URLs in the
  manifest. Treat downloaded files as untrusted input: own directory, read
  by path, never execute anything from alongside them.
- **Workstream 1, the model upgrade.** The owner is deciding which model to
  use and asked that it not be changed meanwhile. Do not change
  `CLAUDE_MODEL` or `CLAUDE_REASONING_MODEL` without being told to. When
  told: confirm the current model IDs rather than trusting any written here,
  upgrade, and report golden correctness, latency and cost before and after.

## Definition of done

For each change: the relevant probe numbers before and after, the cost
delta, a local `npm run dev` exercise of the path, and `npx tsc --noEmit`,
`npx eslint` and `npx next build` all clean. Report regressions you caused
and did not fix.

## Do not

- Do not flip the AI switches on `/admin/tenants`. They stop every
  workspace at once and belong to the owner.
- Do not generate auth links for customer accounts. Only the most recently
  issued email token per user is valid, whatever its type, so doing so
  invalidates whatever that person was part-way through.
- Do not add a dependency to the auth-email path; a failure there breaks
  sign-in.
- Do not raise `maxConnections` in `src/lib/email.ts`; the ceiling is
  Microsoft's, not ours.
- Do not touch `src/instrumentation.ts` polyfills without understanding
  that `pdf-parse` fails at import time without them.
- Do not widen the agentic loop's deadline. It was tried on 2026-11-06:
  median latency went from 16.8s to 68.2s for the same 4 of 4 answers and
  worse calibration. The reasoning is recorded in `agenticAnswer.ts`.
- Do not raise `MAX_ITERATIONS`. Measured across three runs, the loop
  returns at iteration 1 every time; the cap is not reached.
