<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Deployment traps

**`vercel.json` cron schedules must stay once-daily.** Confirmed 2026-11-08:
hourly fails, daily deploys green. The scope this project deploys on permits
one cron run per day and rejects anything finer — hourly, `*/30`, every six
hours — at deployment validation, about twenty seconds in, before the build
starts. There is no build log to read and the code is provably fine, which is
what makes it a long diagnosis. Introduced and fixed twice already: eebda05,
then again on 2026-11-07.

`npm run check` now catches this before you push.

Two traps inside the trap:

- A `team_` organisation id is **not** evidence of a paid plan. Vercel gives
  every scope a team-shaped id, so it proves nothing either way.
- "We are on Pro" and "this project's scope is on Pro" are different claims,
  and here they did not match. Read the plan on the scope that owns
  `nyasapoai-ki-rag2`, under Settings then Billing.

If that scope does allow finer schedules, set `PLAN_ALLOWS_SUB_DAILY_CRON` to
true in `scripts/check_deploy_config.mts` and use `0 * * * *`. The cron route
is already written to work at any frequency; nothing else needs changing.
<!-- END:nextjs-agent-rules -->
