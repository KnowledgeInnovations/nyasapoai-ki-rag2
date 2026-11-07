<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Deployment traps

**`vercel.json` cron schedules must stay once-daily.** This project deploys
on a Vercel plan that permits one cron run per day. Anything finer — hourly,
`*/30`, every six hours — is rejected at deployment validation, roughly
twenty seconds in, before the build starts. It does not look like a code
error, and it has already been introduced and fixed twice (eebda05, then
again on 2026-11-07).

If someone confirms the plan for this project is Pro, finer schedules are
allowed and `0 * * * *` is the intended setting. Confirm it against the
project's own plan, not against a statement that the organisation has Pro:
the two have not matched.
<!-- END:nextjs-agent-rules -->
