# ACCURACY LOOP — prove correctness, then improve it

Continue the audit → reproduce → fix → verify → re-audit loop on answer
correctness, extraction completeness and citation anchoring, against real
tenant data. Query Supabase directly with the service-role key, exercise the
deployed endpoints with a real authenticated session, and open the source
document to check what the answer claims. Do not declare anything fixed from
reading code.

Every number below was measured on live data on 22 October 2026. They are
starting evidence, not targets: re-measure each one yourself every pass,
because several will move as fixes land.

Work the sections in order. Section 1 comes first because without it every
other improvement in this file is an anecdote.

---

## GROUND RULES — read before changing anything

**1. THE EXISTING REGRESSION SUITE CANNOT DETECT A WRONG ANSWER.**
`scoreRegressionAnswer()` in `src/lib/selfAssessment.ts` passes a question on
two tests: confidence ≥ `minConfidence` (generated in the 25–60 range) and
citation count > 0. No expected answer is stored anywhere. A confidently
wrong figure with a citation attached passes. Worse, the suite's questions are
generated *from the facts we extracted*, so a misread value becomes a test
built on the misreading, which the system then passes by repeating it. And
because answer confidence now routinely scores 80–99, the suite's pass rate
has risen with no correctness change behind it. Treat a passing suite as
evidence of nothing until section 1 is done.

**2. A NUMBER IS ONLY TRUE IF SOMEONE CHECKED IT AGAINST THE SOURCE.** Every
improvement recorded in this file was verified by opening the source document
and counting by hand. That does not scale and it is not a property of the
product. Where you cannot check a claim against the source, say so rather than
reporting it as verified.

**3. A FACT COUNT FALLING IS NOT NECESSARILY A LOSS.** Measured: handing the
extractor a document's own column headings took one register's six-excerpt
sample from 18 attribute names to 9 while *increasing* facts 514 → 654, and
took a prose SOP from 15 names to 3 at an unchanged count. Where a count
falls after a naming change, duplicates are finally deduplicating — three
spellings of "responsibility" could never collapse against each other.
Establish which it is before calling it a regression.

**4. NEVER INVENT PROVENANCE.** 114 citations point at a document that was
deleted and re-uploaded. They could be re-attached to the new upload by
matching page and section, and that would be fabrication: the source those
answers actually used no longer exists. An honest dead end beats a plausible
lie. The same rule governs date normalisation (section 2): a two-digit year
cannot be assigned a century by preference.

**5. CALIBRATION IS A TWO-SIDED BUG.** A correct answer scoring low and a
wrong answer scoring high are the same defect in opposite directions, and
neither is fixed by adjusting the formula. Root-cause it. Measured instance:
the same counting question scored 33, 48 and 96 on three consecutive runs
because `verifyAnswer()` recognised currency and percentages but not counts,
so an answer made of counts had nothing checkable in it and fell through to
average retrieval similarity.

**6. MIGRATIONS MUST BE PURELY ADDITIVE AND OPTIONAL.** Files written into
`supabase/migrations/` reach the live database quickly. Never drop, rename or
delete in one. Read a new column in its own tolerant query — folding it into
an existing select turns a missing column into "document not found" for every
request on that path.

---

## 1. NOTHING MEASURES CORRECTNESS  (severity: critical)

**Measured:** the regression suite scores on confidence and citation presence
only — see ground rule 1. There is no stored expected answer for any question,
for any tenant, anywhere in the schema.

- Build a graded golden set: per tenant, a stored set of questions each with a
  **verified expected answer** and the page it can be checked on. Ten is
  enough to start. The verification is human: whoever knows the documents
  confirms each answer once against the source.
- Write a grader that compares the system's answer to the expected value —
  figure equality within a stated tolerance, set membership for
  enumerations, and a substantive-claim check for prose. Report accuracy, not
  confidence.
- Report calibration explicitly: of the answers that scored ≥ 90, what share
  were correct? Of those that scored ≤ 40, what share were in fact right? A
  confidence number that does not track correctness is decoration.
- Keep the existing suite, but relabel what it measures. It is a smoke test
  for "did the pipeline answer at all and attach a source", not an accuracy
  measurement, and its `minConfidence` thresholds are now below the normal
  operating range so they no longer discriminate.
- Fix the insufficiency scoring while you are there: a question expecting an
  honest "I don't have this" currently passes if `confidenceLevel !== 'High'`,
  which rewards hedging — the behaviour deliberately removed from answers.
  Score it on whether the answer actually disclosed the gap.

**Verify:** deliberately corrupt one fact in the database, re-run the graded
set, and confirm the affected question fails. A suite that cannot fail on a
known-wrong answer is not measuring anything.

