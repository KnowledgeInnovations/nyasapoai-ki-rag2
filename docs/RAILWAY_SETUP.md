# Setting up Railway — before any migration

This guide gets Nyansa AI **running and proven on Railway while production
stays on Vercel**. It deliberately stops before the DNS cutover. Nothing here
affects live users; the last step is a decision point, not a change.

Verified against Railway's documentation on 5 November 2026. Where Railway
does not document something, this guide says so rather than guessing.

---

## Read this first: Railway changed how configuration works

Railway's **Config as Code** (`railway.json` / `railway.toml`) is deprecated:

> Existing Config as Code files stop being read on **2026-12-01** (hard
> cutoff). New services cannot opt into Config as Code.

That is weeks away. **Do not create a `railway.json`.** It would stop working
almost immediately, and new services cannot use it anyway.

The replacement is **Infrastructure as Code**: a `.railway/railway.ts` file
applied with the CLI (`railway config plan`, `railway config apply`). Note
that Railway does *not* read `.railway/` during deploys — it is applied
deliberately, unlike Vercel's `vercel.json` or Render's `render.yaml`.

**This guide configures the service through the dashboard and CLI**, because:

- it is fully documented and takes effect immediately
- the Infrastructure-as-Code field list is only partly documented, and **cron
  scheduling does not appear in it at all**, so the cron service needs
  dashboard or CLI setup regardless

Once the service works, you can capture it as code with
`railway config migrate` if you want it version-controlled. Getting it running
comes first.

---

## Decisions before you start

| Question | Answer, and why |
|---|---|
| Which plan? | **Pro, $20/month.** Flat per workspace with unlimited seats. Hobby ($5) allows only **2 custom domains per service** and this app needs three — root, `www`, and the wildcard. Pro allows 20. |
| Which region? | **EU West (Amsterdam)** — `europe-west4-drams3a`. Railway has no African region. |
| Keep Vercel running? | Yes. Nothing in this guide touches production DNS. |
| Expected cost? | $20/month plan fee including $20 of usage credit, then RAM at $10/GB/month and CPU at $20/vCPU/month, billed per second. Realistically **$20–40/month**. Builds are free — Railway does not charge for build CPU or memory. |

---

## Step 1 — Install the CLI and sign in

```bash
npm i -g @railway/cli
railway login
```

On Windows, Railway's docs recommend running the CLI under WSL with a Bash
shell, though `scoop install railway` is also offered. The dashboard can do
everything in this guide if you would rather avoid the CLI.

---

## Step 2 — Create the project and the web service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**
2. Choose `KnowledgeInnovations/nyasapoai-ki-rag2`
3. Set the branch to **`master`** — this project's work is on `master`, not
   `main`. `main` exists but holds a single empty commit.
4. Set the region to **EU West (Amsterdam)**
5. Name the service `web`

The first deploy will fail or misbehave until Steps 3–6 are done. That is
expected; do not debug it yet.

---

## Step 3 — Pin Node 22

Railpack picks the Node version in a documented priority order, and without a
pin it defaults to `lts`, which moves under you over time.

Set a service variable:

```
RAILPACK_NODE_VERSION=22
```

That is the highest-priority mechanism. `engines.node` in `package.json`
(priority 3) and `.node-version` (priority 5) also work, but this project has
no `engines` field today, so the variable is the smaller change.

---

## Step 4 — Build and start commands

