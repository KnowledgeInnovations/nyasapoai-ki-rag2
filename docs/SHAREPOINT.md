# Connecting a SharePoint library

For whoever sets this up, and for anyone who has to explain it to a
customer. It assumes no prior knowledge of SharePoint or Microsoft Graph.

## What SharePoint and OneDrive actually are

Microsoft 365 stores files in two places that are, underneath, the same
thing:

- **OneDrive** is one person's own file storage. Their documents, shared
  by them, with whoever they choose.
- **A SharePoint site** belongs to a team or a department. Inside a site
  there are one or more **document libraries** — a library is just a
  folder tree that the whole team can see.

Microsoft's API calls both of them a **drive**. A person's OneDrive is a
drive; each SharePoint document library is a drive. They behave
identically once you have the drive's id, which is why this connector
handles both without knowing the difference.

The thing a customer means by "our files are in SharePoint" is almost
always *a document library inside a site*. That is what gets connected:
one library at a time, deliberately, not "everything the company owns".

## What this connector does

Once a library is connected, it mirrors it:

| In SharePoint | In the workspace |
|---|---|
| A file is added | It is imported and read, and becomes answerable |
| A file is edited | The same document is updated, not duplicated |
| A file is deleted | The document is removed and stops being answerable |
| Nothing changed | Nothing happens, and nothing is spent |

The last row matters more than it looks. Every file the platform reads
costs money — text extraction, embeddings, fact extraction — so the
connector asks Microsoft "what changed since last time" rather than
re-reading the library. A nightly sync over an unchanged library of two
thousand files costs one request.

## Setting it up in Azure

This is done once, by someone with administrator rights in the Microsoft
365 tenant. About fifteen minutes.

**1. Register the application.** In the Azure portal, under *Microsoft
Entra ID → App registrations → New registration*, create an application.
Name it something a future administrator will recognise, e.g. "Nyansa AI
document sync". No redirect URI is needed — this never acts on behalf of
a signed-in person.

**2. Add the permission.** Under *API permissions → Add a permission →
Microsoft Graph → Application permissions*, add **`Sites.Selected`**.
Then click **Grant admin consent**.

Use `Sites.Selected` and not `Sites.Read.All`. The difference is the whole
security story:

- `Sites.Read.All` reads **every site collection in the tenant**. Finance,
  HR, Legal, the lot. An administrator being asked for that will usually,
  and correctly, say no.
- `Sites.Selected` grants **nothing at all** until an administrator
  separately names a site. The application can see only what it has been
  pointed at.

**3. Create a client secret.** Under *Certificates & secrets → New client
secret*. Copy the value immediately; Azure shows it once. Set it as
`MS_GRAPH_CLIENT_SECRET` on the deployment, with the Application (client)
ID as `MS_GRAPH_CLIENT_ID`.

**4. Grant access to the specific site.** With `Sites.Selected`, consent
alone does nothing — the administrator must grant the app a role on each
site, which is done through Graph itself:

```
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
{
  "roles": ["read"],
  "grantedToIdentities": [
    { "application": { "id": "<client-id>", "displayName": "Nyansa AI document sync" } }
  ]
}
```

Ask for `read`, never `write`. The connector never writes to SharePoint,
and a write grant is a different conversation with a security team.

Allow up to half an hour before the grant takes effect — SharePoint caches
permissions and the change is not instant.

## One environment variable per deployment, not per customer

A customer never hands us a client secret. The platform registers **one**
application; each customer's administrator consents to it inside their own
tenant and grants it the sites they choose. All we store is which Microsoft
365 tenant to ask for a token.

This is deliberate. A table holding customer client secrets would be the
most valuable row in the database — a credential that reads an entire
document estate, held by us, one mistake away from being read by someone
else. Not holding it is the design, not an optimisation.

```
MS_GRAPH_CLIENT_ID=<the application (client) id>
MS_GRAPH_CLIENT_SECRET=<the client secret value>
```

Both unset means the feature is simply off, and the nightly sync reports
itself as skipped rather than failing.

## The limitation to tell customers about, before they ask

**SharePoint's own per-file permissions are not mirrored.** Application
access reads everything in a granted library regardless of who could open
it in SharePoint. If a file in that library is restricted to three people,
connecting the library makes it answerable by everyone in the workspace.

So a connection carries a **sensitivity level**, and every document it
creates inherits it. Connect a library of board papers as *Confidential*
and only Senior members can reach it, the same as an uploaded document.
That protection is real and enforced in the database (migration 051).

