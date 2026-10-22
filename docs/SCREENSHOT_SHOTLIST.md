# Screenshot shot list — Nyansa AI User Manual

Capture these 16 screens, save them into `docs/screenshots/` using the exact filenames
below, and the documentation build will place each one in the right section automatically.

## Before you start

**Use a demo workspace, not a client's.** Every screenshot must show dummy documents.
Real client filenames, contents or figures must not appear in documentation that goes to
other clients or to buyers.

**Capture settings**
- Browser window at **1440 × 900**, zoom at 100%
- PNG format
- Full window, not the whole desktop — no taskbar, no other tabs
- Light mode
- Sign in as a **Senior** user so admin-only screens are reachable

**Before capturing, seed the demo workspace with:**
- 4–6 dummy documents with plausible but fictional names
  (e.g. `Supplier Agreement - Acme Ltd.pdf`, `Q3 Operations Report.pdf`)
- At least one asked-and-answered question so citations are visible
- Two or three dummy users with different roles

---

## The shots

| # | Filename | Screen | What to set up first |
|---|----------|--------|----------------------|
| 1 | `01-login.png` | `/auth/login` on the demo subdomain | Signed out. Shows the per-tenant branded sign-in. |
| 2 | `02-ask-empty.png` | `/ask` | Freshly loaded, before asking anything. |
| 3 | `03-ask-answer.png` | `/ask` | **The key shot.** An answer on screen with citations visible beneath it. |
| 4 | `04-citation-open.png` | `/ask` | A citation clicked, source document open at the cited page. |
| 5 | `05-documents-list.png` | `/documents` | The demo documents listed, statuses showing. |
| 6 | `06-upload.png` | `/documents` | Upload dialog open, mid-drag if you can manage it. |
| 7 | `07-processing.png` | `/documents` | A document mid-processing, so the status indicator is visible. |
| 8 | `08-dashboards.png` | `/dashboards` | The dashboard overview. |
| 9 | `09-dashboard-detail.png` | `/dashboards/executive` | One dashboard populated with dummy data. |
| 10 | `10-users.png` | `/users` | The user list with the dummy users and their roles. |
| 11 | `11-invite.png` | `/users` | Invite dialog open, email and role fields visible. |
| 12 | `12-settings-profile.png` | `/settings` | Profile section. |
| 13 | `13-settings-2fa.png` | `/settings` | Security section, two-factor options visible. |
| 14 | `14-settings-workspace.png` | `/settings` | Workspace section, showing the icon upload. |
| 15 | `15-training.png` | `/training` | Senior-only training screen. |
| 16 | `16-sidebar.png` | any app screen | Sidebar expanded, workspace icon and nav visible. |

---

## Optional extras

Useful if you want the manual to cover more ground:

| Filename | Screen | Notes |
|----------|--------|-------|
| `17-forgot-password.png` | `/auth/forgot-password` | For the password-reset walkthrough |
| `18-mfa-challenge.png` | `/auth/mfa-challenge` | The two-factor prompt at sign-in |
| `19-insights.png` | `/insights` | If you want insights documented |
| `20-tenants.png` | `/admin/tenants` | Platform-admin only — internal docs, not client-facing |

---

## When you're done

Drop the files into `docs/screenshots/` and say so. Each will be embedded beneath its
section, sized to the page width with a numbered caption, and the document rebuilt as
`Nyansa-AI-User-Manual-Illustrated.docx`.

Partial sets are fine — sections without an image are simply written without one, so
you can start with the six or seven that matter most (1, 3, 4, 5, 6, 10, 11) and add
the rest later.
