/**
 * Phase 2 table-aware extraction, ported from python/extract_tables.py so it
 * can run automatically inside the /train route for every uploaded document
 * (no Python, no manual step).
 *
 * Unlike pdfplumber, pdfjs-dist (used here via the same polyfilled build as
 * pdf-parse, see src/instrumentation.ts) doesn't detect table grids for us —
 * so this module reconstructs them from raw glyph positions: group text
 * items into lines by y-coordinate, split each line into cells wherever the
 * horizontal gap between glyphs is wide enough to be a column break, then
 * cluster cell x-positions across a run of multi-cell lines into shared
 * column boundaries (pdfplumber's "text" table strategy, reimplemented).
 * Header rows spread across multiple lines are merged exactly as in
 * extract_tables.py's merge_header().
 */

import path from 'node:path'
import type { TableFactRecord } from './factExtraction'

// pdfjs-dist's NodeStandardFontDataFactory reads font metric files straight
// off disk via fs.readFile(`${baseUrl}${filename}`) — pointing it at the
// package's bundled standard_fonts/ avoids "TT: undefined function: NN" /
// "Ensure that the `standardFontDataUrl` API parameter is provided" warnings
// (and the silent glyph-mapping fallbacks they cause) for PDFs whose
// embedded font subsets lack ToUnicode data for some glyphs.
// Built from process.cwd() rather than require.resolve()/import.meta.url —
// Turbopack's route bundling rewrites those to internal module ids, which
// breaks path.join with "path argument must be of type string" at build
// time. node_modules is always alongside the project root at runtime.
// pdfjs-dist's factory-url validation requires a trailing "/" specifically
// (not path.sep) even on Windows, since it's treated as a URL-style path.
const STANDARD_FONT_DATA_URL =
  path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/'

// ── Classification rules (ported from python/extract_tables.py) ─────────

