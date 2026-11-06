# Open defects, and the classes they belong to — Nyansa AI

> Written 2026-11-06, for an AI coding agent working in this repository.
> Every number below was measured on that date against the live database.
> Numbers decay; re-measure before trusting one, and say so if it moved.
>
> Companion to `docs/ENGINE_UPGRADE_PROMPT.md`, which covers what could be
> better. This covers what is wrong.

Read `AGENTS.md` first: this is Next.js 16 with breaking changes, and the
relevant guide in `node_modules/next/dist/docs/` comes before any Next code.

## How to use this document

Every defect here is an instance of something more general, and the general
thing is the point. Each item is written in four parts:

- **Evidence** — what was measured, and when.
- **The class** — the kind of mistake it is.
- **The audit** — find every other place in the repository that has it.
- **The guard** — make it unable to come back.

**Fixing the instance alone is not done.** A fix that repairs one badge, one
cron or one call site leaves the next one for somebody to rediscover in
production, which is how every item on this list arrived here. Where an
audit turns up nothing, say so — "audited, no other instances" is a result
worth recording, and it stops the next agent repeating the search.

Guards matter most, because they are the only part that survives you. This
repository has **no test runner** — `npm run lint` is eslint and that is
all, and there is no CI workflow. So a guard here means one of:

1. an eslint rule in `eslint.config.mjs` (flat config; `no-restricted-syntax`
   and `no-restricted-imports` scoped with `files` covers most of what is
   needed below),
2. a check script under `scripts/` that exits non-zero, wired into
   `package.json` so it can be run deliberately,
3. a structural change that makes the mistake unexpressible — a single
   chokepoint, a narrower type — which is better than either.

Prefer 3, settle for 1, use 2 when neither fits. Do not propose a guard
that needs a test runner without first saying that one has to be added.

## Ground rules

1. **Measure, don't assert.** `scripts/extraction_probe.mts` for extraction,
   `scripts/golden_run.mts` for correctness, `scripts/answer_cost_probe.mts`
   for latency and real spend. Record before and after. A measured negative
   result is a successful outcome — report it with the numbers and revert.
2. **Never delete or mutate tenant data.** Anything written into
   `supabase/migrations/` reaches the live database quickly, so write it
   additive, idempotent and guarded. Verify a backfill by reading rows back.
3. **Test locally with `npm run dev` before pushing.** App routes serve on a
   tenant subdomain (`sub.localhost:3000`); the platform admin area serves on
   the root host. `next dev` moves to 3001/3002 when the port is taken — both
   probes take `--base`.
4. **Any new provider call must pass the off switch and record its usage.**
   See item 5; this is the rule that item exists to make unbreakable.
5. **Spending money is a decision, not a step.** Every probe run costs real
   money (~$0.08 per question on the agentic path). Get the owner's approval
   for a measurement budget before a sweep, and report what it cost.

---

## 1. Documents never finish being read

The defect behind the complaint that started this work. A workspace owner
saw eight documents badged with warnings and asked for the AI to be switched
off. The badge was separately wrong and is fixed. This part is still real.

Fact extraction runs against a wall-clock budget, gets as far as it gets,
records how many excerpts remain, and relies on the nightly job to finish.

**Evidence** (2026-11-06, live):

```
Data Nyansa  Q3-2025-TV-DATA        10/10 queued  attempts=1  last=03:00 today  age=2.5d
Data Nyansa  HR_Training_Dataset    63/89 queued  attempts=0  last=never        age=2.4d
Data Nyansa  Q4-2024-FM-DATA        43/67 queued  attempts=0  last=never        age=2.5d
Data Nyansa  FM-LIST-2022           42/79 queued  attempts=0  last=never        age=2.5d
Data Nyansa  Q4-2023-FM-DATA        31/55 queued  attempts=0  last=never        age=2.5d
```

