# Nyansa AI — Data Protection & Confidentiality

As of 26 September 2026.

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
- **Training.** Client data is not sent to these providers for model training. Clients
  requiring contractual assurance that content is excluded from provider-side training
  should raise it during contracting so the appropriate provider terms are in place.

Hosting and storage are currently in provider regions outside Ghana. Data-residency
requirements should be raised before deployment.

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