## 2. DATES THE PIPELINE REFUSES TO READ  (severity: high)

**Measured:** `Authorised-FM-Station-Q2-2026` holds 437 values for its DATE OF
FIRST AUTHORISATION column. **287 of them carry no four-digit year** — printed
`25 – 02 - 20`, `14 – 04 - 20`, `07-11-12` — so they are excluded from every
year count, and the register's headline question ("how many stations were
first authorised in 2025") can only ever be answered from the 150 that are
unambiguous. The answer correctly reports 8 and names the 287 as unread.

- The document profile (`src/lib/documentProfile.ts`, migration 039) now
  identifies which column these belong to. Infer the dominant date format
  **from the unambiguous values in that same column**, then apply it to the
  short-form ones. Two-thirds of a discarded column is recoverable this way.
- Store the normalised value in `document_facts.value_date` and keep
  `value_text` exactly as printed. Record that the date was inferred rather
  than stated, and have the aggregate view count inferred and stated dates
  separately so an answer can say which it used.
- Do not guess where the column itself is ambiguous. If a column's
  unambiguous values do not establish one dominant order (DD-MM-YY vs
  MM-DD-YY), leave them unread and say how many — per ground rule 4.
- Apply the same reasoning to numbers: a value like `94. 7MHz` is a frequency
  mangled by extraction spacing. Measure how many numeric values fail to
  parse across the tenant before deciding whether this is worth a pass.

**Verify:** count the 2025 first authorisations by hand from the source PDF,
then compare against the answer. Report both numbers.

## 3. ONE DOCUMENT STILL CARRIES INCONSISTENT FIELD NAMES  (severity: high)

**Measured:** the controlled vocabulary is in place for new extractions, but
`Authorised-FM-Station-Q2-2026`'s existing 4,170 facts predate it and still
hold one column under several names. Its 2025 counts therefore split across
`date_of_first_authorisation` (8) and a vaguer `authorization_date` (7), and
the answer has to say which it used.

- This needs an explicit decision, not a quiet retrain: cleaning it means
  replacing that fact layer. The safeguard that keeps a complete layer from
  being replaced by a partial one will otherwise preserve the old names, so
  nothing improves until the replacement is authorised.
- When authorised: retrain so the profile and column legend land, then run
  the resumable facts pass to completion, and report attribute-name counts
  and the 2025 figure before and after.
- Afterwards, re-measure every tenant: how many documents hold two or more
  attribute names that the aggregate view has to group? That number should
  only ever fall.

## 4. "WHICH ONES" QUESTIONS STILL HAVE NO PATH  (severity: high)

**Measured:** `factAggregates.ts` answers *how many* and *how values
distribute*, across every fact in a document. It cannot answer *which ones*:
"which stations in Ashanti are not on air" needs row-level filtering, and
passage retrieval returns an arbitrary slice because no excerpt is more
relevant than another.

- Add a filtered-rows path over `document_facts`, keyed on the profile's
  column names — which is what makes this possible for the first time.
- Return the matching rows with their pages, and cite each row rather than
  citing the view once. An enumeration whose members cannot be opened
  individually is the citation problem again in a new place.
- Decide deliberately what happens past a sane row cap. A list of 530 stations
  is not an answer; "530 match, here are the first 25, filtered by X" is.
- Verify against a filter whose answer can be counted by hand from the source.

## 5. CITATIONS THAT STILL CANNOT BE OPENED  (severity: medium-high)

**Measured:** of 356 citations, **80 (22.5%) have no page** and **114 (32.0%)
can be opened at neither chunk nor document**. Among chunk-based citations,
42.0% have no page, and every one of those traces to a .docx source. The 114
are historical and unrecoverable (ground rule 4) — the live defects are:

- Fact citations carry no page where the originating chunk is unknown.
  `document_facts` rows do hold `page_number`; establish why it is not reaching
  the citation and fix it at write time.
- A Word file has no pagination until it is rendered. Its chunks now carry
  section titles (none did before), so the viewer can anchor on the section —
  but decide whether to also derive approximate page numbers by rendering, and
  if so mark them as approximate.
- Re-run the citation sweep every pass. Null-page share and unopenable share
  must both move monotonically down.

## 6. SCANNED DOCUMENTS NEED A HUMAN TO FINISH THEM  (severity: medium-high)

**Measured:** page-image transcription runs 6 at a time at ~9.4s a page,
inside a 100s sub-budget — about 10 pages per pass. Transcriptions are cached
(migration 038), so passes accumulate and nothing is re-read, and the Training
page offers "Continue training · N page(s) to read". A 26-page census volume
completed at 25 of 26 pages, 180,621 characters, 194 chunks. But a 200-page
scanned record needs twenty presses of that button.