Four never touched in two and a half days. The one attempt that did run made
no progress at all — ten of ten queued before, ten of ten after. The
documents are searchable; they are also incomplete, and answers that count
or list across them are wrong in a way nothing surfaces.

Structural reasons, read off the code and **to be verified against a real
run, not taken from here**:

- `vercel.json` schedules `/api/cron/auto-reprocess-documents` once a day.
- That invocation has `maxDuration = 300` and processes `BATCH_SIZE = 5`
  documents **in turn**, draining each SSE stream to completion, while a
  single `/train` pass can use 240s by itself.
- The same invocation runs the orphaned-file sweep and the billing job
  first, before any document is touched.
- `MAX_AUTO_REPROCESS_ATTEMPTS = 3`: a document needing four passes is
  abandoned permanently, incomplete, with nothing saying so.
- `COOLDOWN_HOURS = 6` is moot against a daily schedule.

Order of work:

1. **Why did the attempt make no progress?** Establish whether
   `extract-facts` is making headway or failing silently. If a pass can
   return having checked nothing, that is the bug and scheduling is a
   distraction.
2. **A budget-exhausted pass is progress, not a failure**, and must not
   consume one of three attempts the way a real failure does. Separate the
   counters: cap attempts that achieved nothing.
3. **Nothing may be abandoned while incomplete and silent.**
   `src/lib/trainingAlerts.ts` already exists for telling Senior users.
4. **Then scheduling.** Check what the current hosting plan allows for cron
   frequency rather than assuming.

**The class.** Work that is time-boxed and deferred to a resumer, with no
invariant that the queue ever drains. The pattern appears wherever something
says "the rest continues automatically": nothing checks that it does, and
the failure is invisible because each individual pass reports success.

**The audit.** Every deferred or resumable path, not just this one:
- the crons: `auto-reprocess-documents`, `reap-orphaned-files`, `billing`,
  and anything else under `src/app/api/cron/`;
- every use of `after()` — work scheduled to run after the response is sent
  is killed with the function and leaves no trace when it is;
- `finalize`'s fast-path/background split, and `train`'s equivalent;
- any status text promising that something continues by itself.

For each: what guarantees it finishes, what happens when it does not, and
who finds out.

**The guard.** A platform-wide view of outstanding work — on
`/admin/tenants` beside the AI switch, since that is where someone looks
when they suspect the platform is misbehaving — listing anything incomplete
with its age, plus an alert when a unit of work has been outstanding beyond
a threshold. The specific invariant worth enforcing: **a resumable job must
record progress per pass**, so "ran and achieved nothing" is distinguishable
from "ran and advanced", in storage, without reading logs.

## 2. One rule, implemented twice, disagreeing

**Evidence.** `processing_warnings` holds entries of two kinds. An entry
with `level: 'note'` records a step that SUCCEEDED and is worth logging.
`TrainingClient` filtered on that; `DocumentsClient` counted the array's
length. Four of the owner's eight documents were badged amber for notes
recording success. Fixed by `src/lib/documentStatus.ts`, now used by both.

**The class.** Two things at once, and both recur:

- **A rule about user-facing state implemented independently in more than
  one place.** They agree on the day they are written and diverge silently
  afterwards. Nothing failed here — both pages "worked".
- **Severity inferred from existence.** `list.length > 0` means something
  happened, never that something is wrong. Any code deriving a warning from
  the presence of a record rather than its severity is this bug.

**The audit.** Every derived user-facing state: document status, training
status, workspace/billing status, dashboard health, anything rendering a
badge, colour or icon from data. For each, is the rule in one place, and
does it read severity or merely count? Grep for `.length` feeding a
conditional that chooses a label, colour or icon.

**The guard.** An eslint `no-restricted-syntax` rule forbidding
`processing_warnings` access outside `src/lib/documentStatus.ts`, so a third
implementation cannot be written without deleting the rule — which is a
visible act in review. Generalise it: each derived user-facing state gets
one module, and the rule names it.

## 3. The reason existed and was invisible

