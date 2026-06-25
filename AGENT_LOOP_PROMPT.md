Continue the refine → test → improve → refine loop on this codebase, but the scope is now broader than one tenant's budget documents. NyasapoAI now has at least two tenants with fundamentally different document types — Knowledge Innovations (budget statements) and ghanaaisummit (an inflation report, a business report — neither budget-shaped). Treat every check below as ongoing, real-tenant-data work (query Supabase directly with the service-role key, don't just review code), and keep iterating until every section holds across two consecutive passes before declaring it done.

GROUND RULES — read before touching anything in this prompt:

1. CONFIDENCE MUST STAY HONEST WHILE GETTING MORE ACCURATE. Admins have set a real business requirement: answers that are actually correct must not read below ~85% confidence. This is legitimate and must be solved — but only by fixing genuine calibration bugs (a verification check that fails to recognize a correct figure, e.g. the chart-bare-unit bug already found and fixed this session), never by loosening the verification bar, hiding caveats, or padding the score independent of whether the underlying figure is actually checked against a source. A correct answer scoring 77% is a BUG to root-cause, the same way a wrong answer scoring 95% would be. Treat any change that raises the number without raising genuine verifiability as a regression.

2. THIS SYSTEM MUST NOT ASSUME EVERY DOCUMENT IS A BUDGET STATEMENT. The financial_facts/budget-specific extraction pipeline (regex pass, table extraction, AI table facts) was built first and is the most mature path, but it must behave as ONE possible extraction strategy, not the default one every document is forced through. A tenant uploading an inflation report or a business report must get fast, useful, generic extraction (document_facts) without first burning time/API calls/risk-of-hanging on budget-specific logic that was never going to match. This already caused a real, reproduced incident this session (a new tenant's upload stuck in "processing" for 40+ minutes).

3. "SELF-IMPROVEMENT" MEANS CLOSING REAL, MEASURED GAPS — not literally fine-tuning a model (out of scope; the system runs on third-party LLM/embedding APIs). Concretely: using accumulated, per-tenant signal from real chat sessions (review verdicts, confidence outcomes, repeated unanswered questions) to improve retrieval ranking, extraction coverage, and confidence calibration over time — automatically, in the background, per tenant — without leaking one tenant's learned adjustments into another's, and without making unverifiable autonomous changes (every adjustment must be logged and explainable).

4. EVERY FIX MUST BE VERIFIED AGAINST REAL DATA, end-to-end, the same way bugs were found this session: by querying the database directly, by hitting the live deployed endpoint with a real authenticated session, not just by reading code or running unit-style checks.

---

1. FIX EXTRACTION GETTING STUCK / WASTED ON NON-BUDGET DOCUMENTS

   - Root-cause exactly what made the ghanaaisummit uploads slow/stuck today: confirm whether it was purely the network-hang issue (now fixed via timeouts in embedBatch/claudeComplete), or whether budget-specific extraction (extractFactsFromChunk, extractTableRecordsFromPdf, aiEnhanceTableFacts) was also spending real time attempting to extract financial facts from documents that were never going to contain any — and if so, add a cheap, fast pre-check (e.g., no fiscal-year/currency-symbol/budget-keyword density at the document level) so non-budget documents skip straight to the generic document_facts path instead of running the full budget pipeline first and only falling back after it fails to find ≥3 facts.
   - Confirm the DOCUMENT_FACTS_FALLBACK_THRESHOLD fallback in both finalize/route.ts and train/route.ts actually triggers promptly for non-budget content, and measure how long a non-budget document takes end-to-end now vs. before.
   - Re-verify the dense-table-splitting fix added this session doesn't make non-financial tables (e.g. a business report's data tables) slower by attempting AI-table-fact extraction on tables that were never budget-shaped to begin with.

2. GENERALIZE EXTRACTION TO ANY DOCUMENT TYPE, INCLUDING PATTERNS NOT SEEN BEFORE

   - Using the ghanaaisummit tenant's real documents (Annual Inflation Report 2025, Open Space Business Report) once fully processed, verify extractGenericFacts produces genuinely useful, citable facts — not just a low-value placeholder — and that Ask AI can answer real questions about their actual content with correct citations and reasonable confidence.
   - Audit the extraction/schema code for any assumption that implicitly favors budget/financial document shapes (column names, category lists, classification keywords) and flag/fix anything that would silently underperform on a genuinely novel document type the system hasn't seen a pattern for yet. The system should degrade to "extract what's verifiably there, generically" rather than fail or hang when a document doesn't match a known shape.
   - Test against at least 2 more document types not yet tried this session (pick types plausible for a real tenant — e.g. a legal contract, a technical manual, a meeting-minutes document) and report what worked and what didn't.

