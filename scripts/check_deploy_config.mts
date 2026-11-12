/**
 * Will this vercel.json actually deploy?
 *
 * Cron frequency is plan-gated, and getting it wrong does not look like a
 * configuration error. The deployment fails in about twenty seconds,
 * before the build runs, so there is no build log to read and the code is
 * provably fine — a fresh clone with a clean install builds green. It is
 * a genuinely confusing twenty minutes to diagnose, and this project has
 * now lost that twenty minutes twice:
 *
 *   eebda05  "Fix vercel.json cron schedule for Hobby-tier compatibility"
 *            — every six hours, reverted to daily. Its message notes that
 *            deployments had silently stopped appearing.
 *   aa0bf5b  — hourly, same failure, reverted in a581de2. Confirmed by
 *            the daily version deploying green immediately afterwards.
 *
 * A plan that permits one cron run per day rejects anything finer. Note
 * that a `team_` organisation id is NOT evidence of a paid plan: Vercel
 * gives every scope a team-shaped id, so the only way to know is to read
 * the plan on the scope that owns this project.
 *
 * Run by `npm run check`.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Set this to true ONLY after reading the plan on the Vercel scope that
 * owns this project — not the organisation's plan in general, and not an
 * assumption from the team id. Dashboard: the scope that owns
 * `nyasapoai-ki-rag2`, then Settings, then Billing.
 *
 * When it is true, sub-daily schedules are allowed and the intended
 * setting is "0 * * * *" — the cron route is already written to work at
 * any frequency, so nothing else needs to change.
 */
const PLAN_ALLOWS_SUB_DAILY_CRON = false

const CONFIG = path.join(process.cwd(), 'vercel.json')

if (!fs.existsSync(CONFIG)) {
  console.log('no vercel.json — nothing to check')
  process.exit(0)
}

interface Cron { path?: string; schedule?: string }
const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) as { crons?: Cron[] }
const crons = config.crons ?? []

if (!crons.length) {
  console.log('vercel.json has no cron jobs')
  process.exit(0)
}

/** A field that names exactly one value: "3" yes, "*" / "*\/6" / "1,5" / "1-5" no. */
const single = (field: string) => /^\d+$/.test(field.trim())

/**
 * How many cron jobs the plan permits.
 *
 * The restrictive plan allows two, and this project now uses both:
 * auto-reprocess-documents at 03:00 and sharepoint-sync at 04:00. A third
 * fails the same way a sub-daily schedule does — at deployment
 * validation, before the build, with nothing in the log — so it is worth
 * catching here rather than rediscovering it.
 */
const MAX_CRON_JOBS_ON_RESTRICTIVE_PLAN = 2

const problems: string[] = []

if (!PLAN_ALLOWS_SUB_DAILY_CRON && crons.length > MAX_CRON_JOBS_ON_RESTRICTIVE_PLAN) {
  problems.push(
    `${crons.length} cron jobs, but the plan this project deploys on permits
` +
    `    ${MAX_CRON_JOBS_ON_RESTRICTIVE_PLAN}. Fold the extra work into an existing job, or confirm the plan
` +
    `    on this project's Vercel scope and set PLAN_ALLOWS_SUB_DAILY_CRON = true.`,
  )
}

/** Two jobs on the same minute contend for the same ceiling. Stagger them. */
const byMinute = new Map<string, string[]>()

for (const c of crons) {
  const schedule = (c.schedule ?? '').trim()
  const parts = schedule.split(/\s+/)
  if (parts.length < 5) {
    problems.push(`${c.path}: "${schedule}" is not a five-field cron expression`)
    continue
  }
  const [minute, hour] = parts
  const runsMoreThanDaily = !single(minute) || !single(hour)

  const slot = `${hour}:${minute}`
  byMinute.set(slot, [...(byMinute.get(slot) ?? []), c.path ?? '?'])

  if (runsMoreThanDaily && !PLAN_ALLOWS_SUB_DAILY_CRON) {
    problems.push(
      `${c.path}: "${schedule}" runs more than once a day.\n` +
      `    The plan this project deploys on permits one run per day and rejects\n` +
      `    finer schedules at deployment validation — the deploy fails in ~20s,\n` +
      `    before the build, with nothing useful in the log.\n` +
      `    Either use a once-daily schedule such as "0 3 * * *", or, if the plan\n` +
      `    on this project's Vercel scope is confirmed to allow more, set\n` +
      `    PLAN_ALLOWS_SUB_DAILY_CRON = true at the top of this file.`,
    )
  }
}

for (const [slot, paths] of byMinute) {
  if (paths.length > 1) {
    problems.push(
      `${paths.join(' and ')} both run at ${slot}.
` +
      `    Each may use the full function ceiling, so they would compete for it.
` +
      `    Give them different hours.`,
    )
  }
}

if (!problems.length) {
  console.log(`vercel.json: ${crons.length} cron job(s), all deployable on the current plan`)
  process.exit(0)
}

console.log('vercel.json will fail deployment:')
for (const p of problems) console.log('  ' + p)
process.exit(1)
