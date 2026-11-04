# Migrating Nyansa AI from Vercel to Render

A runbook, written to be followed top to bottom. Nothing here is
irreversible until step 8, and step 8 is a DNS change you can undo.

The application itself needs almost no modification: there is no `@vercel/*`
package anywhere, no edge runtime, and `vercel.json` contains one cron entry.
What changes is the surroundings — the schedule, the certificates, and the
three places that hold a URL pointing at us.

---

## Why this is worth doing

One reason, and it is the one that has actually cost you: **email.**

Supabase calls the send-email hook once per email. On Vercel that is one
serverless instance per invite, each opening its own SMTP connection, so
twenty invites means twenty simultaneous connections. Microsoft 365 client
submission refuses past a handful with `432 4.3.2 Concurrent connections
limit exceeded`. Measured on this system: twenty at once lost one outright,
and the survivors took a median of 25 seconds with the slowest at 52 — past
the function's budget, so the send was killed and the invite vanished with
no error anywhere a person would see it.

Connection pooling is the fix, and pooling only works inside one process.
On Vercel the pool bounds connections *per instance*, which bounds nothing.
On Render the app is one long-running process, so a pool of two connections
is two connections no matter how many invites are in flight — which is what
Microsoft's limit is actually counting.

Three further things follow from being long-lived rather than per-request:

- **No cold starts.** Supabase gives the email hook five seconds to respond.
  A cold start on this route was measured at about three of them.
- **No function time limit.** Document training streams for minutes; the 21
  `maxDuration` exports in `src/` exist to buy headroom that a normal server
  does not need.
- **Real cron.** Render runs scheduled jobs as their own service, instead of
  the current arrangement where one route calls two others because the
  hosting tier allows a single schedule.

**What this does not fix:** Microsoft 365 SMTP still is not built for bursts.
Pooling makes 20 reliable; it will not make 200. If invite volume keeps
growing, move `sendEmail()` to an HTTP email API — that change is independent
of this one and works on either host.

---

## Before you start

**Decide these first.** Each one changes a later step.

| Question | Why it matters |
|---|---|
| Keep Vercel running during cutover? | Recommended. DNS moves last, so both can serve until you are satisfied. |
| Which Render plan? | **Not free.** A free instance sleeps when idle and a cold start breaks the email hook. Standard or above. |
| Who holds the DNS for `nyansaai.com`? | You need to add records, including a wildcard. |

**Have to hand:** every value currently in Vercel → Settings → Environment
Variables. There are 15, and a missing one does not fail the build — it fails
at runtime, usually in the one feature nobody tests.

---

## Step 1 — Add `sharp`

Vercel optimises images for you. A self-hosted Next.js needs `sharp`, and
`next/image` is used on the marketing page.

```bash
npm install sharp
git commit -am "Add sharp for self-hosted image optimisation"
```

Without it the marketing page's image fails in production and nowhere else,
which is a miserable thing to debug after a cutover.

---

## Step 2 — Create the services from the Blueprint

`render.yaml` at the repository root defines both services: the web service
and the nightly cron job. Create them from it rather than by hand — the cron
job is the thing a manual setup forgets, and losing it silently stops the
nightly retrain, the orphaned-file sweep and the billing sweep.

1. Render dashboard → **New** → **Blueprint**
2. Connect the GitHub repository
3. It reads `render.yaml` and proposes `nyansaai` (web) and
   `nyansaai-nightly` (cron)
4. It will prompt for every variable marked `sync: false` — this is step 3

Note the branch: this project's work is on **`master`**, not `main`. `main`
exists but holds a single empty commit. The Blueprint says `master`; if you
ever rename branches, change it there too.

---

## Step 3 — Environment variables

Copy from Vercel. Two deserve attention:

- **`NEXT_PUBLIC_APP_URL`** — set to `https://www.nyansaai.com`, not the
  `onrender.com` address, or auth emails will link people to the wrong host.
- **`CRON_SECRET`** — must be *identical* on the web service and the cron
  job. They are separate services with separate variables, and a mismatch
  means the nightly job is quietly rejected with a 401 every night.

Leave `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` unset until you are
ready to take payment. The checkout route declines politely when they are
missing rather than pretending a payment succeeded.

---

## Step 4 — First deploy, before any DNS changes

Render gives the service a URL like `nyansaai.onrender.com`. Exercise it
there, while production still runs on Vercel.

```bash
curl -s https://nyansaai.onrender.com/api/health
# {"status":"ok","at":"..."}
```

Then check, in a browser:

- [ ] the marketing homepage renders
- [ ] `/pricing` shows the prices you set (it renders per request)
- [ ] signing in works
- [ ] Ask AI answers a question with citations
- [ ] uploading and training a document completes — this is the long one,
      and the best evidence that no request timeout is biting

