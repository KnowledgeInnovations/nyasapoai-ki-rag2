-- Records when a workspace was last told that a document finished training
-- incomplete, so the alert fires once per incident rather than on every pass.
--
-- Purely additive: one column. Nothing is dropped, renamed or deleted, and no
-- existing row's data changes. NULL means "never alerted", which is the
-- correct state for every document that exists today.
--
-- Why an alert at all. A document whose fact layer never finished looks
-- healthy: status reads 'ready', and the only sign is a hover tooltip on a
-- badge in the Documents list. A 40-page station register sat in exactly that
-- state with zero facts, and nobody knew until an answer came back thin and
-- somebody thought to ask. The people who need to know are the workspace's
-- Senior users, and they need to be told rather than having to notice.

alter table public.documents
  add column if not exists last_incomplete_alert_at timestamptz;

comment on column public.documents.last_incomplete_alert_at is
  'When Senior users were last notified that this document finished training incomplete. Used to suppress repeat alerts for the same ongoing incident.';
