-- Enquiries from the public contact form, including the Enterprise "Talk to
-- us" route off the pricing page.
--
-- Purely additive: one table. Nothing is dropped, renamed or deleted.
--
-- Why a table and not just an email. The form promises "we reply within one
-- business day", and until now it sent nothing at all — no handler, no named
-- fields, no route — so every enterprise enquiry was silently discarded while
-- the sender watched the fields clear and assumed it had gone. Replacing that
-- with email alone would trade silent loss for quiet loss: outbound mail is
-- sent after the response has flushed (see the note in
-- src/app/api/auth/send-email-hook/route.ts), so a delivery failure surfaces
-- only in a log nobody reads. A lost 2FA code is an annoyance; a lost
-- enterprise lead is revenue nobody knew arrived. The row is the record and
-- the email is the notification.

create table if not exists public.contact_enquiries (
  id            uuid primary key default gen_random_uuid(),
  first_name    text,
  last_name     text,
  email         text not null,
  organisation  text,
  message       text not null,
  -- Which call to action they came through, e.g. 'pricing_enterprise'. Lets
  -- an enterprise enquiry be recognised as one without reading the message.
  source        text,
  created_at    timestamptz not null default now(),
  -- Set by hand once somebody has replied, so the table can answer "what have
  -- we not got back to yet".
  handled_at    timestamptz
);

create index if not exists contact_enquiries_created_idx
  on public.contact_enquiries (created_at desc);

create index if not exists contact_enquiries_unhandled_idx
  on public.contact_enquiries (created_at desc) where handled_at is null;

-- RLS on with no policies at all: deliberate. These rows are not a tenant's
-- data and no signed-in user has any business reading them, so the only way
-- in is the service role used by /api/contact. A policy added later should be
-- platform-admin only.
alter table public.contact_enquiries enable row level security;