3. VERIFY FULL CHAT SESSION PERSISTENCE (not just the first message)

   - Pull several real multi-turn conversations directly from the `conversations` table and confirm the `messages` column actually contains every turn, not just the first user+AI pair. Check the frontend's newSession/convId handling — confirm every message after the first one in a session is sent with `newSession: false` and the correct `convId`, and that `append_conversation_messages` is actually being called and succeeding (check Supabase logs/error handling) rather than silently failing.
   - If any gap is found (e.g. a session that only has 1 message pair in the DB despite the user having sent more), root-cause and fix it. This is foundational: nothing in section 5 (self-improvement from session data) can work if session history isn't reliably complete.

4. ROOT-CAUSE THE CONFIDENCE-CALIBRATION GAP ON VERIFIED-CORRECT ANSWERS

   - Find the specific real conversation the admins flagged: an answer manually verified as a 100% correct match against the source document, scored 77% confidence by the system. Trace it through verifyAnswer() exactly the way the chart-bare-unit bug was traced this session — identify which component (retrieval score, number-verification match, growth-accuracy) failed to recognize the figure as supported, and fix that specific gap.
   - Document, in plain language for the admins, exactly what the confidence score currently measures (the verifyAnswer formula: retrieval quality, what fraction of the answer's own numbers are found in the source/validated facts, growth-claim accuracy, hard-capped at 60 if any number is unverified) so "85% minimum for correct answers" can be evaluated against a known, explainable mechanism rather than a black box.
   - After fixing the specific gap, re-test against a fresh sample of real answers spanning genuinely correct, genuinely uncertain, and genuinely wrong cases — confirm the fix raised ONLY the genuinely-correct ones, and that genuinely uncertain/wrong answers did not also drift upward as a side effect.

5. SCOPE AND ESTIMATE THE SELF-IMPROVING-AGENT CAPABILITY

   - Define concretely what "the agent retrains itself in the background after every chat session" can mean on top of third-party APIs (no fine-tuning): e.g. using search_reviews/self_assessment verdicts (already-existing infrastructure) per tenant to (a) flag recurring extraction gaps for prioritized re-extraction, (b) adjust per-tenant retrieval ranking/weighting based on what's actually been confirmed correct vs. incorrect, (c) feed confirmed-correct Q&A pairs back as few-shot grounding for that tenant's future answers.
   - Produce a concrete implementation plan with an honest time estimate for a first working version of this loop — this is a deliverable the user explicitly asked for ("let me know how fast we can do that"). Distinguish clearly between what's achievable now (pipeline-level, per-tenant adaptive improvement) and what is NOT in scope (training a proprietary foundation model).
   - Do not implement this speculatively before the plan is reviewed — this section is research + a proposal, not a blind build.

6. TENANT ONBOARDING TIME ESTIMATE

   - Using real throughput numbers measured THIS session (actual embedding + extraction time per page/MB across the documents processed today, under normal — not network-degraded — conditions), build a simple, honest estimate: given N documents totaling M pages/MB, tell a newly registering tenant roughly how long full processing will take before the system is "fully active" for their content.
   - Make sure the estimate accounts for the timeout/retry fixes shipped this session (i.e. reflects realistic throughput, not the network-hang conditions that caused today's stuck upload).
   - Surface this estimate somewhere a tenant admin will actually see it after uploading (e.g. on the Documents or Training page) — exact placement is an implementation judgment call, use your best judgment and report what you chose.

7. REGRESSION CHECK

   - Confirm none of today's fixes (citation renumbering, budget-context gating, TREND_RX, embedBatch/claudeComplete timeouts, dense-table text-splitting) regressed on the original Knowledge Innovations budget tenant — re-run a handful of the same real questions tested earlier today and confirm citations, confidence, and answers are still correct.
   - Confirm the ghanaaisummit tenant's two documents, once stable, are fully queryable via Ask AI with correct citations and no leftover "processing"/stuck state.

After each iteration, report: what was checked, what was found (including things already correct, not just bugs), what was fixed, and what remains open — including the section 5 proposal as its own deliverable. Don't stop after one clean pass — repeat against fresh real questions and fresh real tenant data until no new issues turn up across two consecutive iterations.
