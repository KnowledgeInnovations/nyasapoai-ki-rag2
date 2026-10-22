# INTEGRITY LOOP — extraction durability, citation anchoring, answer verifiability

Continue the audit → reproduce → fix → verify → re-audit loop on extraction
durability, citation correctness and answer verifiability, against real tenant
data. Query Supabase directly with the service-role key and exercise the
deployed endpoints — do not declare anything fixed from reading code. Keep
iterating until every check below holds across two consecutive passes.

Every finding below was measured on live data on 22 October 2026. The numbers
are starting evidence, not the target: re-measure them yourself each pass,
because several will move as fixes land.

---

## GROUND RULES — read before changing anything

**1. A RETRY MUST NEVER LEAVE A DOCUMENT WORSE THAN IT STARTED.** Training
currently deletes a document's chunks, `financial_facts` and `document_facts`
up front, then rebuilds. There is no transaction and no rollback. If the
rebuild fails, times out, or is interrupted, the document is left holding less
than it had before — possibly nothing. This is the single most serious defect
in the pipeline, because it converts "try to improve this document" into "risk
destroying it". Any fix that leaves destructive-delete-then-rebuild in place is
not a fix.

**2. A CITATION THAT CANNOT BE OPENED IS NOT A CITATION.** The product's core
promise is that every claim can be checked at its source in seconds. A citation
with no page, or with nothing to click through to, silently breaks that promise
while still *looking* like a citation. Treat an unopenable citation as a
correctness bug of the same severity as a wrong figure, not as cosmetic.

**3. SILENT SUCCESS IS WORSE THAN LOUD FAILURE.** A document that indexed
nothing must not read as `ready`. A fact layer that was never built must not be
indistinguishable from one that was. Where a stage degrades, the document's
visible state must say so in terms a non-engineer can act on.

**4. DIAGNOSE HONESTLY.** `isNetworkError()` classifies `AbortError` and
`TimeoutError` as network faults, but those are exactly what our own deadline
raises when its allowance runs out. A self-inflicted budget expiry was reported
to users for weeks as "network interruption — retry recommended", sending
people to look for a connectivity problem that never existed. One instance of
this was fixed in `genericFactExtraction`; assume the pattern exists elsewhere
and hunt it.

**5. VERIFY ON REAL DATA, END TO END.** Query the database, hit the deployed
endpoint with a real authenticated session, open the actual source document and
confirm the cited text is on the cited page. Unit-style reasoning about what
the code ought to do has repeatedly missed these defects.

---

## 1. DESTRUCTIVE RETRAIN  (severity: critical)

**Measured:** `src/app/api/documents/[id]/train/route.ts` lines 182–191 delete
`document_chunks`, `financial_facts` and `document_facts` before any
replacement exists. `ghana ai strategy` (108 chunks) held **266 facts** at
13:50 on 22 Oct and **0 facts** two hours later, with `updated_at` unchanged
and `auto_reprocess_count` still 0 — i.e. its fact layer vanished outside the
documented retry paths.

- Reproduce deliberately: take a document with a healthy fact layer, trigger a
  retrain, and kill it (or let it hit its deadline) after the delete and before
  the inserts. Confirm the document is left with fewer facts than it began
  with. Record the before/after counts.
- Fix so a failed or interrupted rebuild cannot reduce what the document
  already had. Build-then-swap, a transaction, or writing to a new generation
  and promoting it on success are all acceptable; deleting first is not.
- Confirm the original defect that motivated the upfront delete — retrains
  *appending* facts and silently duplicating them (189 shown vs 89 extracted) —
  does not return. Both properties must hold at once: no duplication, and no
  destruction on failure.
- Re-run on the largest available document and confirm fact count never dips
  below its starting value at any point during the run.

## 2. CITATIONS CARRY NO PAGE  (severity: high)

**Measured:** of 364 citations, **164 (45%) have `page_number` null**. Broken
down: **100% of chunk-based citations have no page number** — every single one.
The chunk they reference *does* carry `page_number`; the insert simply never
copies it (`chat/route.ts`, the `citedChunks.map(...)` inserts set only
`conversation_id`, `document_chunk_id`, `relevance_score`, `message_index`).
`SourceViewer.tsx` then opens the PDF at the cited page **only when
`page_number != null`** (lines 153–159), so for every chunk-based citation the
user is denied the one thing the citation exists to provide.

- Copy `page_number`, `document_id` and `section_title` from the chunk at
  insert time, at every insert site (there are at least three: the agentic
  path, the streaming path, and the non-streaming path — fix all of them).
- Backfill existing citations from their chunk where `document_chunk_id` still
  resolves. Measured: 44 of 44 sampled chunk ids resolve, so the backfill is
  viable. Report how many rows were recovered.
- Verify in the UI, not just the table: ask a real question, click a citation,
  and confirm the PDF opens at the page the quoted text is actually on. Check
  at least five across different documents.
- Confirm the join in the citation read query selects the chunk's page too, so
  a future null cannot silently degrade display again.

## 3. UNANCHORED FACT CITATIONS  (severity: high)

**Measured:** **52% of fact-based citations have neither `document_chunk_id`
nor `document_id`** — 117 of 364 citations (32% of all) point at nothing the
user can open. They render as a fact label with no route back to a source.

- Establish why fact citations lose their document reference, given
  `document_facts` rows know which document they came from.
