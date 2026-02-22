export type ChangeKind = 'regressed' | 'improved' | 'unchanged' | 'incomparable' | 'failed'

export interface BenchmarkRow {
  change: ChangeKind
  mark: string
  before: string
  after: string
  ratio: string
  ratioNum: number
  benchmark: string
}

export interface ParsedComparison {
  rows: BenchmarkRow[]
  regressed: BenchmarkRow[]
  improved: BenchmarkRow[]
  unchanged: BenchmarkRow[]
  incomparable: BenchmarkRow[]
  failed: BenchmarkRow[]
}

export interface CompareManyContenderCell {
  value: string
  mark: string
  change: ChangeKind
  ratio: string
  ratioNum: number
}

export interface CompareManyRow {
  benchmark: string
  baseline: string
  contenders: CompareManyContenderCell[]
}

export interface ParsedCompareMany {
  contenderLabels: string[]
  rows: CompareManyRow[]
  summaryPerContender: Array<{
    label: string
    regressed: number
    improved: number
    unchanged: number
    incomparable: number
    failed: number
  }>
}

function classifyMark(mark: string): ChangeKind {
  switch (mark.trim()) {
    case '+': return 'regressed'
    case '-': return 'improved'
    case 'x': return 'incomparable'
    case '!': return 'failed'
    default: return 'unchanged'
  }
}

function parseRatio(ratioStr: string): number {
  const cleaned = ratioStr.trim()
  if (cleaned === 'n/a') {
    return Number.NaN
  }
  // Strip leading ~ for insignificant results
  const numeric = cleaned.replace(/^~/, '')
  const val = Number.parseFloat(numeric)
  return Number.isNaN(val) ? Number.NaN : val
}

export function shortenBenchmark(name: string): string {
  // Strip "benchmarks." prefix
  let short = name.replace(/^benchmarks\./, '')
  // Strip env label suffix like " [env1 -> env2]"
  short = short.replace(/\s*\[.*->.*\]\s*$/, '')
  return short.trim()
}

// TODO: upstream fix in asv_runner/discovery.py -- disc_benchmarks yields
// duplicates when the benchmark directory has __init__.py (package discovery
// and direct module discovery both fire). Until fixed, deduplicate here.
function deduplicateRows<T extends { benchmark: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>()
  for (const row of rows) {
    const key = shortenBenchmark(row.benchmark)
    if (!seen.has(key) || row.benchmark.length < seen.get(key)!.benchmark.length) {
      seen.set(key, { ...row, benchmark: key })
    }
  }
  return [...seen.values()]
}

export function parseComparison(raw: string): ParsedComparison {
  const lines = raw.split('\n')
  const rows: BenchmarkRow[] = []

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) {
      continue
    }

    // Must contain pipes to be a table row
    if (!line.includes('|')) {
      continue
    }

    // Split by pipe, trim each cell
    const cells = line.split('|').map((c) => c.trim())

    // A valid data row after splitting by | has at least 7 elements
    // (empty before first |, 5 data columns, empty after last |)
    // Minimum: | mark | before | after | ratio | benchmark |
    if (cells.length < 7) {
      continue
    }

    // Skip header row (contains "Change" or "Before")
    const secondCell = cells[1]
    if (secondCell === 'Change' || secondCell === 'Before') {
      continue
    }

    // Skip separator row (contains 2+ dashes only, not a single `-` mark)
    if (/^-{2,}$/.test(secondCell)) {
      continue
    }

    const mark = cells[1]
    const before = cells[2].trim()
    const after = cells[3].trim()
    const ratioStr = cells[4].trim()
    const benchmark = cells[5].trim()

    // Skip if no benchmark name (malformed)
    if (!benchmark) {
      continue
    }

    const change = classifyMark(mark)
    const ratioNum = parseRatio(ratioStr)

    rows.push({
      change,
      mark: mark.trim(),
      before,
      after,
      ratio: ratioStr,
      ratioNum,
      benchmark,
    })
  }

  // TODO: asv_runner discovery.py yields benchmarks twice when benchmarks/
  // has __init__.py (once as module.Class.method, once as pkg.module.Class.method).
  // Deduplicate by normalized name, keeping the shorter original.
  const deduped = deduplicateRows(rows)

  return {
    rows: deduped,
    regressed: deduped.filter((r) => r.change === 'regressed'),
    improved: deduped.filter((r) => r.change === 'improved'),
    unchanged: deduped.filter((r) => r.change === 'unchanged'),
    incomparable: deduped.filter((r) => r.change === 'incomparable'),
    failed: deduped.filter((r) => r.change === 'failed'),
  }
}