- Make continuation automatic for a document with unread pages: a queue, or a
  pass that chains itself while progress is being made. Bound it — a document
  that stops making progress must stop retrying, and say why.
- Report per-page transcription confidence. A faint scan transcribed badly is
  currently indistinguishable from one transcribed well.
- Measure the cost per 100 pages before enabling this by default, and say what
  it is.

## 7. UNTESTED: LOCAL-LANGUAGE AND CODE-SWITCHED DOCUMENTS  (severity: unknown)

**Measured:** nothing. Every document in both corpora is English. Retrieval
uses `text-embedding-3-small`.

- Obtain one real document in Twi, Ga or Ewe, or a genuinely code-switched
  one, and run the full pipeline: extraction, chunking, retrieval, answer.
- Measure retrieval quality specifically — an embedding model weak in a
  language returns plausible-looking but wrong passages, which is worse than
  returning nothing, because the answer will be confident.
- Report what you find before anyone claims national coverage. If retrieval is
  poor, the decision (a different embedding model, per-tenant language
  configuration, translation at ingest) is a cost decision for the user to
  take, not one to make quietly.

## 8. CONFIDENCE FOR CLAIMS THAT ARE NOT NUMBERS  (severity: medium)

**Measured:** `verifyAnswer()` now checks currency, percentages and counts
against the sources, the aggregate view's published figures and the question's
own numbers. A purely qualitative answer still has `totalNumbers === 0` and
falls through to retrieval similarity plus the AI cross-check. Measured
instance of the failure mode this leaves: "what is the capital of France",
asked of a broadcasting register, scored 64% with zero citations — now capped
at 35% by the uncited-answer rule, but the underlying blindness remains.

- Give qualitative claims a real check: does each substantive sentence have a
  cited excerpt that actually supports it? The AI cross-check already does
  something like this; make its result part of the score rather than only a
  penalty.
- Re-verify that the uncited-answer ceiling has not caught a legitimate case —
  inventory questions and honest-insufficiency answers are deliberately exempt.

## 9. EXTRACTION GAPS STILL OPEN  (severity: medium)

**Measured on the 16-document corpus (15 pass, 1 needs `--vision`):**

- A `.pptx` extracts as one page with no slide boundaries, so a deck's
  citation cannot say which slide. officeparser does not expose them; reading
  the package directly would.
- For a prose document containing an incidental table, the profile reports
  that table's headers as the document's columns — a NIST specification
  returns its first-page metadata table. Harmless today, imprecise.
- A 25MB workbook produces 22,441 chunks. Faithful, and almost certainly past
  what a tenant should be able to upload without being told. Decide where the
  limit is and say it at upload rather than after.
