-- 027_answer_heuristics_attempt_count
--
-- runAutoPromptFix retries a 'rejected' category on the next self-assessment
-- run, feeding the prior rejection's reason back into the next candidate
-- (see generateCandidateInstruction's priorAttempt param) instead of
-- regenerating the identical instruction forever. This counter caps that —
-- without it, a category that's genuinely hard to fix without a regression
-- would retry indefinitely, burning a full regression-suite run's worth of
-- AI calls every time with no chance of ever succeeding differently.

alter table public.answer_heuristics
  add column if not exists attempt_count integer not null default 1;
