# Nyansa AI — Data Protection & Confidentiality

As of 7 November 2026.

Nyansa AI is a multi-tenant document intelligence platform. Each client organisation's
documents, extracted data and conversations are isolated at the database level,
encrypted in transit and at rest, and processed by the named sub-processors below.

This document states current, implemented controls. Where something is not in place, it
is listed under Current limitations rather than omitted.

## What data the platform holds

| Data held                 | Where it lives         | Notes                                                   |
| ------------------------- | ---------------------- | ------------------------------------------------------- |
| Original documents        | Private object storage | PDFs, Word files, spreadsheets uploaded by the client    |
| Extracted text and tables | Database               | Passages, plus separately extracted tables and figures   |
| Vector embeddings         | Database               | Numeric representations used to find relevant passages   |
| Questions and answers     | Database               | Conversation history with citations to source documents  |

User account data is limited to name, email address, organisation and role. No payment
details are collected. No special-category personal data is processed unless a client
uploads documents containing it.

## Isolation and access control

Separation between organisations is enforced by the database, not by application code
that could be bypassed.

Every table carrying client data has row-level security enabled. Each database request
runs as the signed-in user and returns only rows belonging to that user's organisation.
An application bug, a malformed request, or a direct call to the data API cannot return
another organisation's rows, because the filter is applied below the application layer.

Three further controls sit on top:

- **Workspace addressing** — each organisation uses its own subdomain; a signed-in user
  reaching another organisation's subdomain is redirected to their own workspace.
- **Membership checks** — a user belongs to exactly one organisation through a
  membership record carrying their role; sign-in against a workspace the account does
  not belong to is rejected explicitly.
- **Server-side permission checks** — role permissions are evaluated server-side on
  every request.

### Verification performed 26 September 2026

All 18 tables holding client data were queried using the public API key that any
visitor's browser carries. Every table returned zero rows — documents, extracted
passages, extracted figures, citations, conversations, memberships, organisations,
authentication codes and the rest. No client data is reachable without an authenticated
session.

## Encryption, storage and sign-in

**In transit.** All traffic runs over HTTPS/TLS, including connections to the database,
object storage and AI providers.

**At rest.** Data is stored on encrypted volumes provided by Supabase (running on AWS).
Encryption at rest is applied at the storage layer by the provider; the platform does
not additionally encrypt individual fields.

**Document storage is private.** Uploaded files live in a storage bucket marked private
(`public=false`), so no file is retrievable by URL without an authorised request. The
only public bucket holds organisation logos, used as browser tab icons and intended to
be public.

**Sign-in.** Passwords are hashed by the authentication provider and are never visible
to us or to administrators. Two-factor authentication is available as an authenticator
app (TOTP) or an emailed six-digit code — the latter stored only as a hash, valid 10
minutes, limited to five attempts and rate-limited between requests. Sessions use signed
cookies scoped to the organisation's domain.

## Sub-processors and data flows

Answering questions over documents requires sending document content to AI providers.
This is stated plainly rather than left to be discovered during review.

| Sub-processor      | What it receives                                       | Purpose                                   |
| ------------------ | ------------------------------------------------------ | ----------------------------------------- |
| Anthropic (Claude) | Passages retrieved for a question, plus the question    | Generating the cited answer               |
| OpenAI             | Document passages, and each question                    | Converting text to embeddings for search  |
| Supabase           | All stored data: documents, text, embeddings, accounts  | Database, authentication, file storage    |
| Vercel             | Requests in transit; application logs                   | Application hosting                       |
| Microsoft 365      | Recipient address and content of authentication emails  | Invitations, password resets, login codes |

Two points a reviewer will reasonably ask about:

- **Document content does leave the platform** when a question is asked and when a
  document is first indexed. It goes only to the providers above, over TLS, for those
  purposes only.
- **Training.** Neither AI provider trains its models on content sent through their
  paid APIs. This is a contractual commitment from each provider, quoted verbatim in
  the next section rather than asserted here.

Hosting and storage are currently in provider regions outside Ghana. Data-residency
requirements should be raised before deployment.

## Model training: what the providers commit to, in their own words

The commonest question a client asks is whether their documents end up training
somebody's AI. They do not. Because that assurance is worth no more than its source,
the commitments are quoted exactly as published, with where to check them.

Both were read from the providers' own pages on **7 November 2026**. Provider terms
change; the dates below are when each page was last confirmed, and they should be
re-checked before being relied on in a signed agreement.

### Anthropic (Claude) — used to generate answers

Commercial Terms of Service, Section B (Customer Content), effective 17 June 2025 —
<https://www.anthropic.com/legal/commercial-terms>

> Anthropic may not train models on Customer Content from Services.

"Customer Content" is defined in the same section as both the Inputs submitted to the
service and the Outputs it generates — so the commitment covers the document passages
we send and the answers that come back. Section E.1 of the same terms adds:

