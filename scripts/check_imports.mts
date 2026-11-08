/**
 * Does every import resolve with EXACTLY the case on disk?
 *
 * Windows and macOS do not care about the case of a filename. Vercel's
 * Linux builders do. An import written '@/lib/modelswitch' for a file
 * named modelSwitch.ts compiles on a developer's machine, passes review,
 * and fails the deployment in seconds with an error that points at the
 * import rather than at the filesystem difference causing it.
 *
 * This is the cheapest class of deployment failure to prevent and one of
 * the most confusing to diagnose, because the code is correct everywhere
 * it is read. Run it before pushing: `npm run check`.
 *
 * Exits non-zero on any mismatch or unresolved local import.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(p)
  }
  return out
}

/** The real on-disk spelling of a path, segment by segment. */
function actualCase(target: string): string | null {
  const rel = path.relative(ROOT, target)
  let cur = ROOT
  for (const seg of rel.split(path.sep)) {
    const entries = fs.readdirSync(cur)
    const hit = entries.find(e => e.toLowerCase() === seg.toLowerCase())
    if (!hit) return null
    cur = path.join(cur, hit)
  }
  return cur
}

const EXTS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '/index.ts', '/index.tsx']

let checked = 0
const problems: string[] = []

for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8')
  const specs = [
    ...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g),
    ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(m => m[1])

  for (const spec of specs) {
    let base: string
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(file), spec)
    else continue // package import

    let resolved: string | null = null
    for (const ext of EXTS) {
      const candidate = base + ext
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { resolved = path.resolve(candidate); break }
    }
    if (!resolved) {
      problems.push(`UNRESOLVED  ${path.relative(ROOT, file)}  ->  ${spec}`)
      continue
    }
    checked++
    const real = actualCase(resolved)
    if (real && real !== resolved) {
      problems.push(
        `CASE        ${path.relative(ROOT, file)}  ->  ${spec}\n` +
        `            written as ${path.relative(ROOT, resolved)}\n` +
        `            on disk    ${path.relative(ROOT, real)}`,
      )
    }
  }
}

console.log(`checked ${checked} local import(s) across ${walk(SRC).length} file(s)`)
if (!problems.length) {
  console.log('every local import matches the filename on disk, case included')
  process.exit(0)
}
for (const p of problems) console.log(p)
process.exit(1)