- Populate `document_id` (and page, where the originating chunk is known) for
  every fact citation at write time; backfill what can be recovered.
- Where a fact genuinely cannot be traced to a document and page, decide
  deliberately whether it should be citable at all. An uncheckable citation is
  worse than an honest "derived from multiple sources" with no link.

## 4. ANSWERS WITH NO CITATIONS AT ALL  (severity: high)

**Measured:** **28 of 80 conversations (35%) have zero citations**, including
the flagship "What was the total national budget allocation for each year from
1999–2026?".

- Classify the 28. Separate legitimate cases (the system correctly said it
  could not answer) from failures (an answer with substantive claims and no
  sources attached). Report the split — this number is meaningless until it is
  broken down.
- For the failures, establish whether citations were never created, created and
  not persisted, or persisted against the wrong `message_index` and so never
  displayed.
- Add a guard: an answer making substantive factual claims with zero citations
  should be treated as a defect by the verifier, not rendered as if sourced.

## 5. SILENTLY EMPTY DOCUMENTS  (severity: high)

**Measured:** **two documents (both titled "image") have 0 chunks and 0 facts
yet show `status = ready`** with no warnings. They are invisible to retrieval
but present and apparently healthy in the UI.

- Establish why a document that indexed nothing reaches `ready`. Treat zero
  chunks after extraction as a failure state, not a success with no content.
- Give such documents a visible, actionable state, and check what the uploader
  is shown at the time — a user who uploads an unreadable scan must learn that
  at upload, not discover it when answers omit it.
- Audit every tenant for documents with zero chunks and report them.

## 6. DOCUMENTS WITH NO FACT LAYER  (severity: medium-high)

**Measured:** **4 of 12 documents hold zero facts** across both fact tables;
**5 of 12 carry processing warnings**. `Authorised-FM-Station-Q2-2026` (58
chunks, 40 pages) holds zero facts after repeated attempts — the case that
motivated resumable extraction (migration 035).

- Once migration 035 is applied, drive the resumable pass to completion on that
  document and report facts before and after. Confirm a second pass processes
  only what the first left, and that a completed document stops being re-queued.
- Then re-ask the question that exposed this — a count of stations first
  authorised in 2025 — and compare the answer, the citations and the confidence
  against the earlier partial answer. If it is still weak, the gap is in
  aggregate querying (section 7), not extraction.
- Establish why the budget reserved for fact extraction is still insufficient
  for dense tabular documents, given it was already raised 60s → 120s after a
  31-chunk document failed. Either the reservation is still wrong, or the
  per-chunk cost on table-heavy content is far higher than assumed. Measure it.

## 7. AGGREGATE AND ENUMERATION QUESTIONS  (severity: medium-high)

**Measured:** retrieval fetches 8–30 chunks (`match_count` in `agentTools.ts`
and `chat/route.ts`). A question whose answer is spread evenly across 793 rows
— "how many stations were first authorised in 2025" — cannot be answered from a
relevance-ranked top-k, because no chunk is more relevant than any other. The
system correctly declined rather than inventing a number, which is right, but
the question is answerable from the facts table.

- Detect counting, enumeration and aggregation questions and route them to
  structured facts rather than passage retrieval.
- Where a question needs full coverage of a document and the fact layer is
  incomplete, say so specifically — "this document is still being processed;
  the count may be incomplete" beats a bare low-confidence answer.
- Verify against a question with a known ground-truth answer. Count the rows
  yourself from the source PDF first, then compare.

## 8. SELF-INFLICTED TIMEOUTS MISREPORTED AS NETWORK FAULTS  (severity: medium)

**Measured:** `isNetworkError()` (`claude.ts`) returns true for `AbortError`
and `TimeoutError`, which our own deadline produces. Users saw "network
interruption — retry recommended" for a budget expiry. Fixed in
`genericFactExtraction`; the classifier itself is unchanged.

- Find every other caller that reports `isNetworkError()` to a user or logs it
  as a network fault, and distinguish "we aborted because our budget expired"
  from "the connection failed" at each one.
- Consider making the distinction at source — an abort raised by our own
  deadline signal should be recognisably ours.
- Confirm retry/backoff behaviour still treats genuine network faults as
  retryable; the point is honest labelling, not suppressing retries.

## 9. REGRESSION GUARD — run every pass

- Document health sweep across all tenants: documents with zero chunks, zero
  facts, warnings, or a non-null `status_detail`. Report the counts and
  compare against the previous pass. Any increase is a regression.
- Citation integrity sweep: percentage with null page, percentage unopenable,
  percentage of answers with no citations. All three must move monotonically
  down across passes.
- Confirm no fix in this loop raised reported confidence without raising actual
  verifiability. Per the standing rule in `MASTER_LOOP_PROMPT.md`: a correct
  answer scoring low is a calibration bug to root-cause; a wrong answer scoring
  high is the same bug in the other direction. Neither is fixed by adjusting
  the formula.
- After any extraction-side change, re-verify a sample of resulting facts and
  citations against the source PDFs by eye before declaring the pass done.

---

## Reporting

At the end of each pass, report:

- The measured numbers for every metric above, next to the previous pass's.
- What was fixed, what was attempted and abandoned, and why.
- Anything newly discovered that is not yet in this document — add it as a
  numbered section with its measurement, so the next pass inherits it.
- Anything that cannot be fixed without a decision (schema change, cost,
  product behaviour), stated as a decision to be taken rather than quietly
  deferred.
