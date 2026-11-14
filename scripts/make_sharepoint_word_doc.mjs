/**
 * Builds docs/Connecting SharePoint to Nyansa AI.docx
 *
 *   node scripts/make_sharepoint_word_doc.mjs "docs/Connecting SharePoint to Nyansa AI.docx"
 *
 * The Word version of docs/SHAREPOINT.md, rewritten for someone who has
 * never used SharePoint and has to hand the Azure half to an
 * administrator. Kept as a script rather than only as a binary so the
 * document can be regenerated when the setup steps change, instead of the
 * .docx silently drifting away from the guide beside it.
 *
 * Afterwards, strip the archive's folder entries — Word has refused files
 * that carry them when opened through a cloud co-editing service:
 *
 *   python -c "import zipfile,os,sys; f=sys.argv[1]; z=zipfile.ZipFile(f);  *     items=[i for i in z.infolist() if not i.filename.endswith('/')];  *     items.sort(key=lambda i: 0 if i.filename=='[Content_Types].xml' else 1);  *     o=zipfile.ZipFile(f+'.t','w',zipfile.ZIP_DEFLATED);  *     [o.writestr(i, z.read(i.filename)) for i in items]; o.close(); z.close();  *     os.replace(f+'.t', f)" "docs/Connecting SharePoint to Nyansa AI.docx"
 */
import fs from 'node:fs'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, convertInchesToTwip,
} from 'docx'

const CONTENT = 9026 // A4 width (11906 dxa) minus 1 inch margins each side

const BRAND = '1F5C4A'
const INK = '1A1A1A'
const GREY = '5A5A5A'

/* ── small helpers ─────────────────────────────────────────────── */

const p = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, ...(opts.run ?? {}) })],
  spacing: { after: opts.after ?? 140, line: 300 },
  ...(opts.paragraph ?? {}),
})

const rich = (runs, opts = {}) => new Paragraph({
  children: runs.map(r => (typeof r === 'string' ? new TextRun({ text: r }) : new TextRun(r))),
  spacing: { after: opts.after ?? 140, line: 300 },
  ...(opts.paragraph ?? {}),
})

const bullet = (runs) => new Paragraph({
  children: (Array.isArray(runs) ? runs : [runs]).map(r =>
    (typeof r === 'string' ? new TextRun({ text: r }) : new TextRun(r))),
  numbering: { reference: 'dots', level: 0 },
  spacing: { after: 80, line: 300 },
})

const step = (reference, runs) => new Paragraph({
  children: (Array.isArray(runs) ? runs : [runs]).map(r =>
    (typeof r === 'string' ? new TextRun({ text: r }) : new TextRun(r))),
  numbering: { reference, level: 0 },
  spacing: { after: 100, line: 300 },
})

const mono = (text) => new Paragraph({
  children: [new TextRun({ text, font: 'Consolas', size: 18, color: '2A2A2A' })],
  spacing: { after: 60, line: 260 },
  indent: { left: convertInchesToTwip(0.3) },
})

const rule = () => new Paragraph({
  text: '',
  spacing: { before: 60, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8D8D8', space: 6 } },
})

/** A callout box: one shaded, bordered cell. */
const callout = (title, lines, tint) => new Table({
  columnWidths: [CONTENT],
  width: { size: CONTENT, type: WidthType.DXA },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 6, color: tint.border },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: tint.border },
    left:   { style: BorderStyle.SINGLE, size: 18, color: tint.border },
    right:  { style: BorderStyle.SINGLE, size: 6, color: tint.border },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  },
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: CONTENT, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: tint.fill, color: 'auto' },
      margins: { top: 160, bottom: 160, left: 200, right: 200 },
      children: [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, color: tint.text, size: 21 })],
          spacing: { after: 90, line: 300 },
        }),
        ...lines.map(line => new Paragraph({
          children: (Array.isArray(line) ? line : [line]).map(r =>
            (typeof r === 'string' ? new TextRun({ text: r, color: tint.text, size: 21 })
              : new TextRun({ color: tint.text, size: 21, ...r }))),
          spacing: { after: 70, line: 300 },
        })),
      ],
    })],
  })],
})