**Evidence.** Why a document was badged was available the whole time — in a
`title` attribute. The owner asked "what does ready warnings mean?" and
nobody could answer from the screen. On the four healthy documents
`status_detail` was null, so hovering produced nothing at all.

**The class.** Explanation reachable only by hover. It does not exist on a
phone, it is invisible to anyone scanning, and it cannot be quoted into a
message to a colleague — which is exactly what the owner tried to do.

**The audit.** Every `title=` attribute in `src/components/` that carries
the only copy of an explanation, as opposed to repeating visible text.

**The guard.** A stated rule, since this one does not mechanise well: **if a
state needs explaining, the explanation renders.** A tooltip may repeat what
is visible; it may not be the only place something is said.

## 4. The harness measured a path no user takes

**Evidence.** `golden_run.mts` omits `agentic` from its request body. The
chat route defaults it to `false`. `AskInterface.tsx` always sends `true`.
Every golden number recorded before 2026-11-06 measured the non-agentic
path. The two differ: agentic costs ~25% more per question, is slower, and
carries lower confidence for the same answers.

**The class.** A measurement path whose request differs from production's,
so it measures something real and irrelevant. Made worse by a default that
differs between client and server: the client always overrides it, so the
server's default is only ever exercised by tests.

**The audit.** Every script in `scripts/` that calls an app route, against
what the corresponding component sends. Separately: every request-body
default in an API route that the UI always overrides — each is a path only
tests take.

**The guard.** Harness and UI should build their request from one shared
shape rather than two hand-written object literals. Short of that, a check
script that fails when a harness body omits a field the UI sends.

## 5. A cross-cutting control enforced by convention

**Evidence.** The AI off switch works because ten call sites each remember
to call `assertModelEnabled` first. `recordUsage` is the same: ten sites,
each remembering. Both were added by hand, and an eleventh call site added
next month silently escapes a control an owner believes stopped everything —
and spends money nobody can see.

**The class.** An invariant every call site must remember. Convention
degrades at exactly the moment it matters: when someone unfamiliar adds a
feature under time pressure.

**The audit.** Every direct `fetch` to `api.anthropic.com` or
`api.openai.com`. On 2026-11-06 there were ten, across `chat/route.ts`,
`dashboard/insight`, `dashboard/insights-batch`, `document-search`,
`agenticAnswer.ts`, `agentTools.ts`, `answerVerifier.ts`, `claude.ts`,
`documentProcess.ts` and `rerank.ts`.

**The guard**, in preference order:

1. **One chokepoint.** A `callProvider()` that performs the gate check and
   the usage recording, with every site going through it. Then the rule is
   structural: there is nowhere else to call from. `claudeComplete` is
   already this for the Anthropic non-streaming path; the streaming and
   OpenAI paths have no equivalent.
2. **An eslint rule** banning the provider hostnames as string literals
   outside an allowlist of files, so a new raw call fails lint.

Do both if the refactor is large: the lint rule lands today, the chokepoint
when there is room.

## 6. An API called without checking its preconditions

**Evidence.** `inviteUserByEmail` refuses any address holding an identity
anywhere on the project. `src/app/api/users/route.ts` called it
unconditionally, so adding an existing account to a second workspace
returned 500 and never reached the membership insert three lines below.
Fixed.

**The class.** A platform API with a precondition, called as though it had
none, with the error surfaced raw to a user who cannot act on it. "A user
with this email address has already been registered" is a true sentence and
useless to the admin who read it.

**The audit.** Every `service.auth.admin.*` call, and every third-party
call whose failure depends on existing state rather than on the request:
invite, generate-link, user creation and deletion, Paystack customer and
subscription calls. For each: what state makes it fail, is that state
checked first, and does the user see a sentence they can act on?

**The guard.** A checklist item rather than a rule, and an honest one: when
a call can fail because of state rather than input, handle the state.

## 7. Product copy asserting behaviour nobody verified