In the service's **Settings**:

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`

`package.json` already defines `build` as `next build` and `start` as
`next start`, so Railpack would mostly get this right by itself. Setting it
explicitly removes the guesswork.

### The port

Railway injects a `PORT` variable and **your app must listen on it**, or the
health check fails and the deploy never goes live. `next start` reads `PORT`
from the environment, so `npm start` should bind correctly with no change.

Railway's documentation does not explicitly confirm Railpack's behaviour for
`next start` and `PORT`. If the health check fails with the service otherwise
healthy, set the start command explicitly instead:

```
npx next start -p $PORT
```

Check this on the first deploy rather than assuming it.

---

## Step 5 — Environment variables

The service needs **20 variables**. A missing one does not fail the build — it
fails at runtime, usually in the one feature nobody tests.

Use the dashboard's **RAW Editor**, which accepts the contents of a `.env`
file pasted directly. Railway also scans the repo root for `.env`,
`.env.example` and `.env.local` and offers those names for import.

Variables are **staged** in Railway and only apply when you deploy. Paste,
then deploy.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public; ends up in the browser bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public |
| `NEXT_PUBLIC_APP_URL` | **See the warning in Step 8 before setting this** |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `nyansaai.com` — **see Step 8** |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret; bypasses row-level security |
| `ANTHROPIC_API_KEY` | Secret |
| `OPENAI_API_KEY` | Secret |
| `CRON_SECRET` | Must be identical on the web and cron services |
| `SEND_EMAIL_HOOK_SECRET` | Must match the Supabase hook secret |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | The mail relay |
| `EMAIL_FROM` | `no-reply@nyansaai.com` |
| `RESEND_API_KEY` | Set this if you have it. The code picks Resend when present and falls back to SMTP when absent |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | **Leave unset while testing.** The checkout route declines politely when missing rather than pretending a payment succeeded |
| `CONTACT_NOTIFY_EMAIL` | Optional; defaults to `no-reply@nyansaai.com` |
| `RAILPACK_NODE_VERSION` | `22`, from Step 3 |

Railway reserves the `RAILWAY_*` prefix for platform variables. Do not add
your own there.

Consider marking the secrets as **sealed**, which hides them from the UI and
API. Sealing cannot be undone, and sealed values are not returned by
`railway variables` or `railway run` — convenient for safety, inconvenient for
debugging. Your call.

---

## Step 6 — Health check

In **Settings → Deploy**:

- **Health check path:** `/api/health`
- **Timeout:** the default is 300 seconds, which is ample

This route already exists, returns `{"status":"ok"}`, and deliberately touches
no dependency — a health check that fails when Supabase hiccups would take the
whole service out of rotation over something it cannot fix.

Two things worth knowing:

- A new deployment goes live **only** after the health check returns a 2xx. If
  it never does, the deploy is marked failed and the previous version keeps
  serving. That is a useful safety net.
- Health check requests come from the hostname `healthcheck.railway.app`. An
  app that filters by host will reject them. Ours does not: `/api/health` is
  explicitly exempt from the login redirect in `src/proxy.ts`, alongside the
  email hook and the billing webhook.

---

## Step 7 — Add `sharp`

Vercel optimises images for you. A self-hosted Next.js does not, and
`next/image` is used on the marketing page.

```bash
npm install sharp
```

Confirmed absent from `package.json` today. Without it the marketing page's
image fails in production and nowhere else, which is a miserable thing to
debug after a cutover.

---

## Step 8 — First deploy, and what you cannot test yet

Generate a Railway domain: **Settings → Networking → Public Networking →
Generate Domain**. Railway does not assign one automatically. You will get
something like `web-production-xxxx.up.railway.app`.

```bash
curl -s https://<your-service>.up.railway.app/api/health
# {"status":"ok","at":"..."}
```

### A trap specific to this codebase

This application routes workspaces by subdomain, and it decides what it is
looking at from the `Host` header against `NEXT_PUBLIC_ROOT_DOMAIN`. Two
consequences on a `.up.railway.app` host:

- **`subdomainFromHost()` returns `null`** for any host that is not
  `*.nyansaai.com` or `*.localhost`. So on the Railway domain the app always
  behaves as the root/marketing site. **Tenant workspaces cannot be reached
  there at all.**
- **Worse: redirects will send you to production.** `rootUrlForHost()` builds
  URLs from `NEXT_PUBLIC_ROOT_DOMAIN` for any non-local host. With that set to
  `nyansaai.com`, signing in on the Railway test host can bounce you to the
  live site on Vercel — so you end up testing production while believing you
  are testing Railway.

Do not "fix" this by setting `NEXT_PUBLIC_ROOT_DOMAIN` to `up.railway.app`:
`subdomainFromHost()` would then read your service name as a tenant.

**So on the Railway domain, verify only this much:**

- [ ] `/api/health` returns ok
- [ ] the marketing homepage renders, images included (this is what Step 7 was for)
- [ ] `/pricing` shows the prices you set — it renders per request
- [ ] the build succeeded and the service stays up

And watch the address bar. If it jumps to `nyansaai.com`, that is the trap
above, not a success.

### Testing tenant routing without touching DNS

Because routing depends only on the `Host` header, you can exercise it
directly against the Railway host:

```bash
curl -s -H "Host: demo.nyansaai.com" https://<your-service>.up.railway.app/ -i | head -20
```

Note that `fetch` silently drops a `Host` header — it is a forbidden header —
so use `curl`, or Node's `node:http` module. This is how to prove tenant
routing works before any domain is attached.

---

## Step 9 — The cron service

`vercel.json` defines one scheduled job that calls
`/api/cron/auto-reprocess-documents`, which itself chains the orphaned-file
sweep and the billing sweep. Losing it silently stops all three.

On Railway, create a **second service in the same project, from the same
repository**:

1. **New** → **GitHub repo** → the same repo, branch `master`
2. Name it `cron`
3. **Settings → Deploy → Cron Schedule:** `0 3 * * *` (03:00 UTC, as on Vercel)
4. **Start command:**

```
node -e "fetch(process.env.APP_URL+'/api/cron/auto-reprocess-documents',{headers:{'x-cron-secret':process.env.CRON_SECRET}}).then(async r=>{const t=await r.text();console.log('status',r.status,t.slice(0,500));if(!r.ok)process.exit(1);}).catch(e=>{console.error('cron failed:',e.message);process.exit(1);})"
```

5. Set two variables on this service: `APP_URL` and `CRON_SECRET`

Four things Railway documents about cron that differ from Vercel:

- **The service must exit.** Railway expects a cron service to do its work and
  terminate. The command above exits on both success and failure, which is why
  it is written that way.
- **Minimum spacing is 5 minutes**, and schedules are **UTC**. `*/5` is valid;
  `*/7` is not.
- **Overlapping runs are skipped**, not queued — if the previous run is still
  going, the new one does not start. Fine for a nightly job.
- `CRON_SECRET` must be **identical** to the web service's value. They are
  separate services with separate variables, and a mismatch means the job is
  rejected with a 401 every night, silently.

Railway's documentation does not state a minimum charge for cron services;
billing is per second of running time, and this runs for seconds a day.

---

## Step 10 — The test that justifies the whole move

This is the point of migrating. Do not skip it.

On Vercel, Supabase calls the email hook once per email, each call can start
its own instance, and each instance opens its own SMTP connection — so twenty
invites can mean twenty simultaneous connections, which Microsoft 365 refuses
with `432 4.3.2 Concurrent connections limit exceeded`. Railway runs one
long-lived process, so the connection pool is shared and actually bounds
anything.

Measured on this system: 50 messages through one shared pool delivered 50/50.
The same 50 as separate instances also delivered 50/50, but **29 of them
needed a retry** — they only arrived because retry logic caught the rejection.

Because tenant pages are unreachable on the Railway domain (Step 8), the
cleanest pre-cutover check is a direct one. With the service running, send a
burst through the deployed app and confirm the Railway logs show every message
sent via one transport with no `432` retries. If you would rather test through
the real invite flow, that has to wait until a domain is attached.

---

## Step 11 — Custom domains and DNS

**Do this only when you are ready to move.** Attaching `nyansaai.com` to
Railway requires changing the DNS that currently points at Vercel.

For each of `nyansaai.com`, `www.nyansaai.com` and `*.nyansaai.com`:
**Settings → Public Networking → + Custom Domain**.

Railway then shows the records to create. Add them **exactly** as shown.

| Domain | Records needed |
|---|---|
| `www.nyansaai.com` | One `CNAME` plus one `TXT` for ownership |
| `*.nyansaai.com` | **Two CNAMEs and one TXT** — one CNAME for the wildcard, one for `_acme-challenge`, plus the TXT |
| `nyansaai.com` (apex) | Not a plain CNAME — see below |

Failure modes worth memorising, because each one fails quietly:

- **Missing TXT record → requests return 404.** Railway's docs say this
  explicitly.
- **Wildcards will not verify without the TXT record.**
- **The `_acme-challenge` CNAME must not be proxied** (the record pointing at
  `authorize.railwaydns.net`).
- **On Cloudflare, SSL mode must be `Full`, not `Full (Strict)`** — Railway's
  docs say Full (Strict) "will not work as intended". Universal SSL must be on.
- **Nested wildcards are not supported.** `*.nyansaai.com` is fine;
  `*.*.nyansaai.com` is not.

### The apex domain

Railway does not accept a plain CNAME at the root. It needs CNAME flattening
or a dynamic ALIAS/ANAME record, and **several providers cannot do this at
all** — Railway names AWS Route 53, Azure DNS and GoDaddy among them. The
documented workaround is moving nameservers to Cloudflare.

**Find out who runs your DNS before committing to Railway.** If it is GoDaddy,
you have an extra project — moving nameservers — that Render would not have
required.

Certificates are Let's Encrypt, issued within about an hour of DNS updating,
valid 90 days, renewed automatically. Propagation can take up to 72 hours.

---

## Step 12 — Repoint Supabase and Paystack

Only at cutover, and only after domains verify.

**Supabase → Authentication:**

1. **Hooks → Send Email:** `https://www.nyansaai.com/api/auth/send-email-hook`
   — keep the existing secret, which must equal `SEND_EMAIL_HOOK_SECRET`. Use
   the `www` form: the apex redirects to `www`, and a webhook POST that gets
   redirected is often not followed.