Sign-in on the `onrender.com` host needs that URL added to Supabase →
Authentication → URL Configuration → Redirect URLs. Add it for testing,
remove it afterwards.

---

## Step 5 — Domains and certificates

The multi-tenant routing in `src/proxy.ts` means every workspace lives on its
own subdomain, so a single domain is not enough.

In Render → the web service → **Settings** → **Custom Domains**, add:

- `nyansaai.com`
- `www.nyansaai.com`
- `*.nyansaai.com`

Render issues TLS for wildcards, **but the root domain must also point at
Render** or wildcard verification fails. Add all three; do not add only the
wildcard.

Render shows the DNS records to create. Do not point them yet if you want a
controlled cutover — adding the domains in Render is safe while DNS still
resolves to Vercel.

---

## Step 6 — Repoint Supabase

Three settings, all under **Authentication**:

1. **Hooks → Send Email** →
   `https://www.nyansaai.com/api/auth/send-email-hook`
   Keep the existing secret; it must equal `SEND_EMAIL_HOOK_SECRET`.
   Use the **`www`** form. The apex 308-redirects to `www`, and a webhook
   POST that gets redirected is often not followed.
2. **URL Configuration → Site URL** → `https://www.nyansaai.com`
3. **URL Configuration → Redirect URLs** → must include
   `https://*.nyansaai.com/**` for tenant subdomains, plus
   `https://www.nyansaai.com/**`

Because the hook URL keeps the same hostname, this step changes nothing
until DNS moves — which is exactly what you want.

While you are in Supabase: **Authentication → Rate Limits**. The email send
limit defaults low (around 30/hour). Twenty invites plus retries will reach
it. Raise it to match how many people you actually onboard at once.

---

## Step 7 — Repoint Paystack

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:

```
https://www.nyansaai.com/api/billing/webhook
```

Same hostname, so again nothing changes until DNS does. The route verifies
an HMAC signature over the raw body and then re-verifies the transaction
against Paystack, so a misdirected webhook cannot grant access — it simply
means payments stop being applied until you fix it.

---

## Step 8 — Cut over

This is the only step that affects live users. Do it when you can watch.

1. Change the DNS records for `nyansaai.com`, `www` and `*` to the targets
   Render gave you
2. Wait for propagation (minutes, usually)
3. Watch Render → Logs

Then verify, in this order, because each depends on the last:

- [ ] `https://www.nyansaai.com/api/health` returns ok
- [ ] a tenant subdomain loads, e.g. `https://demo.nyansaai.com`
- [ ] sign in with a password
- [ ] **send yourself an invite** — the thing this migration is for
- [ ] **send five invites at once** and confirm all five arrive
- [ ] request an email sign-in link and click it
- [ ] upload and train a document
- [ ] `/pricing` shows the right prices

---

## Step 9 — Afterwards

- Delete `vercel.json`, or leave it; it is inert off Vercel.
- Keep the Vercel project for a week before deleting it. It costs nothing
  idle and is the fastest rollback you have.
- Confirm the nightly job ran: Render → `nyansaai-nightly` → Logs, after the
  first 03:00 UTC. It should print a status and a summary.

---

## Rolling back

Point DNS back at Vercel. That is the whole procedure. Nothing in this
migration writes to the database differently, and no data lives on the host
— documents are in Supabase Storage, everything else in Postgres. Both
platforms can serve the same commit at the same time.

---

## Known traps, specific to this codebase

**Free tier.** A sleeping instance reintroduces exactly the cold-start
problem that breaks the Supabase email hook's five-second budget. If invites
start failing again after a quiet night, check the plan first.

**Build memory.** This is a large Next build with native dependencies
(`@napi-rs/canvas`, `pdf-parse`, `officeparser`). If the build is killed
without a clear error, it ran out of memory — use a larger instance for
building.

**`maxDuration` does nothing here.** Twenty-one route files export it. On
Render it is ignored, which is fine — there is no function limit. What does
apply is any request timeout in front of the app, so document training is
the thing to test (step 4), since it streams for minutes.

**`instrumentation.ts` must keep running.** It patches browser globals
(`DOMMatrix`, `ImageData`, `Path2D`) that `pdf-parse` needs and Node lacks.
Next runs it on server start. If PDF extraction throws
`ReferenceError: DOMMatrix is not defined`, that file did not run.

**The email pool is now meaningful — and still bounded by Microsoft.** The
limit counts connections per *mailbox*, not per process, so one process with
`maxConnections: 2` respects it globally in a way Vercel never could. Do not
raise it far: two is deliberate, and the ceiling is Microsoft's, not ours.

**Health checks must not be redirected.** `/api/health`,
`/api/auth/send-email-hook` and `/api/billing/webhook` are exempted from the
login redirect in `src/proxy.ts`. If you add another server-to-server
endpoint, add it there too, or it will answer a signed webhook with an HTML
login page.