- `pdf-parse`'s `getTable()` crashes on individual pages (`Cannot read
  properties of undefined (reading 'from')`). Already handled per-page so one
  bad page costs only its own tables — confirmed working on two corpus
  documents. Leave it; just do not let the retry disappear.

## 10. REGRESSION GUARD — run every pass

- `npx tsx scripts/extraction_probe.mts <corpus-dir>` over both the public
  corpus (`--fetch` rebuilds it from `scripts/extraction_corpus.json`) and a
  directory of the tenants' real documents pulled from storage. Report
  pass/fail and, for every document, chunk count and section coverage against
  the previous pass. Any fall in section coverage is a regression.
- Document health sweep across all tenants: zero chunks, zero facts, pending
  excerpts, unread pages, non-null `status_detail`. Compare against the
  previous pass.
- Citation integrity sweep: null-page share, unopenable share, share of
  conversations with no citations.
- Confidence stability: ask the same three questions three times each and
  report the spread. A question whose score moves more than ~10 points on
  identical input is measuring something other than the answer.
- Confirm no fix raised reported confidence without raising verifiability.

---

## Reporting

At the end of each pass, report:

- Every metric above, next to the previous pass's.
- What was fixed, what was attempted and abandoned, and why.
- Anything newly found that is not yet in this file — add it as a numbered
  section with its measurement, so the next pass inherits it.
- Anything that cannot be fixed without a decision (schema change, cost,
  product behaviour, replacing a customer's data), stated as a decision to be
  taken rather than quietly deferred.
- Where a number improved, say how it was verified. "The suite passed" is not
  verification until section 1 is done.

---

## PASS 1 RESULT — 22 October 2026

### Section 1 — correctness is now measured

Built the graded golden set the section asked for: migration 040
(`golden_questions`), the grader in `src/lib/goldenSet.ts`, the runner
`scripts/golden_run.mts`, and a seed set in `scripts/golden_seed.json` whose
twelve expected answers were each checked against a named page of the source.
Nine come from the register's own summary table on page 2 (793 authorised,
571 in operation, 222 not, 162 community, 24 campus, 572 commercial, Ashanti
117 as the largest region, Upper West 27, 16 regions — a set that sums
correctly, so the page is internally consistent); two from the AI strategy
(eight pillars, p6; the Responsible AI Authority, p34); and one deliberately
unanswerable, where the correct answer is to say so.

**First measurement: 12 of 12 correct. Over two rounds, 22 of 24.**

| confidence band | answers | correct |
| --- | --- | --- |
| 90–100 | 14 | 100% |
| 75–89 | 4 | 100% |
| 50–74 | 4 | 100% |
| 0–49 | 2 | 0% |

Calibration holds in both directions: nothing scored High and was wrong, and
both wrong answers scored Low. The two failures were the same two questions
in one round only, and they were caused by this session editing the retrieval
code while the run was in flight — re-asked three times each afterwards, both
answered correctly. A clean two-round run is the number to quote; re-run it
before trusting this table.

**The grader was wrong three times before it was right, and each time it
failed a correct answer.** It read `2025` out of a question the answer
echoed; it read the year out of the document's own filename
(`Authorised-FM-Station-Q2-2026`); and it read the document's stated period
("as at Q2 2026") as an invented figure. All three were fixed by narrowing
what counts as a figure the answer is claiming. A grader that marks right
answers wrong is the same class of error as one that marks wrong answers
right, so the runner is accompanied by checks that prove it still fails a
fabricated figure, a wrong figure, and a refusal to answer something the
document does state.

Also done: the old suite's insufficiency rule no longer passes an answer for
merely sounding unsure — disclosure is what it tests, so disclosure is what
it now requires — and `scoreRegressionAnswer()` carries a comment saying
plainly what it can and cannot measure.

### Section 2 — short-form dates are now read

**Measured on the register's DATE OF FIRST AUTHORISATION column (437
values):** 287 carried no four-digit year. Grouping by printed shape and
taking the evidence from the document itself, **269 are now read and 18
correctly refused**. The column goes from 150 of 437 readable (34%) to 419
(96%).

Neither the order nor the century is a convention here. Of 251 values printed
`NN-NN-NN`, 171 begin with a component above 12 and none has one in second
position, so that shape is day-first on the document's own evidence; shapes
with no such value, or with evidence both ways, are left unread. The century
is pivoted on the latest four-digit year the same column states (2026), so
`95` is 1995 and `20` is 2020. The slash shape `NN/NN/NNNN` has 22 values
pinning day-first and 7 pinning month-first — genuinely inconsistent, and
left alone because those already carry their year.

Stated and inferred years are reported separately to the model, so the answer
now reads: "9 stations show a first-authorisation date in 2025 … 8 with the
year printed in full and 1 read from the short-form date", with the 18
unreadable and 321 undated records named. Confidence 92%.

**Verified against the source, not against our own facts:** of the 9 claimed
2025 first authorisations, 8 were confirmed by finding a line in the source
PDF carrying that company and that exact date. The ninth (OGM Media Network)
has its name and date on different wrapped lines, so the line matcher cannot
see it, though an earlier answer quoted it from a retrieved excerpt. The count
of 9 is therefore 8 confirmed and 1 probable — **not proven exactly**.

One open question this surfaced: PROJOY COMPANY LIMITED appears four times
with the same date (two serial numbers on p26, two frequencies on p27) and
POTTER'S DEW twice with different dates. These are plausibly four and two
distinct authorisations to the same companies, but it cannot be settled from
the extracted facts alone. Until it is, a count of stations is strictly a
count of authorisation rows. Add it to the golden set once resolved.

### Carried forward unchanged

Sections 3 through 9 are untouched by this pass. Section 3 (replacing the
register's fact layer) and section 7 (local-language retrieval) still need a
decision from the user before work can start.

### Clean two-round re-run

The table above was recorded while this session was editing retrieval code
mid-run. Re-run against stable code, with no other change:

**24 of 24 correct over two rounds. 0 unstable.**

| confidence band | answers | correct |
| --- | --- | --- |
| 90-100 | 16 | 100% |
| 75-89 | 4 | 100% |
| 50-74 | 4 | 100% |
| 0-49 | 0 | n/a |

Nothing scored High and was wrong, nothing right was scored Low, and no
question changed verdict between rounds. This is the number to compare the
next pass against. Note what it does and does not say: twelve questions
across two documents, each with an answer checked against a named page. It
is a floor under the claim "the answers are correct", not proof that they
are correct in general — widen the set per tenant before reading more into
it than that.