2. **URL Configuration → Site URL:** `https://www.nyansaai.com`
3. **Redirect URLs:** must include `https://*.nyansaai.com/**` for tenant
   subdomains, plus `https://www.nyansaai.com/**`

Because the hostname does not change, none of this takes effect until DNS
moves — which is what you want.

**While you are in Supabase**, two settings that cause reported failures and
have nothing to do with hosting:

- **Rate Limits:** the email send limit defaults to roughly **30 per hour**.
  Fifty invites exceeds it, and the excess is refused by Supabase before our
  code is ever called. This alone may explain the invites that went missing.
- **Email OTP Expiration:** set to `86400`. The emails now state a 24-hour
  window, so until this is changed they promise a day and the link may die in
  an hour.

**Paystack → Settings → API Keys & Webhooks → Webhook URL:**
`https://www.nyansaai.com/api/billing/webhook`

---

## Stop here

At this point Railway is running, proven, and costing you about $20/month
alongside Vercel. The cutover — pointing DNS — is a separate decision made
when you can watch it.

**Rollback is pointing DNS back at Vercel.** Nothing in this setup writes to
the database differently, and no data lives on the host: documents are in
Supabase Storage, everything else in Supabase Postgres. Both platforms can
serve the same commit at the same time.

---

## Traps specific to this codebase