const AMBER = { fill: 'FDF6E3', border: 'D9A842', text: '6B4E0F' }
const SLATE = { fill: 'F2F5F4', border: BRAND, text: '1F3B34' }
const ROSE  = { fill: 'FCF2F2', border: 'C14A4A', text: '7A2222' }

/** Two-column table with a header row. */
const table2 = (head, rows, widths) => new Table({
  columnWidths: widths,
  width: { size: CONTENT, type: WidthType.DXA },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    left:   { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    right:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E2E2' },
    insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: 'E2E2E2' },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      children: head.map((h, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'EDF1F0', color: 'auto' },
        margins: { top: 110, bottom: 110, left: 150, right: 150 },
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, size: 20, color: '1F3B34' })],
          spacing: { after: 0, line: 280 },
        })],
      })),
    }),
    ...rows.map(cells => new TableRow({
      children: cells.map((c, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        margins: { top: 110, bottom: 110, left: 150, right: 150 },
        children: [new Paragraph({
          children: [new TextRun({ text: c, size: 20 })],
          spacing: { after: 0, line: 280 },
        })],
      })),
    })),
  ],
})

/* ── the document ──────────────────────────────────────────────── */

const children = []

// Title block
children.push(new Paragraph({
  children: [new TextRun({ text: 'Connecting SharePoint to Nyansa AI', bold: true, size: 44, color: INK, font: 'Georgia' })],
  spacing: { after: 100, line: 340 },
}))
children.push(new Paragraph({
  children: [new TextRun({
    text: 'How to let Nyansa AI read the documents you already keep in Microsoft 365.',
    size: 24, color: GREY, italics: true,
  })],
  spacing: { after: 60, line: 320 },
}))
children.push(rule())

// ── In one paragraph ──
children.push(new Paragraph({ text: 'The short version', heading: HeadingLevel.HEADING_1 }))
children.push(p('Most organisations already keep their documents in Microsoft 365. Connecting that storage to Nyansa AI means you stop uploading documents by hand. You point Nyansa AI at one folder, it brings in what is there, and it keeps itself up to date as files are added, changed or removed.'))
children.push(p('Setting it up is three jobs, done once, in this order: your Microsoft 365 administrator registers an application in Azure; two values from that registration are added to the Nyansa AI deployment; then a Senior member connects a library from the Connections screen. The first two are the reason your screen currently says SharePoint is not set up.'))

// ── The three words ──
children.push(new Paragraph({ text: 'SharePoint, OneDrive, and "document libraries"', heading: HeadingLevel.HEADING_1 }))
children.push(p('These three words cause most of the confusion, so here they are plainly.'))
children.push(bullet([{ text: 'OneDrive ', bold: true }, 'is one person’s own file storage.']))
children.push(bullet([{ text: 'A SharePoint site ', bold: true }, 'belongs to a team or a department — Finance, HR, Legal.']))
children.push(bullet([{ text: 'A document library ', bold: true }, 'is a folder tree inside a site that the whole team shares.']))
children.push(p('Underneath, Microsoft treats all three the same way, and so does Nyansa AI. When somebody says “our files are in SharePoint”, they almost always mean a document library inside a site. That is what you connect — one library at a time, deliberately, not “everything the company owns”.', { after: 200 }))

// ── What happens once connected ──
children.push(new Paragraph({ text: 'What happens once a library is connected', heading: HeadingLevel.HEADING_1 }))
children.push(table2(
  ['In SharePoint', 'In Nyansa AI'],
  [
    ['A file is added', 'It is brought in and read, and people can ask questions about it'],
    ['A file is changed', 'The same document is updated. You do not end up with two copies'],
    ['A file is deleted', 'The document is removed and stops appearing in answers'],
    ['Nothing changed', 'Nothing happens, and nothing is spent'],
  ],
  [2900, 6126],
))
children.push(new Paragraph({ text: '', spacing: { after: 160 } }))
children.push(p('That last row matters for your bill. Reading a document costs money every time — pulling the text out, indexing it, extracting the facts — so Nyansa AI asks Microsoft “what changed since last time” rather than reading the library again. A nightly check over an unchanged library of two thousand files costs a single request.', { after: 200 }))

