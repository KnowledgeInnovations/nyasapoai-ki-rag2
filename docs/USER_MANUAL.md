# Nyansa AI — User Manual

Nyansa AI turns your organisation's documents into a searchable knowledge base that
answers questions in plain English, citing the source document and page for every answer.

## Signing in

Your organisation has its own address, for example `yourorganisation.nyansaai.com`.
Sign in there with your email address and password.

If you were invited, you will have received an email link to set your own password.
Administrators never see or set user passwords.

Two-factor authentication is optional and available in two forms, set up under
Settings → Security:

- **Authenticator app** — a rotating code from Google Authenticator, Authy or similar.
- **Email code** — a six-digit code sent to your address, valid for 10 minutes.

## Roles

Your role determines what you can do. Permissions are enforced on the server for every
request, not just hidden in the interface.

| Role   | Ask questions | Upload documents | Delete documents | Dashboards | Manage users |
| ------ | ------------- | ---------------- | ---------------- | ---------- | ------------ |
| Senior | Yes           | Yes              | Yes              | Yes        | Yes          |
| Middle | Yes           | Yes              | No               | Yes        | No           |
| Junior | Yes           | No               | No               | No         | No           |

## The core workflow

1. **Upload.** Drag documents onto the Documents page — PDFs, Word files and
   spreadsheets. Text, tables and figures are extracted automatically. Large files keep
   processing in the background; you can leave the page.
2. **Ask.** Type a question in plain English on the Ask page. The system searches every
   document in your workspace at once. No search operators needed.
3. **Verify.** Every answer carries citations naming the source document and page. Open
   a citation to read the original passage and confirm the answer for yourself.
4. **Review.** Dashboards summarise recurring themes and figures across your documents,
   for roles with access.

## Administration

Senior users can, from the Users page:

- Invite a colleague by email address and assign their role
- Change an existing user's role
- Remove a user's access

From Settings → Workspace, senior users can also set the workspace icon, which appears
in the browser tab and on the sidebar.

## Getting help

If an answer looks wrong, open its citation first — the source passage usually explains
why the answer came out the way it did. If a document appears not to have been read,
check the Documents page: it shows processing status per file.
