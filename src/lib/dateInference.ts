/**
 * Reads the dates a document prints in a short form, using the document's
 * own evidence rather than a convention.
 *
 * The problem. A register's DATE OF FIRST AUTHORISATION column holds 437
 * values, of which **287 carry no four-digit year** — printed `19-08-20`,
 * `25 – 02 - 20`, `4-06-12`. Every year count therefore came from the 150
 * that were unambiguous, so a question about any particular year could only
 * ever be answered from a third of the column, and the answer had to say so.
 *
 * Why this is not guesswork. Two things are needed to read `19-08-20`:
 * which component is the day, and which century the year is in. Both are
 * taken from the document:
 *
 *  - **Order** comes from the values in the same printed shape that pin it
 *    themselves. A component above 12 cannot be a month. Measured on that
 *    register: of 251 values printed `NN-NN-NN`, 171 begin with a component
 *    above 12 and none has one in second position, so that shape is
 *    day-first on the document's own evidence. Where a shape has no such
 *    value, or has evidence both ways, the order is not established and the
 *    values are left unread — 18 of the 287, correctly.
 *  - **Century** is pivoted on the latest four-digit year the same column
 *    states. A register current as at Q2 2026 cannot record a first
 *    authorisation in 2095, so `95` is 1995 and `20` is 2020.
 *
 * Shapes are judged separately because they were printed by different
 * rules. The same column mixes `30/12/2022` (22 values pin day-first) with
 * `7/10/2024` (one pins month-first) — treating all slash dates as one rule
 * would make a renewal in October look like one in July.
 *
 * What it will not do. It never assigns an order by preference, and it
 * reports what it could not read as a number rather than quietly dropping
 * it. A date inferred this way is marked inferred, so an answer can say
 * which of its figures were printed and which were read.
 */

export interface DateReading {
  /** The original text, untouched. */
  raw: string
  year: number | null
  /** Whether the year was printed in full or inferred from the shape. */
  source: 'stated' | 'inferred' | 'unreadable'
}

export interface ColumnDates {
  readings: DateReading[]
  stated: number
  inferred: number
  unreadable: number
  /** Sample of the values that could not be read, for reporting. */
  unreadableSamples: string[]
  /** The latest four-digit year the column itself states. */
  pivotYear: number | null
}

interface Shape {
  key: string
  numbers: number[]
  partCount: number
}

function shapeOf(value: string): Shape {
  const parts = value.split(/[^0-9A-Za-z]+/).filter(Boolean)
  const separator = (value.match(/[^0-9A-Za-z]+/g) ?? [])
    .map(s => s.replace(/\s+/g, ''))
    .filter(Boolean)[0] ?? 'none'
  const key = `${separator}|${parts.map(p => (/^\d+$/.test(p) ? String(p.length) : 'A')).join('-')}`
  return {
    key,
    numbers: parts.filter(p => /^\d+$/.test(p)).map(Number),
    partCount: parts.length,
  }
}

const FOUR_DIGIT_YEAR = /\b(19|20)\d{2}\b/

/**
 * Reads every value of one date column together, because the evidence for
 * how to read any one of them comes from the others.
 */
export function readDateColumn(values: string[]): ColumnDates {
  const trimmed = values.map(v => v.trim()).filter(Boolean)

  // The column's own four-digit years bound the century pivot.
  const statedYears = trimmed
    .flatMap(v => [...v.matchAll(/\b(19|20)\d{2}\b/g)].map(m => Number(m[0])))
    .filter(y => y >= 1900 && y <= 2100)
  const pivotYear = statedYears.length ? Math.max(...statedYears) : null

  // Which position holds the day, per printed shape, from the values that
  // pin it themselves.
  const evidence = new Map<string, { dayFirst: number; monthFirst: number }>()
  for (const value of trimmed) {
    const { key, numbers } = shapeOf(value)
    if (numbers.length < 2) continue
    const seen = evidence.get(key) ?? { dayFirst: 0, monthFirst: 0 }
    if (numbers[0] > 12 && numbers[0] <= 31) seen.dayFirst++
    if (numbers[1] > 12 && numbers[1] <= 31) seen.monthFirst++
    evidence.set(key, seen)
  }

  const readings: DateReading[] = []
  const unreadableSamples: string[] = []

  for (const value of trimmed) {
    const stated = value.match(FOUR_DIGIT_YEAR)
    if (stated) {
      readings.push({ raw: value, year: Number(stated[0]), source: 'stated' })
      continue
    }

    const { key, numbers } = shapeOf(value)
    const seen = evidence.get(key) ?? { dayFirst: 0, monthFirst: 0 }
    // Established only when the shape's own values point one way and not
    // the other. Evidence both ways means the document is inconsistent in
    // that shape, which is not something to resolve by preference.
    const orderEstablished = (seen.dayFirst > 0) !== (seen.monthFirst > 0)

    if (!orderEstablished || numbers.length < 3 || pivotYear == null) {
      readings.push({ raw: value, year: null, source: 'unreadable' })
      if (unreadableSamples.length < 4) unreadableSamples.push(value)
      continue
    }

    const twoDigitYear = numbers[2]
    if (twoDigitYear > 99) {
      readings.push({ raw: value, year: null, source: 'unreadable' })
      if (unreadableSamples.length < 4) unreadableSamples.push(value)
      continue
    }
    const year = 2000 + twoDigitYear <= pivotYear ? 2000 + twoDigitYear : 1900 + twoDigitYear
    readings.push({ raw: value, year, source: 'inferred' })
  }

  return {
    readings,
    stated: readings.filter(r => r.source === 'stated').length,
    inferred: readings.filter(r => r.source === 'inferred').length,
    unreadable: readings.filter(r => r.source === 'unreadable').length,
    unreadableSamples,
    pivotYear,
  }
}

/** Year counts, kept separate by how the year was arrived at. */
export function yearHistogram(column: ColumnDates): {
  stated: Map<number, number>
  inferred: Map<number, number>
} {
  const stated = new Map<number, number>()
  const inferred = new Map<number, number>()
  for (const reading of column.readings) {
    if (reading.year == null) continue
    const target = reading.source === 'stated' ? stated : inferred
    target.set(reading.year, (target.get(reading.year) ?? 0) + 1)
  }
  return { stated, inferred }
}
