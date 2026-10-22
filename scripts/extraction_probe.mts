/**
 * Runs the real extraction pipeline over a directory of files and reports
 * what came out, so a format that extracts badly is visible before a
 * customer uploads it.
 *
 * This exercises the same functions the upload and training routes call —
 * extractStructuredText and chunkPages — rather than a reimplementation of
 * them, because the defects worth finding live in those functions and in
 * the libraries behind them.
 *
 * Usage:
 *   npx tsx scripts/extraction_probe.mts <corpus-dir> [--json out.json]
 *
 * The corpus directory holds the files themselves and, optionally, a
 * manifest describing what each one should produce:
 *
 *   corpus/manifest.json
 *   [
 *     { "file": "nist-sp800-63b.pdf", "minChars": 50000, "minPages": 40,
 *       "mustContain": ["memorized secret"], "notes": "text PDF, long" }
 *   ]
 *
 * A file with no manifest entry is still probed and reported; it just has
 * nothing to pass or fail against. Downloaded files are untrusted input, so
 * they stay in their own directory and are read by path — nothing in the
 * corpus is executed or imported.
 */

import fs from 'node:fs'
import path from 'node:path'
import { extractStructuredText, chunkPages } from '../src/lib/documentProcess'

interface Expectation {
  file: string
  minChars?: number
  minPages?: number
  minChunks?: number
  mustContain?: string[]
  notes?: string
}

interface Probe {
  file: string
  ext: string
  bytes: number
  ok: boolean
  error?: string
  ms: number
  pages: number
  pagesWithText: number
  chars: number
  tables: number
  chunks: number
  chunksWithPage: number
  chunksWithSection: number
  tableChunks: number
  replacementChars: number
  failures: string[]
  notes?: string
}

const corpusDir = process.argv[2]
if (!corpusDir) {
  console.error('usage: tsx scripts/extraction_probe.mts <corpus-dir> [--json out.json]')
  process.exit(1)
}
const jsonFlag = process.argv.indexOf('--json')
const jsonOut = jsonFlag > 0 ? process.argv[jsonFlag + 1] : null

// The corpus itself is not in the repository — the files are large and
// belong to their publishers. scripts/extraction_corpus.json records where
// each one came from and what it should produce, so the corpus can be
// rebuilt: --fetch downloads anything missing.
const specPath = path.join(import.meta.dirname, 'extraction_corpus.json')
if (process.argv.includes('--fetch') && fs.existsSync(specPath)) {
  fs.mkdirSync(corpusDir, { recursive: true })
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as (Expectation & { url?: string })[]
  for (const entry of spec) {
    const target = path.join(corpusDir, entry.file)
    if (!entry.url || fs.existsSync(target)) continue
    process.stdout.write(`fetching ${entry.file} … `)
    const res = await fetch(entry.url)
    if (!res.ok) { console.log(`HTTP ${res.status} — skipped`); continue }
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()))
    console.log(`${(fs.statSync(target).size / 1024).toFixed(0)}KB`)
  }
}

const manifestPath = fs.existsSync(path.join(corpusDir, 'manifest.json'))
  ? path.join(corpusDir, 'manifest.json')
  : specPath
const expectations = new Map<string, Expectation>()
if (fs.existsSync(manifestPath)) {
  for (const e of JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Expectation[]) {
    expectations.set(e.file, e)
  }
}

const only = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length)

const files = fs.readdirSync(corpusDir)
  .filter(f => f !== 'manifest.json' && fs.statSync(path.join(corpusDir, f)).isFile())
  .filter(f => !only || f.includes(only))
  .sort()

const probes: Probe[] = []