// ── Why the screen says not set up ──
children.push(new Paragraph({ text: 'Why your screen says it is not set up yet', heading: HeadingLevel.HEADING_1 }))
children.push(p('The Connections screen is currently showing this:'))
children.push(callout('SharePoint is not set up on this deployment yet.', [
  'It needs an Azure application registered once, by someone with administrator rights in your Microsoft 365 tenant — about fifteen minutes.',
], AMBER))
children.push(new Paragraph({ text: '', spacing: { after: 160 } }))
children.push(p('Nothing is broken and nothing is missing from the product. That message means this installation has not yet been given permission to talk to Microsoft. Two things are needed, once:'))
children.push(step('why', 'Someone with administrator rights in your Microsoft 365 registers an application in Azure. About fifteen minutes. This is Part 1 below.'))
children.push(step('why', 'Two values from that registration are added to the Nyansa AI deployment. This is Part 2 below.'))
children.push(p('Until both are done the screen can list connections but cannot make one. Once they are, the amber message disappears and a Connect a library button appears in its place.', { after: 200 }))

// ── Part 1 ──
children.push(new Paragraph({ text: 'Part 1 — the one-time Azure setup', heading: HeadingLevel.HEADING_1 }))
children.push(rich([
  { text: 'Who does this: ', bold: true },
  'someone with administrator rights in your Microsoft 365 (Microsoft Entra ID). About fifteen minutes. It is done once for the whole platform, not once per customer.',
]))

children.push(new Paragraph({ text: 'Step 1 — register the application', heading: HeadingLevel.HEADING_2 }))
children.push(p('In the Azure portal, go to Microsoft Entra ID, then App registrations, then New registration. Give it a name a future administrator will recognise, such as “Nyansa AI document sync”. No redirect URI is needed — this never acts on behalf of a person who is signed in.'))

children.push(new Paragraph({ text: 'Step 2 — ask for the right permission', heading: HeadingLevel.HEADING_2 }))
children.push(rich([
  'Go to API permissions, then Add a permission, then Microsoft Graph, then Application permissions. Add ',
  { text: 'Sites.Selected', bold: true, font: 'Consolas', size: 20 },
  '. Then click ',
  { text: 'Grant admin consent', bold: true },
  '.',
]))
children.push(callout('Ask for Sites.Selected, never Sites.Read.All', [
  [{ text: 'Sites.Read.All', bold: true, font: 'Consolas', size: 20 }, { text: ' reads every site in the company — Finance, HR, Legal, all of it. An administrator asked for that will usually, and rightly, refuse.' }],
  [{ text: 'Sites.Selected', bold: true, font: 'Consolas', size: 20 }, { text: ' grants nothing at all until an administrator names a specific site. The application can see only what it has been pointed at. This is the difference that gets the request approved.' }],
], SLATE))
children.push(new Paragraph({ text: '', spacing: { after: 160 } }))

children.push(new Paragraph({ text: 'Step 3 — create a client secret', heading: HeadingLevel.HEADING_2 }))
children.push(rich([
  'Go to Certificates & secrets, then New client secret. ',
  { text: 'Copy the value immediately — Azure shows it once and never again.', bold: true },
]))
children.push(p('You now need three values written down. All three are on the application’s pages in Azure:'))
children.push(bullet([{ text: 'Application (client) ID', bold: true }, ' — on the Overview page']))
children.push(bullet([{ text: 'Client secret value', bold: true }, ' — the one you just copied']))
children.push(bullet([{ text: 'Directory (tenant) ID', bold: true }, ' — also on the Overview page. You need this in Part 3']))

