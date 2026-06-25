Continue the refine → test → improve → refine loop on extraction accuracy, citation correctness, confidence calibration, and response speed for the Ask AI pipeline, against real tenant data (use the Knowledge Innovations tenant's 7 budget documents as ground truth — query Supabase directly with the service-role key, don't just review code). Keep iterating until every check below holds, then report findings instead of stopping early.

GROUND RULE — read this before touching anything confidence-related:
Confidence scores must track genuine certainty, not be pushed upward independent of it. A low score on a real data gap (missing year, sector table that was never extracted, an anomalous sub-line-item masquerading as a ministry total) is CORRECT behavior — it is the system being honest. Do not "fix" low confidence by loosening the validated-facts gate, suppressing caveats, or making the model assert certainty it doesn't have. The only legitimate way to raise confidence is to close the actual gap underneath it: extract the missing year, fix the entity-scope misattribution, corroborate the figure across documents. If a question genuinely can't be answered with confidence from what's been extracted, the answer should keep saying so. Treat any change that raises reported confidence without raising actual data completeness/correctness as a regression, not a fix.

1. CITATION ACCURACY
   - For a sample of at least 15 recent real conversations across different question types, pull every citation (chunk-based and fact-based) and verify: the page_number stored is the page the cited information actually appears on (not null defaulting to a misleading page-1 claim, not the cover/title page unless that's genuinely where the cited fact is). Cross-check page_number against the actual chunk_text/source PDF page.
   - Specifically verify the aiEnhanceTableFacts page_number fix (mapping AI-reported "table" index back to that table's real page) is producing correct, non-null page numbers for newly extracted facts — sample several and confirm they point to the right page.
   - Confirm every citation a displayed answer references actually supports the specific claim it's attached to (not a near-miss chunk that happens to mention the same entity/year but a different figure).

2. CONFIDENCE CALIBRATION
   - For at least 10 answers spanning High/Medium/Low confidence, manually verify the score matches reality: a High-confidence answer should have fully corroborated, unambiguous source data; a Low-confidence answer should have a genuine, specific reason (missing year, conflicting documents, anomalous value, no sector-level data, etc.) — and that reason should be visible in the answer's caveats, not hidden.
   - Find and fix any case where confidence is LOW despite the underlying data actually being complete and unambiguous (a genuine calibration bug — e.g. a scoring penalty firing on something that isn't actually a problem). Do not find-and-fix the reverse direction (raising confidence by hiding uncertainty).
   - Identify the most common reasons confidence comes in low across real queries (sector-level allocation tables never extracted, partial year coverage per ministry, anomalous sub-line totals) and prioritize fixing the highest-frequency one by improving extraction coverage/accuracy for that gap specifically — not by adjusting the scoring formula.

3. EXTRACTION COMPLETENESS
   - Identify which (entity, fiscal_year) combinations a user would reasonably expect to exist but don't have a validated financial_facts row, across all 7 documents — e.g. ministry allocations missing for 3+ of the 7 years, national total_budget missing for any year, sector-level appendix tables not extracted at all.
   - For at least 2 of the highest-impact gaps found, investigate the actual document content (does the figure exist in the source PDF at all? is it in a table format the pipeline isn't parsing? is it being extracted but filtered out by a plausibility-bounds or entity-classification rule?) and fix the root cause if one exists in the pipeline, not just that one row.
   - Re-verify the anomalous-value flag is catching genuine scope mismatches (e.g. a ministry sub-line item extracted as if it were the ministry's full total) — confirm runSanityChecks/cross-document corroboration actually flags or excludes these rather than letting them surface as if validated.

4. RESPONSE SPEED
   - Profile the actual end-to-end latency of a real question (time to first token, time to completion) and identify the largest remaining contributors on the critical path — not background/parallel work that doesn't block the user.
   - Look specifically for: any remaining sequential (non-parallelized) Claude/OpenAI calls that could run concurrently, unnecessarily large prompts (e.g. document inventory or chunk text that could be trimmed), and any step doing more retrieval/processing than the question actually needs.
   - Propose and implement the highest-impact, lowest-risk speed improvement found. Do not trade accuracy or citation correctness for speed.

5. REGRESSION CHECK
   - Confirm the query-planning removal and SourceViewer page-number fix from this session didn't break anything: ask several real questions end-to-end, confirm answers still stream correctly, confidence/citations still populate, and the UI no longer shows the "How I approached this" disclosure anywhere.
   - Re-run retrain-knowledge.ts (or equivalent) against the Knowledge tenant's documents if any extraction-side fix is made, and re-verify a sample of the resulting facts/citations before declaring the iteration done.

After each iteration, report: what was checked, what was found (including things that were already correct — not just bugs), what was fixed, and what remains open. Don't stop after one clean pass — repeat against fresh real questions (not the same ones already verified) until no new issues turn up across two consecutive iterations.