for (const file of files) {
  const full = path.join(corpusDir, file)
  const buffer = fs.readFileSync(full)
  const expect = expectations.get(file)
  const probe: Probe = {
    file, ext: path.extname(file).toLowerCase(), bytes: buffer.length,
    ok: false, ms: 0, pages: 0, pagesWithText: 0, chars: 0, tables: 0,
    chunks: 0, chunksWithPage: 0, chunksWithSection: 0, tableChunks: 0,
    replacementChars: 0, failures: [], notes: expect?.notes,
  }

  const started = Date.now()
  try {
    const pages = await extractStructuredText(buffer, file)
    probe.pages = pages.length
    probe.pagesWithText = pages.filter(p => ((p.text ?? '') + ((p.tables ?? []).flat(2).join(''))).trim().length > 0).length
    // Table text counts: a spreadsheet's content travels as tables, not as
    // page text, so summing only page.text reported a correctly-extracted
    // 44,930-row workbook as having extracted nothing.
    const tableText = (pg: typeof pages[number]) =>
      (pg.tables ?? []).map(t => t.map(r => r.join(' | ')).join('\n')).join('\n')
    probe.chars = pages.reduce((n, p) => n + (p.text ?? '').length + tableText(p).length, 0)
    probe.tables = pages.reduce((n, p) => n + (p.tables?.length ?? 0), 0)
    probe.replacementChars = pages.reduce((n, p) => n + ((p.text ?? '').match(/�/g)?.length ?? 0), 0)

    const chunks = chunkPages(pages, file)
    probe.chunks = chunks.length
    probe.chunksWithPage = chunks.filter(c => c.page_number != null).length
    probe.chunksWithSection = chunks.filter(c => !!c.section_title).length
    probe.tableChunks = chunks.filter(c => c.is_table).length
    probe.ok = true

    const allText = pages.map(p => (p.text ?? '') + '\n' + tableText(p)).join('\n').toLowerCase()
    if (expect?.minChars != null && probe.chars < expect.minChars) {
      probe.failures.push(`chars ${probe.chars} < expected ${expect.minChars}`)
    }
    if (expect?.minPages != null && probe.pages < expect.minPages) {
      probe.failures.push(`pages ${probe.pages} < expected ${expect.minPages}`)
    }
    if (expect?.minChunks != null && probe.chunks < expect.minChunks) {
      probe.failures.push(`chunks ${probe.chunks} < expected ${expect.minChunks}`)
    }
    for (const needle of expect?.mustContain ?? []) {
      if (!allText.includes(needle.toLowerCase())) probe.failures.push(`missing text: "${needle}"`)
    }
    if (probe.chars === 0) probe.failures.push('extracted nothing')
    if (probe.replacementChars > 3 && probe.replacementChars > probe.chars * 0.01) {
      probe.failures.push(`${probe.replacementChars} replacement characters — wrong text encoding`)
    }
  } catch (e) {
    probe.error = (e as Error).message
    probe.failures.push(`threw: ${probe.error}`)
  }
  probe.ms = Date.now() - started
  probes.push(probe)

  const verdict = probe.failures.length ? 'FAIL' : 'pass'
  console.log(
    `${verdict.padEnd(5)} ${file.padEnd(38)} ${(probe.bytes / 1024).toFixed(0).padStart(6)}KB ` +
    `${String(probe.pages).padStart(4)}p(${probe.pagesWithText} w/text) ` +
    `${String(probe.chars).padStart(8)}ch ${String(probe.chunks).padStart(4)}ck ` +
    `page=${probe.chunksWithPage}/${probe.chunks} sect=${probe.chunksWithSection} ` +
    `tbl=${probe.tables}/${probe.tableChunks} ${(probe.ms / 1000).toFixed(1)}s`,
  )
  for (const f of probe.failures) console.log(`      ↳ ${f}`)
}

const failed = probes.filter(p => p.failures.length)
console.log(`\n${probes.length - failed.length}/${probes.length} passed`)
if (failed.length) console.log('failing: ' + failed.map(p => p.file).join(', '))

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(probes, null, 2))
  console.log(`wrote ${jsonOut}`)
}
process.exit(failed.length ? 1 : 0)
