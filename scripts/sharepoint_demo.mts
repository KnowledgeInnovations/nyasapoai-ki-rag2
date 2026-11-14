/**
 * One command to try the SharePoint connector by hand.
 *
 *   npm run sharepoint:demo
 *
 * Starts the fake SharePoint and the dev server together, with the dev
 * server already pointed at the fake one, so the Connections screen
 * behaves exactly as it would against a real Microsoft 365 tenant — no
 * Azure registration, no administrator, no waiting for a site grant.
 *
 * Why a launcher rather than a line in the README: the three variables
 * that point the connector at the sandbox have to be set on the dev
 * server's own process, and setting those by hand on Windows, macOS and
 * CI each takes different syntax. Getting one of them wrong produces a
 * screen that says SharePoint is not configured, which reads like a bug
 * in the feature rather than a typo in a shell command.
 *
 * Both processes stop together on Ctrl-C.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

const PORT = Number(process.env.SHAREPOINT_DEMO_PORT ?? 4000)
const LIBRARY = path.join(process.cwd(), 'sandbox', 'library')

/* ── a library with something in it ───────────────────────────────── */
// An empty library makes for a confusing first run: the connector is
// working perfectly and the screen reports nothing imported. These are
// written only if the folder is new, so anything put there by hand on a
// previous run survives.
if (!fs.existsSync(LIBRARY)) {
  fs.mkdirSync(LIBRARY, { recursive: true })
  const samples: [string, string][] = [
    ['board-minutes.txt',
     'Board minutes, March 2026.\n\nThe board approved a total budget of GHS 4,200,000 for the 2026 financial year.\nCapital expenditure is capped at GHS 900,000.\nThe next review is scheduled for September 2026.\n'],
    ['travel-policy.txt',
     'Travel policy.\n\nFlights under six hours are booked in economy class.\nFlights over six hours may be booked in premium economy with the approval of a director.\nPer diem is GHS 450 within Ghana and USD 85 outside it.\n'],
    ['staff-handbook.txt',
     'Staff handbook, extract.\n\nThe notice period is three months for senior staff and one month for all other staff.\nAnnual leave is 24 working days.\nProbation lasts six months.\n'],
  ]
  for (const [name, body] of samples) fs.writeFileSync(path.join(LIBRARY, name), body, 'utf8')
  console.log(`created a sample library at ${LIBRARY}`)
}

/* ── the fake SharePoint ──────────────────────────────────────────── */
const sandbox = spawn(
  process.execPath,
  [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/sharepoint_sandbox.mts',
   '--port', String(PORT), '--dir', LIBRARY],
  { stdio: 'inherit' },
)

/* ── the app, pointed at it ───────────────────────────────────────── */
const dev: ChildProcess = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    MS_LOGIN_BASE_URL: `http://localhost:${PORT}`,
    MS_GRAPH_BASE_URL: `http://localhost:${PORT}/v1.0`,
    MS_GRAPH_CLIENT_ID: 'sandbox',
    MS_GRAPH_CLIENT_SECRET: 'sandbox',
  },
})

console.log('')
console.log('── the SharePoint demo ─────────────────────────────────────')
console.log(`  library folder : ${LIBRARY}`)
console.log('                   put files here and they are files in the library')
console.log('')
console.log('  On the Connections screen, enter this as the directory (tenant) ID:')
console.log('    sandbox-tenant')
console.log('')
console.log('  Make it misbehave on demand:')
console.log(`    curl -X POST localhost:${PORT}/_control/throttle-next    # next request gets a 429`)
console.log(`    curl -X POST localhost:${PORT}/_control/expire-cursors   # next sync's cursor is rejected`)
console.log('')
console.log('  Importing needs AI document processing switched on, under')
console.log('  /admin/tenants. With it off, connecting and discovery work and')
console.log('  the sync declines with a message saying exactly that.')
console.log('────────────────────────────────────────────────────────────')
console.log('')

const stop = () => { sandbox.kill(); dev.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
dev.on('exit', code => { sandbox.kill(); process.exit(code ?? 0) })