children.push(new Paragraph({ text: 'Step 4 — give the application access to the specific site', heading: HeadingLevel.HEADING_2 }))
children.push(p('This step is the one people miss. With Sites.Selected, granting consent on its own does nothing at all — the administrator must also grant the application a role on each site that should be readable. It is done through Microsoft Graph itself, for which Graph Explorer in the browser is enough:'))
children.push(mono('POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions'))
children.push(mono('{'))
children.push(mono('  "roles": ["read"],'))
children.push(mono('  "grantedToIdentities": [{'))
children.push(mono('    "application": {'))
children.push(mono('      "id": "<the Application (client) ID>",'))
children.push(mono('      "displayName": "Nyansa AI document sync"'))
children.push(mono('    }'))
children.push(mono('  }]'))
children.push(mono('}'))
children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
children.push(rich([
  'Ask for ',
  { text: 'read', bold: true, font: 'Consolas', size: 20 },
  ', never ',
  { text: 'write', bold: true, font: 'Consolas', size: 20 },
  '. Nyansa AI never writes anything back to SharePoint, and asking for write access is a different and much longer conversation with a security team.',
]))
children.push(p('Allow up to half an hour before the grant takes effect. SharePoint caches permissions, so the change is not instant — if the site does not appear straight away, that is usually why.', { after: 200 }))

// ── Part 2 ──
children.push(new Paragraph({ text: 'Part 2 — add the two values to the deployment', heading: HeadingLevel.HEADING_1 }))
children.push(rich([
  { text: 'Who does this: ', bold: true },
  'you, or whoever manages the hosting. Add these two settings to the deployment’s environment, then redeploy.',
]))
children.push(mono('MS_GRAPH_CLIENT_ID      = the Application (client) ID'))
children.push(mono('MS_GRAPH_CLIENT_SECRET  = the client secret value'))
children.push(new Paragraph({ text: '', spacing: { after: 140 } }))
children.push(p('That is what turns the amber message off. If both are missing, the feature is simply off: the nightly sync reports itself as skipped rather than failing, so nothing starts going red in the logs.'))
children.push(callout('Customers never give you their client secret', [
  'One application is registered, by you, once. Each customer’s administrator consents to that application inside their own Microsoft 365 and grants it the sites they choose. Nyansa AI stores only which Microsoft 365 to ask for access.',
  'This is deliberate. A table holding customers’ client secrets would be the most valuable row in the database — a key that reads an entire document estate, held by us. Not holding it is the design.',
], SLATE))
children.push(new Paragraph({ text: '', spacing: { after: 200 } }))

// ── Part 3 ──
children.push(new Paragraph({ text: 'Part 3 — connect a library', heading: HeadingLevel.HEADING_1 }))
children.push(rich([
  { text: 'Who does this: ', bold: true },
  'a Senior member of the workspace. Go to Settings, then Connections, then Connect a library. The screen asks five things, in this order.',
]))
children.push(step('connect', [{ text: 'The Directory (tenant) ID. ', bold: true }, 'Paste the value from Step 3. It is a string of letters and numbers, not your domain name. Then press Find sites.']))
children.push(step('connect', [{ text: 'The site. ', bold: true }, 'The list shows only the sites your administrator granted in Step 4. If it comes back empty, Step 4 was not done, or has not taken effect yet.']))
children.push(step('connect', [{ text: 'The document library. ', bold: true }, 'Most sites have one, called Documents.']))
children.push(step('connect', [{ text: 'A name for it in Nyansa AI. ', bold: true }, 'Something you will recognise in six months, such as “Finance — Board papers”.']))
children.push(step('connect', [{ text: 'Who may read what comes in. ', bold: true }, 'Read the next section before you choose this one.']))
children.push(p('Then press Connect this library. Nothing is imported at that moment — press Sync now to bring the files in straight away, or leave it and the nightly run will do it.', { after: 200 }))