const NATIONAL_ROW_METRICS: { rx: RegExp; metric: string }[] = [
  // "Govt"/"Gov't" is the common abbreviation for "Government" in older
  // (pre-2007) MTEF appendix tables, e.g. "Total Govt Expenditure".
  { rx: /total\s+(gov(?:ernmen)?t'?\.?\s+)?expenditure/i, metric: 'total_budget' },
  { rx: /total\s+revenue(\s+and\s+grants)?/i, metric: 'revenue' },
  { rx: /domestic\s+revenue/i, metric: 'revenue' },
  { rx: /total\s+public\s+debt|public\s+debt\s+stock/i, metric: 'debt' },
  { rx: /capital\s+expenditure/i, metric: 'capital_expenditure' },
  { rx: /recurrent\s+expenditure/i, metric: 'recurrent_expenditure' },
]

// "Total Expenditure and Arrears Clearance" / "Total Expenditure (including
// arrears clearance and tax refunds)" is the headline national total — when
// a table has a row like this, a separate plain "Total Expenditure" row
// (which excludes arrears) is a smaller, different figure for the same year,
// not an alternative reading of the same total.
const ARREARS_TOTAL_RX = /total\s+(?:government\s+)?expenditure\s*(?:\(including\s+arrears|and\s+arrears\s+clearance)/i

const MINISTRY_COL_RX = /ministry|mda|vote|agency/i
const ALLOCATION_COL_RX = /gog|igf|abfa|donor|total/i
// Deviation/variance/growth columns are differences or rates, not absolute
// monetary totals, even when their unit looks like "million". "Excluding oil"
// columns report an alternate total on a different basis than the headline
// total for the same year — including them alongside the headline figure
// produces two conflicting values for one year. A "YYYY (Jan-Sept)"-style
// header is a partial-year actual, much smaller than that year's full-year
// total — its year (extracted by detectYear) would otherwise collide with
// the genuine full-year figure for the same fiscal year.
const SKIP_COL_RX =
  /dev[’']?t[’']?n|deviation|variance|growth\s+rate|%\s*change|excluding\s+oil|\((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]/i

const YEAR_RX = /\b(19|20)\d{2}\b/

const UNIT_RX: { rx: RegExp; unit: string }[] = [
  { rx: /gh.?\s*c?\s*'?\s*000|thousand/i, unit: 'thousand' },
  { rx: /gh.?\s*c?\s*million|million/i, unit: 'million' },
  { rx: /%|percent/i, unit: '%' },
  { rx: /gh.?\s*c?\s*billion|billion/i, unit: 'billion' },
]

function detectUnit(...texts: (string | null | undefined)[]): string {
  for (const text of texts) {
    if (!text) continue
    for (const { rx, unit } of UNIT_RX) {
      if (rx.test(text)) return unit
    }
  }
  return 'million'
}

function detectYear(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue
    const m = text.match(YEAR_RX)
    if (m) return m[0]
  }
  return null
}

// Government PDFs often abbreviate "Ministry of X" inconsistently ("Min. of
// X", "M.O.X", trailing punctuation/whitespace from OCR'd table cells) —
// normalizing to a single canonical form keeps query-side `ilike` matches
// (extractQueryFilters) and cross-document grouping (runSanityChecks)
// working against one consistent entity name per ministry.
function normalizeMinistryName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    // MDA annex tables prefix each row with its vote/item number (e.g. "7
    // Ministry of Transport", "20 District Assemblies Common Fund") — strip
    // it so the entity name matches the same ministry across tables/years.
    .replace(/^\d+\s+/, '')
    .replace(/^min(?:istry)?\.?\s+of\s+/i, 'Ministry of ')
    .replace(/[.,;:]+$/, '')
    .trim()
}

function parseNumber(cell: string | null | undefined): number | null {
  if (!cell) return null
  const cleaned = cell.trim().replace(/,/g, '').replace(/\s+/g, '').replace(/\(/g, '-').replace(/\)/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

// A row is a data row if its first cell is a non-empty, non-numeric label
// and at least one other cell parses as a plain number — header rows
// (column titles, units, "Amt./% of GDP" sub-labels, or a bare "2017 2018
// 2019" year row) never satisfy both.
function isDataRow(row: (string | null)[]): boolean {
  if (!row.length || !(row[0] ?? '').trim()) return false
  if (parseNumber(row[0]) != null) return false
  return row.slice(1).some(c => parseNumber(c) != null)
}

// Government budget tables often spread the column header across 2-4 rows
// (e.g. "2016 Revised" / "Budget" / "Amt." / "% of GDP" stacked in separate
// cells of separate rows for the same column). Concatenating all leading
// non-data rows per column recovers headers like "2016 Revised Budget Amt."
// so detectYear()/detectUnit()/SKIP_COL_RX can see the full label.
function mergeHeader(table: (string | null)[][]): { header: string[]; dataStart: number } {
  let dataStart = 1
  for (let i = 0; i < table.length; i++) {
    if (isDataRow(table[i])) {
      dataStart = Math.max(i, 1)
      break
    }
  }

  const headerRows = table.slice(0, dataStart)
  const nCols = headerRows.reduce((m, r) => Math.max(m, r.length), 0)
  const header: string[] = []
  for (let col = 0; col < nCols; col++) {
    const parts: string[] = []
    for (const row of headerRows) {
      if (col < row.length && row[col]) parts.push((row[col] as string).trim())
    }
    header.push(parts.join(' '))
  }
  return { header, dataStart }
}

function classifyNationalRow(row: (string | null)[]): string | null {
  const label = (row[0] ?? '').trim()
  for (const { rx, metric } of NATIONAL_ROW_METRICS) {
    if (rx.test(label)) return metric
  }
  return null
}

interface RawTableRecord {
  page_number: number | null
  entity: string
  entity_type: 'national' | 'ministry' | 'sector'
  metric: string
  fiscal_year: string | null
  value: number
  unit: string
  table_caption: string | null
}

function extractNationalTable(
  table: (string | null)[][],
  dataStart: number,
  header: string[],
  fallbackYear: string | null,
  pageNumber: number,
  caption: string | null,
): RawTableRecord[] {
  // A table that also has a ministry/MDA breakdown column is a ministry
  // allocation table, even if one of its rows happens to have a label that
  // matches a national-aggregate pattern (e.g. a "Total" row summing the
  // ministry allocations) — extractMinistryTable() handles this table
  // instead, and treating its "Total" row as the national total double
  // counts/conflates the two.
  if (header.some(h => MINISTRY_COL_RX.test(h))) return []

  const records: RawTableRecord[] = []
  const dataRows = table.slice(dataStart)

  const effectiveLabel = (row: (string | null)[], i: number): string =>
    i === 0 && header[0] ? `${header[0]} ${row[0] ?? ''}` : (row[0] ?? '')

  const hasArrearsHeadline = dataRows.some((row, i) => ARREARS_TOTAL_RX.test(effectiveLabel(row, i)))

  for (let i = 0; i < dataRows.length; i++) {
    let row = dataRows[i]
    let metric = classifyNationalRow(row)

    // A separate plain "Total Expenditure" row (excluding arrears) is a
    // smaller, different figure for the same year as the headline
    // "...Arrears Clearance" row above — classifying both as total_budget
    // would produce two conflicting values for the same year.
    if (metric === 'total_budget' && hasArrearsHeadline && !ARREARS_TOTAL_RX.test(effectiveLabel(row, i))) {
      metric = null
    }

    // A multi-line row label (e.g. "Total Expenditure (including arrears" /
    // "clearance and tax refunds)") gets split across rows by mergeHeader():
    // the first half ends up concatenated into header[0] (a "header" row,
    // since it precedes the table's first data row) and only the trailing
    // fragment remains in row[0] of the first data row — so
    // classifyNationalRow() never matches row[0] alone. Retrying with
    // header[0] prefixed recovers the full label. header[0] is shared by
    // every row, so only retry for the first data row (the one whose label
    // was actually split), and only trust column 1 (the row's first numeric
    // column, immediately after the label) for the value — other columns'
    // headers may themselves be misaligned fragments of this same wrapped
    // header and can't be reliably classified.
    // Restricted to tables whose first value column is headed simply
    // "Amount (...)" — the single-figure layout used by the "Summary of
    // Expenditure Estimates" tables (e.g. 2010, 2011). Multi-column
    // estimate-vs-outturn comparison tables (e.g. "2013 Budget Estimate"/
    // "Target for Jan-Sept"/"Provisional Outturn"/"Projected Outturn") use
    // the same wrapped-label layout but report a *different* (estimate, not
    // final) figure for a year whose final figure is already extracted from
    // that year's own "Amount" table elsewhere — recovering their row would
    // inject a second, conflicting total_budget value for that year.
    let valueColsOnly: number | null = null
    if (!metric && i === 0 && header[0] && /^amount\b/i.test(header[1] ?? '')) {
      metric = classifyNationalRow([`${header[0]} ${row[0] ?? ''}`, ...row.slice(1)])
      if (metric) valueColsOnly = 1
    }
    if (!metric) continue

    // A wide caption-derived row label (e.g. "Total Expenditure and Arrears
    // Clearance") can absorb its own first value column when blockToTable()
    // assigns column boundaries based on a narrower row below it — leaving
    // row[0] as "<label> <value>" and row[1] empty. Split the trailing
    // number back out into row[1] so it's picked up by the normal column
    // loop below (using header[1] for its unit/year, as for any other row).
    if (i === 0 && (row[1] == null || row[1] === '')) {
      const m = /^(.*\D)\s+([\d,]+\.\d+)$/.exec(row[0] ?? '')
      if (m) {
        row = [m[1], m[2], ...row.slice(2)]
      }
    }

    // A single row occasionally yields two columns that resolve to the same
    // year (e.g. a header column whose own label was lost to a neighbouring
    // column during clustering, leaving it with no detectable unit/year of
    // its own and falling back to this row's year) — keep only the first
    // (leftmost) value for each year from a given row.
    const seenYears = new Set<string | null>()

    for (let colIdx = 1; colIdx < row.length; colIdx++) {
      if (valueColsOnly != null && colIdx > valueColsOnly) break
      const colHeader = header[colIdx] ?? ''
      if (SKIP_COL_RX.test(colHeader)) continue
      // A header cell that is itself just numbers (e.g. "21,504.6" or
      // "23.0 36,358.3 31.7") is a misplaced data row that findTableBlocks
      // mistook for a header — it carries no usable unit/year information,
      // and the value below it can't be reliably attributed to any year.
      if (colHeader.trim() && /^[\d,.%\s-]+$/.test(colHeader.trim())) continue

      const value = parseNumber(row[colIdx])
      if (value == null) continue

      // header[0] often retains the table's caption text (e.g. "Table 23:
      // Summary of Expenditure Estimates for 2014" or "Table A5: ... (in
      // billions of cedis)") when mergeHeader() folds a wrapped caption line
      // into the first header cell — fall back to it for unit detection too,
      // since the column headers themselves (e.g. "1999 Budget") often carry
      // no unit of their own.
      const unit = detectUnit(colHeader, caption, header[0])
      if (unit === '%') continue

      // header[0] often retains the table's caption text (e.g. "Table 23:
      // Summary of Expenditure Estimates for 2014") when mergeHeader() folds a
      // wrapped caption line into the first header cell — fall back to any
      // year mentioned there before the page-level fallbackYear, which may
      // reflect a different year discussed elsewhere on the page.
      const year = detectYear(colHeader) ?? detectYear(caption) ?? detectYear(header[0]) ?? fallbackYear
      if (seenYears.has(year)) continue
      seenYears.add(year)

      // Pre-2007 tables captioned "(in billions of cedis)" report figures in
      // OLD cedis, not the redenominated GH¢ used from 2007 onward. Ghana's
      // 2007 redenomination was 10,000:1, so X billion old cedis = X/10
      // million GH¢ — convert here (to 'million') so the figure lines up with
      // every other national total_budget value, which are all GH¢ million.
      const captionText = `${caption ?? ''} ${header[0] ?? ''}`
      const isOldCedi = /\bcedis?\b/i.test(captionText) && !/gh\s*[¢c]|ghana\s*cedi/i.test(captionText)
      const isPreRedenomination = year != null && Number(year) < 2007
      if (isOldCedi && isPreRedenomination && unit === 'billion') {
        records.push({
          page_number: pageNumber,
          entity: 'National',
          entity_type: 'national',
          metric,
          fiscal_year: year,
          value: value / 10,
          unit: 'million',
          table_caption: caption,
        })
        continue
      }

      records.push({
        page_number: pageNumber,
        entity: 'National',
        entity_type: 'national',
        metric,
        fiscal_year: year,
        value,
        unit,
        table_caption: caption,
      })
    }
  }
  return records
}

function extractMinistryTable(
  table: (string | null)[][],
  dataStart: number,
  header: string[],
  fallbackYear: string | null,
  pageNumber: number,
  caption: string | null,
): RawTableRecord[] {
  const entityCol = header.findIndex(h => MINISTRY_COL_RX.test(h))
  if (entityCol === -1) return []

  const allocCols = header
    .map((h, i) => i)
    .filter(i => i !== entityCol && ALLOCATION_COL_RX.test(header[i]) && !SKIP_COL_RX.test(header[i]))
  if (!allocCols.length) return []

  const records: RawTableRecord[] = []
  for (const row of table.slice(dataStart)) {
    if (entityCol >= row.length) continue
    const entity = normalizeMinistryName(row[entityCol] ?? '')
    if (!entity) continue

    for (const colIdx of allocCols) {
      const value = parseNumber(row[colIdx])
      if (value == null) continue

      const colHeader = header[colIdx] ?? ''
      const unit = detectUnit(colHeader, caption)
      if (unit === '%') continue

      const year = detectYear(colHeader) ?? detectYear(caption) ?? fallbackYear

      records.push({
        page_number: pageNumber,
        entity,
        entity_type: 'ministry',
        metric: 'allocation',
        fiscal_year: year,
        value,
        unit,
        table_caption: caption,
      })
    }
  }
  return records
}

// Searches outward from a table block (a couple of lines above first, then
// below — captions are far more often printed directly above a table) for a
// "Table N: ..." line, instead of returning the first such line anywhere on
// the page. A page with multiple tables would otherwise have every block
// mislabelled with the first table's caption.
function nearbyCaption(lineCells: Cell[][], startIdx: number, endIdx: number): string | null {
  for (let d = 1; d <= 5; d++) {
    const above = startIdx - d
    if (above >= 0) {
      const text = lineToText(lineCells[above])
      if (/table\s+\d/i.test(text)) return text.trim()
    }
  }
  for (let d = 1; d <= 2; d++) {
    const below = endIdx + d
    if (below < lineCells.length) {
      const text = lineToText(lineCells[below])
      if (/table\s+\d/i.test(text)) return text.trim()
    }
  }
  return null
}

// Searches outward from a table block for the nearest line containing a
// year, alternating above/below by increasing distance — used as the last
// resort when neither a column header nor the table's own caption mentions a
// year. Far more reliable than detectYear(pageText), which always returns
// the first year on the whole page regardless of how far it is from this
// table.
function nearbyYear(lineCells: Cell[][], startIdx: number, endIdx: number): string | null {
  const maxD = Math.max(startIdx, lineCells.length - endIdx)
  for (let d = 1; d <= maxD; d++) {
    const above = startIdx - d
    if (above >= 0) {
      const year = detectYear(lineToText(lineCells[above]))
      if (year) return year
    }
    const below = endIdx + d
    if (below < lineCells.length) {
      const year = detectYear(lineToText(lineCells[below]))
      if (year) return year
    }
  }
  return null
}

// ── Geometry: reconstruct rows/cells/columns from glyph positions ────────

interface PositionedItem {
  str: string
  x: number
  y: number
  width: number
  height: number
}

interface Cell {
  text: string
  x: number
}

// pdfjs-dist text items, sorted into visual lines (top-to-bottom,
// left-to-right) by clustering on the y-coordinate.
function groupLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PositionedItem[][] = []
  for (const item of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last[0].y - item.y) < Math.max(2, item.height * 0.3)) {
      last.push(item)
    } else {
      lines.push([item])
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  return lines
}

// Splits a line into cells wherever the horizontal gap between consecutive
// glyphs is wide enough to be a column break (rather than ordinary
// word-spacing within a label).
function lineToCells(line: PositionedItem[]): Cell[] {
  const cells: Cell[] = []
  let curText = ''
  let curX = 0
  let prevEnd = -Infinity
  for (const item of line) {
    const fontSize = item.height || 10
    const gap = item.x - prevEnd
    if (prevEnd === -Infinity) {
      curText = item.str
      curX = item.x
    } else if (gap > fontSize * 1.6) {
      cells.push({ text: curText.trim(), x: curX })
      curText = item.str
      curX = item.x
    } else {
      curText += (gap > fontSize * 0.15 ? ' ' : '') + item.str
    }
    prevEnd = item.x + item.width
  }
  if (curText.trim()) cells.push({ text: curText.trim(), x: curX })
  return cells
}

function lineToText(cells: Cell[]): string {
  return cells.map(c => c.text).join(' ')
}

interface TableBlock {
  lines: Cell[][]
  // Index range (inclusive) into the page's lineCells array, used to scope
  // nearbyCaption()/nearbyYear() searches to lines actually adjacent to this
  // specific block rather than anywhere on the page.
  startIdx: number
  endIdx: number
}

// A maximal run of consecutive multi-cell lines that contains at least one
// data row, plus up to a few preceding lines that act as a (possibly
// multi-row) header.
function findTableBlocks(lineCells: Cell[][]): TableBlock[] {
  const blocks: TableBlock[] = []
  let i = 0
  while (i < lineCells.length) {
    if (lineCells[i].length >= 2) {
      let j = i
      while (j < lineCells.length && lineCells[j].length >= 2) j++

      const body = lineCells.slice(i, j)
      if (body.some(line => isDataRow(line.map(c => c.text)))) {
        let start = i
        while (
          start > 0 &&
          lineCells[start - 1].length >= 1 &&
          !isDataRow(lineCells[start - 1].map(c => c.text)) &&
          i - start < 4
        ) {
          start--
        }
        blocks.push({ lines: lineCells.slice(start, j), startIdx: start, endIdx: j - 1 })
      }
      i = j
    } else {
      i++
    }
  }
  return blocks
}

// Clusters distinct cell x-positions across a table block into shared column
// boundaries (pdfplumber's "text" strategy, reimplemented for flat text).
// Only data rows are used to derive the boundaries: header cells (e.g. a
// "2018" year label sitting slightly right of its "Indicative" sub-header,
// itself aligned with the data column below) are assigned afterwards by
// nearest-center, which is far more reliable than including their
// (inconsistently offset) x-positions in the clustering itself.
function clusterColumns(block: Cell[][], gapThreshold: number): number[] {
  const dataLines = block.filter(line => isDataRow(line.map(c => c.text)))
  const source = dataLines.length ? dataLines : block
  const xs = [...new Set(source.flatMap(line => line.map(c => c.x)))].sort((a, b) => a - b)
  if (!xs.length) return []
  const centers: number[] = []
  let clusterStart = xs[0]
  let prev = xs[0]
  for (let k = 1; k <= xs.length; k++) {
    if (k === xs.length || xs[k] - prev > gapThreshold) {
      centers.push((clusterStart + prev) / 2)
      if (k < xs.length) clusterStart = xs[k]
    }
    if (k < xs.length) prev = xs[k]
  }
  return centers
}

// The most frequent value in a list — used below to find the "expected"
// number of columns from the data rows' cell counts.
function mode(values: number[]): number {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

function blockToTable(block: Cell[][]): (string | null)[][] {
  const dataLines = block.filter(line => isDataRow(line.map(c => c.text)))
  const expectedCols = dataLines.length ? mode(dataLines.map(line => line.length)) : 0

  // The default 30pt gap threshold can merge two adjacent narrow columns
  // (e.g. "Amt." and "% of GDP") into one cluster. If the resulting column
  // count falls short of how many cells the data rows actually have, retry
  // with a tighter threshold that keeps those columns separate.
  let colCenters = clusterColumns(block, 30)
  if (expectedCols && colCenters.length < expectedCols) {
    const retry = clusterColumns(block, 20)
    if (retry.length > colCenters.length) colCenters = retry
  }

  return block.map(line => {
    const row: (string | null)[] = new Array(colCenters.length).fill(null)
    for (const cell of line) {
      let bestIdx = 0
      let bestDist = Infinity
      for (let c = 0; c < colCenters.length; c++) {
        const d = Math.abs(cell.x - colCenters[c])
        if (d < bestDist) {
          bestDist = d
          bestIdx = c
        }
      }
      row[bestIdx] = row[bestIdx] ? `${row[bestIdx]} ${cell.text}` : cell.text
    }
    return row
  })
}

// ── Public API ────────────────────────────────────────────────────────

// Extracts national-aggregate and ministry-allocation table records from a
// PDF buffer. Returns raw records (no document_id) — pass each through
// tableRecordToFact() with the document's tenant/document id.
export async function extractTableRecordsFromPdf(buffer: Buffer): Promise<Omit<TableFactRecord, 'document_id'>[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise

  const records: Omit<TableFactRecord, 'document_id'>[] = []

  // A multi-section document (e.g. "I. REVENUES" then "II. EXPENDITURE",
  // possibly continuing onto the next page) often has its "2017 Budget /
  // 2018 Indicative / 2019 Indicative" year header attached only to the
  // first section's table block — later blocks, including ones on
  // subsequent pages, share the same columns but have no year info of their
  // own. Carry the last header that had detectable years forward across
  // page boundaries to any same-width header that has none, rather than
  // falling back to a page-local guess (which would assign the wrong year to
  // every column of a continuation table).
  let lastHeaderWithYears: string[] | null = null

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = await page.getTextContent()
      const items: PositionedItem[] = (content.items as any[])
        .filter(it => it.str && it.str.trim())
        .map(it => ({
          str: it.str as string,
          x: it.transform[4] as number,
          y: it.transform[5] as number,
          width: it.width as number,
          height: (Math.abs(it.transform[3]) || it.height || 10) as number,
        }))

      if (!items.length) continue

      const lines = groupLines(items)
      const lineCells = lines.map(lineToCells)
      const pageText = lineCells.map(lineToText).join('\n')

      for (const block of findTableBlocks(lineCells)) {
        const caption = nearbyCaption(lineCells, block.startIdx, block.endIdx)
        const table = blockToTable(block.lines)
        let { header, dataStart } = mergeHeader(table)
        const hasYear = header.some(h => detectYear(h))
        if (!hasYear && lastHeaderWithYears && lastHeaderWithYears.length === header.length) {
          header = lastHeaderWithYears
        } else if (hasYear) {
          lastHeaderWithYears = header
        }
        const fallbackYear =
          nearbyYear(lineCells, block.startIdx, block.endIdx) ?? detectYear(pageText)
        records.push(...extractNationalTable(table, dataStart, header, fallbackYear, p, caption))
        records.push(...extractMinistryTable(table, dataStart, header, fallbackYear, p, caption))
      }
    }
  } finally {
    await doc.destroy()
  }

  return records
}