> Customer Content is Customer's Confidential Information.

Anthropic's support documentation states the same thing in plainer words, with the one
exception that exists —
<https://privacy.claude.com/en/articles/7996875>

> We do not use API data for training (unless you have an agreement with us that states
> otherwise).

No such agreement exists for this platform, and none should be entered into.

**Retention.** From Anthropic's retention page, last updated 1 July 2026 —
<https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>

> For Anthropic API users, we automatically delete inputs and outputs on our backend
> within 30 days of receipt or generation

with exceptions for services with longer retention under the customer's control, an
agreed zero-retention arrangement, enforcement of the Usage Policy, and compliance with
law. Content flagged by their automated safety systems is kept longer:

> We retain inputs and outputs for up to 2 years and trust and safety classification
> scores for up to 7 years if your chat is flagged by our automated trust and safety
> systems as violating our Usage Policy.

### OpenAI — used for search embeddings and reranking

Data controls documentation —
<https://developers.openai.com/api/docs/guides/your-data>

> As of March 1, 2023, data sent to the OpenAI API is not used to train or improve
> OpenAI models

> (unless you explicitly opt in to share data with us)

This is the default for API traffic: nothing has to be switched off to obtain it, and
this platform has not opted in. The endpoint table on the same page lists
"Data used for training: No" for every endpoint we use.

**Retention.** From the same page:

> By default, abuse monitoring logs are generated for all API feature usage and retained
> for up to 30 days

continuing "unless longer retention is required by law, or is reasonably necessary to
protect our services or any third party from harm."

### What is NOT yet in place

Stated plainly, because a reviewer will find it anyway.

Both providers offer **Zero Data Retention** — an arrangement where inputs and outputs
are not stored at all, rather than stored for thirty days. **Nyansa AI does not have one
with either provider.** Today, a client's document passages sit in provider logs for up
to thirty days, and longer if automated safety systems flag them.

Neither is self-serve. Anthropic:

> Some Claude Platform (Claude API) and Claude Code for Enterprise customers, subject to
> Anthropic's approval, may have arrangements under which Anthropic does not store their
> inputs or outputs except where needed to comply with law or combat misuse or harm.

obtained by contacting their sales team, reviewed per organisation. OpenAI's equivalent
is "subject to prior approval by OpenAI and acceptance of additional requirements",
likewise through sales, and covers the endpoints this platform uses.

**Recommendation.** Apply for zero data retention with both providers. It costs nothing
to request, it is the single strongest answer to the question clients actually ask, and
without it the honest answer is "your content is not trained on, and it is retained for
thirty days".

### What this document can and cannot prove

- **Verified directly:** the Anthropic Commercial Terms clause, Anthropic's retention
  and zero-retention pages, and OpenAI's data-controls documentation. Quotes above are
  verbatim from those pages on the date given.
- **Not verified directly:** OpenAI's enterprise privacy page and business terms both
  refused automated access (HTTP 403) when checked. The no-training commitment is quoted
  from OpenAI's technical documentation instead, which is a weaker instrument than
  signed terms. Before this goes into a contract, obtain OpenAI's business terms through
  an account manager and quote those.
- **A commitment is not an audit.** These are contractual and documented statements by
  the providers about their own conduct. Neither this platform nor its clients can
  observe provider-side training. What can be shown is which terms apply, that nothing
  has been opted into, and that no agreement exists displacing the default.

## Retention and deletion

Documents and their extracted text, embeddings and citations are retained while the
workspace is active. A senior user can delete a document at any time, removing the
stored file along with its extracted passages and figures. Conversation history is
retained so users can revisit earlier answers.

On termination, an organisation's workspace and associated records can be deleted on
request. A defined retention and deletion schedule should be agreed contractually.

## Current limitations

| Area                | Position today                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit logging       | Questions and uploads are recorded with user identity and timestamp. No dedicated audit trail of permission changes; no exportable compliance report.  |
| Certification       | No ISO 27001, SOC 2 or equivalent certification. Controls here are implemented but not externally audited.                                             |
| Data residency      | No in-country hosting option at present.                                                                                                              |
| Penetration testing | No independent penetration test commissioned to date.                                                                                                 |

Each is a roadmap item rather than a refusal. Where a procurement process requires one,
raise it early so it can be scheduled and priced.

## Internal note — not for client distribution

Row-level security policies are largely **not captured in `supabase/migrations/`** (only
`030_enable_rls_facts_tables.sql` contains policy statements). The live database is
protected, but the posture lives in the Supabase dashboard rather than in version
control. Rebuilding the database from migrations alone would produce an **unprotected**
database. Capturing the existing policies as a migration is the highest-value security
task outstanding.

The public `/security` marketing page claims: *"Every query, upload, and permission
change is logged with a timestamp and user identity for compliance review."* Permission
changes are not logged and there is no compliance-review export. That wording should be
corrected, or the capability built.