function parseContenderCell(cell: string): CompareManyContenderCell {
  // Format: "value (mark ratio)" e.g. "187+/-3ns (+ 1.12)" or "1.07+/-0us (  ~0.91)"
  // Also handles: "n/a (x n/a)"
  // Find last opening paren to split value from (mark ratio) suffix
  const lastParen = cell.lastIndexOf('(')
  const closeParen = cell.lastIndexOf(')')
  if (lastParen <= 0 || closeParen <= lastParen) {
    // No parenthesized ratio -- treat as unchanged baseline-like cell
    return {
      value: cell.trim(),
      mark: '',
      change: 'unchanged',
      ratio: 'n/a',
      ratioNum: Number.NaN,
    }
  }

  const value = cell.slice(0, lastParen).trim()
  const parenContent = cell.slice(lastParen + 1, closeParen).trim()
  const tokens = parenContent.split(/\s+/)

  // Two tokens: "mark ratio" e.g. "+ 1.12" or "x n/a"
  // One token: just ratio e.g. "~0.91" (mark is empty = unchanged)
  let mark: string
  let ratioStr: string
  if (tokens.length >= 2) {
    mark = tokens[0]
    ratioStr = tokens[1]
  } else {
    mark = ''
    ratioStr = tokens[0] || 'n/a'
  }

  return {
    value,
    mark,
    change: classifyMark(mark),
    ratio: ratioStr,
    ratioNum: parseRatio(ratioStr),
  }
}

function parseCompareManyHeader(cells: string[]): { baselineLabel: string, contenderLabels: string[] } | null {
  // Header format: | Benchmark (Parameter) | baseline (label) | contender1 (Ratio) | contender2 (Ratio) | ...
  // First data cell (cells[1]) should contain "Benchmark"
  if (!cells[1] || !cells[1].includes('Benchmark')) {
    return null
  }

  // cells[2] is the baseline column header, e.g. "baseline (py311)"
  const baselineLabel = cells[2]?.trim() || 'baseline'

  // Remaining columns are contender labels
  const contenderLabels: string[] = []
  for (let i = 3; i < cells.length; i++) {
    const label = cells[i]?.trim()
    if (label) {
      contenderLabels.push(label)
    }
  }

  return { baselineLabel, contenderLabels }
}

export function parseCompareMany(raw: string): ParsedCompareMany {
  const lines = raw.split('\n')
  const rows: CompareManyRow[] = []
  let contenderLabels: string[] = []
  let headerParsed = false

  for (const line of lines) {
    if (!line.trim() || !line.includes('|')) {
      continue
    }

    const cells = line.split('|').map((c) => c.trim())

    // Need at least: empty | benchmark | baseline | contender1 | empty
    if (cells.length < 5) {
      continue
    }

    // Skip separator rows
    if (/^-{2,}$/.test(cells[1])) {
      continue
    }

    // Parse header row
    if (!headerParsed && cells[1].includes('Benchmark')) {
      const parsed = parseCompareManyHeader(cells)
      if (parsed) {
        contenderLabels = parsed.contenderLabels
        headerParsed = true
      }
      continue
    }

    if (!headerParsed) {
      continue
    }

    const benchmark = cells[1].trim()
    if (!benchmark) {
      continue
    }

    const baseline = cells[2]?.trim() || ''
    const contenders: CompareManyContenderCell[] = []

    for (let i = 3; i < 3 + contenderLabels.length; i++) {
      const cellText = cells[i]?.trim() || ''
      contenders.push(parseContenderCell(cellText))
    }

    rows.push({ benchmark, baseline, contenders })
  }

  // Deduplicate rows (asv_runner double-discovery workaround)
  const dedupedRows = deduplicateRows(rows)

  // Build per-contender summary
  const summaryPerContender = contenderLabels.map((label, idx) => {
    const counts = { label, regressed: 0, improved: 0, unchanged: 0, incomparable: 0, failed: 0 }
    for (const row of dedupedRows) {
      const cell = row.contenders[idx]
      if (cell) {
        counts[cell.change]++
      }
    }
    return counts
  })

  return { contenderLabels, rows: dedupedRows, summaryPerContender }
}