What it is not is a mirror of SharePoint's permissions. The honest framing
for a customer is: *connect libraries whose contents the whole workspace —
or a whole role — may read, and set the level to match.* A library with
mixed per-file permissions is the wrong thing to connect.

Mirroring real ACLs is possible but needs `Sites.FullControl.All`, which is
a much larger consent ask, and per-user permission checks on every answer.
It is a project, not a setting.

## Testing it without Azure

There is a sandbox: a small program that pretends to be SharePoint, serving
a folder on your computer.

```bash
npx tsx scripts/sharepoint_sandbox.mts
```

It prints the folder it is serving. **Put files in that folder and they are
files in the library.** Edit one and it is an edit; delete one and it is a
deletion. Point the connector at it:

```
MS_LOGIN_BASE_URL=http://localhost:4000
MS_GRAPH_BASE_URL=http://localhost:4000/v1.0
MS_GRAPH_CLIENT_ID=sandbox
MS_GRAPH_CLIENT_SECRET=sandbox
```

It can also be told to misbehave on demand, which is the part that is hard
to arrange against a real tenant:

```bash
curl -X POST localhost:4000/_control/throttle-next    # next request gets a 429
curl -X POST localhost:4000/_control/expire-cursors   # next sync's cursor is rejected
curl -X POST localhost:4000/_control/state            # what the sandbox is serving
```

Three checks run against it, in increasing scope:

```bash
npx tsx scripts/sharepoint_graph_test.mts     # the Graph conversation alone
npx tsx scripts/sharepoint_sync_test.mts      # the sync engine, through the database
npx tsx scripts/sharepoint_connect_test.mts   # the screen's API, over real HTTP
```

The first needs nothing but the sandbox. The second adds the database:
import, skip unchanged, update an edit, remove a deletion, survive
throttling, recover an expired cursor. The third needs the dev server
running with the sandbox's variables, and covers what the first two
cannot reach — that an anonymous caller and a Junior are both refused,
that a Senior can discover and connect, that the same library cannot be
connected twice, that raising a connection's level relabels the documents
already imported, and that both disconnect paths do what they say.

Each creates its own scratch workspace and deletes everything it made on
the way out, including when it fails.

Two of the third script's cases need the platform's AI document
processing switch on, since importing is what that switch governs. With
it off they are reported as SKIPPED rather than quietly passing, and the
script seeds the rows an import would have written so that the paths
which *delete* things are still exercised.

## When something goes wrong

| Symptom | Usually means |
|---|---|
| `Could not obtain a Microsoft Graph token` | Wrong client id or secret, or consent was never granted |
| Graph 403 on a site | The site grant in step 4 was not made, or has not propagated yet |
| Graph 429, repeatedly | A large first import hitting the tenant's rate limit. The connector waits and resumes; it is not an error |
| `last_sync_status = partial` | Normal for a large library. The run stopped on its time budget and the next one continues |
| Nothing imports, no error | Check the AI switch on `/admin/tenants` — with document processing off, the sync skips rather than importing documents nothing can read |
| Files declined by plan limits | The workspace is at its document, storage or file-size allowance. The sync reports which files and why |

## Connecting one, in the product

Settings then **Connections**, which only a Senior member sees. The flow
follows the shape of Microsoft 365 rather than hiding it, because every
shortcut around it ends with someone connecting the wrong thing:

1. the Microsoft 365 **directory (tenant) ID**
2. a **site**, from the ones the application has been granted
3. a **document library** inside that site
4. a **name** for it here
5. the **sensitivity level** every document from it will carry

Nothing is saved until the site has been confirmed readable, so a
connection that appears on the screen is one that works. An empty site
list at step 2 means step 4 of the Azure setup has not been done, and the
screen says so rather than claiming there are no sites.

Each connection can then be **synced now** (a shorter budget than the
nightly run, since someone is waiting), **paused**, have its **level
changed** — which relabels the documents already imported, not just the
next ones — or be **disconnected**. Disconnecting asks which question is
being answered: stop syncing and keep the documents, or remove them too.
Keeping them is the default, because "stop syncing this" and "delete the
work already done" are different requests.

Connecting, changing and disconnecting are all written to the audit log,
with the library and its level, since that pair is what a security review
asks about.

## What is not built yet

- **Near-real-time sync.** Microsoft can push a notification when a library
  changes, which would cut the delay from a day to about a minute. The
  connector polls instead. Worth adding, not worth blocking on.
- **OneDrive for individual people.** The code handles any drive, but
  nothing yet enumerates a person's own OneDrive or decides whose it would
  be appropriate to read.