**Evidence.** The email footnote said "if you request another, it replaces
this one", which reads as resends of the same type. The measured rule is
broader: one valid token per user across every type, so a password reset
kills a pending invitation. Three links, each valid alone at 70+ minutes,
each dead the moment another was issued for the same person. That is the
real cause of most "link expired" reports. Fixed.

**The class.** User-facing text making a factual claim about how the system
behaves, written from an assumption. It is worse than no text: people act on
it, and support reasons from it.

**The audit.** Every user-facing claim about system behaviour — expiry
windows, seat and plan limits, retention, "only once", "we never", anything
in `src/lib/authEmailTemplates.ts`, marketing pages, settings help text and
error messages. For each: what verified it, and when?

**The guard.** A claim about behaviour carries a comment naming how it was
verified and the date. `LINK_TTL_HOURS` already does this well — it says the
value must be kept equal to the Supabase dashboard setting by hand. Copy
that pattern.

## 8. One event recorded as two hundred warnings

**Evidence.** When fact extraction exhausts its budget, each remaining
in-flight call reports its own expiry. The per-call allowance shrinks toward
a 1s floor as the deadline approaches — deliberate, see
`DeadlineExceededError` in `src/lib/claude.ts` — so the tail of one run
produces:

```
120x  generic_facts_resume    Time allowance of 1s for this call expired before the model responded.
 74x  generic_facts_fallback  Time allowance of 1s for this call expired before the model responded.
```

One cause, two hundred rows, stored per document and read by the admin UI.

**The class.** Unbounded, unaggregated diagnostic writes: appending one
record per event to stored state, with no cap and no deduplication. It
grows a row without limit, buries the one useful entry, and makes a
single incident look like a catastrophe.

**The audit.** `processing_warnings` first, then every other jsonb array or
text column appended to inside a loop or a retry path.

**The guard.** Collapse at the point of writing — one entry per cause per
run, carrying a count — and a hard cap on the array with an explicit "and N
more" entry when it is hit. Put the cap in the write helper, not at each
call site, or this becomes item 5 again.

## 9. Numbers shown as fact without a source

**Evidence.** `/admin/tenants` showed cost from a flat per-question and
per-document assumption, presented identically to a measured figure. It is
now derived from `model_usage` rows. Fixed, and listed because the class is
not.

**The class.** A number rendered to a user with no traceable source. Nobody
can tell derived from measured, so nobody can tell wrong from right.

**The audit.** Every number on an admin or dashboard page: can you name the
row it came from? Anything computed from a constant that was chosen rather
than measured belongs in this category until proven otherwise.

**The guard.** Label it in the UI. The usage page's `builtin` / `override`
badges and its "rates as of" date are the pattern: the figure says what
produced it, so a reader who doubts it can check.

## 10. A score shown to users that nobody validates

**Evidence.** Measured 2026-11-06 on the agentic path, four questions, all
four answers correct:

```
confidence reported: 28%, 30%, 45%, 64%, 83%, 91%, 93%, 95%
```

Correct answers reported 28% and 30%. Confidence is shown to users and
drives the dashboard. A correct answer wearing 28% teaches people to
distrust answers that deserve trust — the same failure as a warning badge on
a healthy document, one layer up.

**The class.** A user-facing score with no calibration measurement. It is
displayed with two significant figures, which asserts a precision nobody has
established.

**The audit.** Every score shown to a user: answer confidence, source
reliability, any percentage on the dashboard. Which has ever been checked
against outcomes?

**The guard.** `golden_run.mts` already reports calibration — was the
confidence deserved — and that output is the right shape. Extend it to the
agentic path and treat a miscalibrated bucket as a failure, not a footnote.

Separately, and needing item 11's golden set first: **is the agentic path
better at all?** On four questions it costs ~25% more ($0.084 vs $0.067 per
question), is slower, and scores the same with worse calibration. Four
questions proves nothing. It is a real question with a real bill attached.

## 11. Measurement cannot support any of this yet