| Trap | What happens |
|---|---|
| `NEXT_PUBLIC_ROOT_DOMAIN` on a test host | Redirects send you to the live site on Vercel, so you test production while thinking you test Railway. See Step 8. |
| Tenant subdomains on `.up.railway.app` | Unreachable. `subdomainFromHost()` returns `null` for any non-`nyansaai.com` host. Use a `Host` header to test. |
| `PORT` | If the app does not bind it, the health check fails and the deploy never goes live. Verify on the first deploy. |
| `maxDuration` does nothing | 21 route files export it. Railway has no serverless limit, but it does cap HTTP requests: **5 minutes with no data transferred, up to 15 minutes while data keeps flowing.** Document training streams, so the 15-minute ceiling applies — test a large document. |
| `instrumentation.ts` must run | It patches browser globals (`DOMMatrix`, `ImageData`, `Path2D`) that `pdf-parse` needs and Node lacks. Next runs it on server start. If PDF extraction throws `ReferenceError: DOMMatrix is not defined`, that file did not run. |
| Build limits are undocumented | Railway publishes no build memory or timeout figures. Builds are free, but if one fails for memory there is no documented knob — unlike Render, which states 2 CPU / 8 GB and an upgrade path. |
| Health checks must not be redirected | `/api/health`, `/api/auth/send-email-hook` and `/api/billing/webhook` are exempt from the login redirect in `src/proxy.ts`. Add any new server-to-server endpoint there too, or it will answer a signed webhook with an HTML login page. |

---

## What is still unverified

Stated honestly, so you are not surprised:

- Railway's **Next.js deploy guide returns a 404**, so there is no
  first-party guidance on `next start`, `PORT`, standalone output or `sharp`.
- Whether `next start` picks up `PORT` under Railpack is **not documented**.
  Step 4 gives the fallback.
- **Cron scheduling does not appear in the Infrastructure-as-Code field
  list**, so the cron service is dashboard-configured.
- Railway does not document whether paid services ever sleep. Only sandboxes
  have a documented idle timeout.
- Build memory and build timeouts are **not published**.
