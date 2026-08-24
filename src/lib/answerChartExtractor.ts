/**
 * Deterministic "chart when it's actually useful" extraction. Parses the
 * markdown comparison table the model's own answer already produced (per
 * coreSystemPrompt's rule to present multi-item comparisons as a table) and,
 * only when the shape genuinely supports it, turns it into bar-chart data.
 *
 * Deliberately NOT model-declared: this reuses numbers the answer has
 * already stated and cited, so there's no new hallucination surface and no
 * extra model call. "Only when needed" falls out of the shape requirements
 * below rather than a separate decision — a table with no clean numeric
 * column, or too few comparable rows, simply doesn't produce a chart.
 */

export interface BarChartDatum {
  label: string
  value: number
}

export interface BarChartData {
  title: string
  unit: string | null
  data: BarChartDatum[]
}

const MIN_ROWS = 3
const MAX_ROWS = 12

// A cell counts as "cleanly numeric" only if the ENTIRE cell (after
// stripping citation markers and markdown bold) is a single number, optional
// leading "~"/"≈" approximation marker, optional currency prefix, optional
// unit-word suffix — e.g. "11.00%", "$5,000", "18 townhouses", "-1.6%",
// "~60%" (a model-stated approximation is still one clean figure, not a
// range). A real range ("8-11%"), a list, or free text ("Not in excerpts",
// "Yes") won't match, which is exactly the point: those aren't safe to plot
// as one bar.
const CELL_RX = /^(?:~|≈)?\s?([-+]?)(GH¢|GHS|US\$|\$|₵)?\s?([\d,]+(?:\.\d+)?)\s?([a-zA-Z%]*)$/

function parseNumericCell(raw: string): { value: number; unit: string } | null {
  const cleaned = raw
    .replace(/(\[\d+\])+\s*$/, '')
    .replace(/\*\*/g, '')
    .trim()
  if (!cleaned) return null
  const m = cleaned.match(CELL_RX)
  if (!m) return null
  const value = parseFloat(`${m[1]}${m[3].replace(/,/g, '')}`)
  if (Number.isNaN(value)) return null
  // Prefer the trailing unit word ("%", "townhouses") when present; fall
  // back to the currency symbol so a $-figure comparison still gets a
  // meaningful axis label instead of a bare number.
  return { value, unit: m[4] || m[2] || '' }
}

interface ParsedTable {
  headers: string[]
  rows: string[][]
}

// Finds markdown tables: a header row, a "| --- | --- |"-style separator
// row, then one or more data rows, all starting with "|".
function findMarkdownTables(text: string): ParsedTable[] {
  const lines = text.split('\n')
  const tables: ParsedTable[] = []
  const splitRow = (line: string) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    const next = lines[i + 1].trim()
    if (!line.startsWith('|') || !next.startsWith('|')) continue
    if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(next)) continue

    const headers = splitRow(line)
    const rows: string[][] = []
    let j = i + 2
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      const cells = splitRow(lines[j])
      if (cells.length === headers.length) rows.push(cells)
      j++
    }
    if (rows.length) tables.push({ headers, rows })
    i = j - 1
  }
  return tables
}

// Extracts the first bar-chartable comparison table from an answer, or null
// if nothing in it cleanly qualifies. See module doc for the "only when
// needed" rationale.
export function extractBarChart(answerText: string): BarChartData | null {
  const tables = findMarkdownTables(answerText)

  for (const table of tables) {
    if (table.headers.length < 2) continue
    const labelColIdx = 0

    // Try each non-label column as the numeric series, first one that
    // qualifies wins — mirrors how these tables are usually shaped (label,
    // then the value being compared, then supporting columns).
    for (let col = 1; col < table.headers.length; col++) {
      const parsedRows: BarChartDatum[] = []
      let unit: string | null = null
      let unitConsistent = true

      for (const row of table.rows) {
        const label = row[labelColIdx]
        const cell = row[col]
        if (!label) continue
        const parsed = parseNumericCell(cell)
        if (!parsed) continue
        if (unit == null) unit = parsed.unit
        else if (parsed.unit && parsed.unit !== unit) unitConsistent = false
        parsedRows.push({ label, value: parsed.value })
      }

      if (!unitConsistent) continue
      if (parsedRows.length < MIN_ROWS) continue

      return {
        title: table.headers[col],
        unit: unit || null,
        data: parsedRows.slice(0, MAX_ROWS),
      }
    }
  }
  return null
}