The ground rule is "measure, don't assert", and what is available does not
allow it.

- **The only reachable golden set is 4 questions and already scores 4 of
  4.** Correctness cannot move, so it detects large regressions and nothing
  subtler.
- Ghana AI Summit has 22 questions and Devtraco 10, but both are customer
  accounts, and generating a session for one invalidates that customer's
  pending auth tokens. Do not, without the owner's agreement.

Build a real golden set on a workspace the team controls, against documents
whose answers can be checked by hand, including questions whose correct
answer is "the documents do not say" — the existing set has one and it is
the most informative question in it.

This is listed last and is arguably first: it is the precondition for
honestly claiming any of the above is fixed.

## 12. Email still runs on the fragile path

- **`RESEND_API_KEY` is unset**, so mail goes over Microsoft 365 SMTP.
  Measured under a 50-message burst: all 50 arrived, 29 needed a retry
  against `432 4.3.2 Concurrent connections limit exceeded`, slowest 61.3s.
  `maxDuration` on the hook is 300s so nothing is cut off, but the
  contention is real and Resend removes it.
- **The Supabase email rate limit is about 30/hour.** A workspace inviting
  forty people hits it.
- **`linktest@nyansaai.com`** exists from a deep test on 2026-11-05.
  *The class:* test identities created against live systems with no cleanup
  step. *The guard:* a reserved prefix for test accounts and a script that
  lists and removes them, so the next test does not leave residue either.

## 13. Still open from the engine brief

- **Workstream 3, the reranker.** `src/lib/rerank.ts` scores candidates with
  a single `gpt-4o-mini` call as a stopgap. Evaluating a real cross-encoder
  needs a Cohere/Jina key — a spending decision for the owner. Do not sign
  the project up for an API without asking.
- **Workstream 4, ingestion depth.** Untouched.
  `scripts/extraction_corpus.json` names files that are not in the
  repository; they are downloadable from the URLs in the manifest. Treat
  downloads as untrusted input: own directory, read by path, never run an
  interpreter or build tool from inside it.
- **Workstream 1, the model upgrade.** The owner is choosing a model and
  asked that it not change meanwhile. Do not touch `CLAUDE_MODEL` or
  `CLAUDE_REASONING_MODEL` without being told to. When told: confirm the
  current model IDs rather than trusting any written here, then report
  correctness, latency and cost before and after.

## A standing instruction

When you fix anything in this repository, including something not listed
here, ask the three questions this document is built from: what class of
mistake is this, where else does the repository make it, and what would stop
it returning. Add what you find, with its evidence and its date. A list that
only ever shrinks is a list nobody is reading honestly.

## Definition of done

Per item: the instance fixed; the audit carried out and its result stated,
including "no other instances"; the guard in place, or an explicit argument
for why none is possible. Plus the relevant probe numbers before and after,
the cost delta, a local `npm run dev` exercise of the path, and
`npx tsc --noEmit`, `npx eslint` and `npx next build` clean. Report
regressions you caused and did not fix.

## Do not

- Do not flip the AI switches on `/admin/tenants`. They stop every workspace
  at once and belong to the owner.
- Do not generate auth links for customer accounts. Only the most recently
  issued email token per user is valid, whatever its type, so it invalidates
  whatever that person was part-way through.
- Do not add a dependency to the auth-email path; a failure there breaks
  sign-in.
- Do not raise `maxConnections` in `src/lib/email.ts`; the ceiling is
  Microsoft's, not ours.
- Do not touch `src/instrumentation.ts` polyfills without understanding that
  `pdf-parse` fails at import time without them.
- Do not widen the agentic loop's deadline. Tried 2026-11-06: median latency
  went 16.8s to 68.2s for the same 4 of 4 answers and worse calibration. The
  reasoning is recorded in `agenticAnswer.ts`.
- Do not raise `MAX_ITERATIONS`. Measured across three runs, the loop returns
  at iteration 1 every time; the cap is never reached.