// ── The permissions warning ──
children.push(new Paragraph({ text: 'Important: who will be able to read these files', heading: HeadingLevel.HEADING_1 }))
children.push(callout('SharePoint’s own per-file permissions are not copied across', [
  'Nyansa AI cannot see who is allowed to open each individual file in SharePoint. Every file in the library gets the one level you choose at step 5.',
  'So if a file in that library is restricted to three people in SharePoint, connecting the library makes it readable by everyone the level you chose allows.',
], ROSE))
children.push(new Paragraph({ text: '', spacing: { after: 160 } }))
children.push(p('The four levels:'))
children.push(bullet([{ text: 'Public ', bold: true }, '— anyone with access to the workspace, including the public pages.']))
children.push(bullet([{ text: 'Internal ', bold: true }, '— every member of the workspace. The usual choice.']))
children.push(bullet([{ text: 'Confidential ', bold: true }, '— Senior members only.']))
children.push(bullet([{ text: 'Restricted ', bold: true }, '— Senior members only. For board, legal and personnel material.']))
children.push(rich([
  { text: 'The rule of thumb: ', bold: true },
  'connect libraries whose contents the whole group may read, and set the level to match. A library with mixed per-file permissions is the wrong thing to connect — split it in SharePoint first, or connect only the part that is safe to share.',
]))
children.push(p('Changing the level later also moves the documents that have already been brought in, not just the ones that arrive afterwards. So if you pick the wrong level you can correct it, and the correction is real.', { after: 200 }))

// ── Troubleshooting ──
children.push(new Paragraph({ text: 'If something goes wrong', heading: HeadingLevel.HEADING_1 }))
children.push(table2(
  ['What you see', 'What it usually means'],
  [
    ['The amber “not set up” message', 'Part 2 has not been done, or the deployment has not been restarted since'],
    ['“Could not obtain a Microsoft Graph token”', 'Wrong client ID or secret, or admin consent was never granted'],
    ['No sites in the list', 'Step 4 was not done, or has not taken effect yet. Wait half an hour'],
    ['Microsoft refused access to that site', 'Same cause: the site grant in Step 4 is missing'],
    ['Microsoft could not find that site', 'The site ID is wrong'],
    ['Last sync says “partial”', 'Normal for a large library. It stopped on its time budget and the next run carries on from where it stopped'],
    ['Repeated “throttled” messages', 'A large first import hitting the Microsoft rate limit. It waits and resumes. Not an error'],
    ['Nothing imports, and no error', 'AI document processing is switched off. See the note below'],
    ['Files declined by plan limits', 'The workspace is at its document, storage or file-size allowance. The sync names which files and why'],
  ],
  [3300, 5726],
))
children.push(new Paragraph({ text: '', spacing: { after: 200 } }))

// ── Trying it without Azure ──
children.push(new Paragraph({ text: 'Trying it before Azure is ready', heading: HeadingLevel.HEADING_1 }))
children.push(p('You do not need Microsoft 365 to see the feature work. There is a sandbox: a small program that pretends to be SharePoint and serves a folder on your own computer. Run:'))
children.push(mono('npm run sharepoint:demo'))
children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
children.push(rich([
  'It prints the folder it is serving and seeds it with three sample documents. On the Connections screen, type ',
  { text: 'sandbox-tenant', bold: true, font: 'Consolas', size: 20 },
  ' as the Directory (tenant) ID. Files you put in that folder are files in the library: add one and it is imported, edit one and it is updated, delete one and the document goes.',
]))
children.push(callout('One thing to switch on first', [
  'Bringing documents in needs AI document processing switched on, under /admin/tenants. It is currently off.',
  'With it off, connecting and finding libraries both work normally, and the sync declines with a message saying exactly that — rather than filling the workspace with documents nothing can read.',
], AMBER))

const doc = new Document({
  creator: 'Nyansa AI',
  title: 'Connecting SharePoint to Nyansa AI',
  description: 'A plain-language guide to connecting a SharePoint document library to Nyansa AI.',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: INK } },
      title: {
        run: { font: 'Georgia', size: 44, bold: true, color: INK },
        paragraph: { spacing: { before: 0, after: 120 }, keepNext: true },
      },
      heading1: {
        run: { font: 'Georgia', size: 30, bold: true, color: BRAND },
        paragraph: { spacing: { before: 320, after: 140 }, keepNext: true },
      },
      heading2: {
        run: { font: 'Calibri', size: 24, bold: true, color: INK },
        paragraph: { spacing: { before: 220, after: 100 }, keepNext: true },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'dots',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.18) } } },
        }],
      },
      {
        reference: 'why',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
      {
        reference: 'connect',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    children,
  }],
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(process.argv[2], buf)
  console.log('wrote ' + process.argv[2] + ' (' + buf.length + ' bytes)')
})
