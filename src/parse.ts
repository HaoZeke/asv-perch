export type ChangeKind = 'regressed' | 'improved' | 'unchanged' | 'incomparable' | 'failed' | 'unknown'

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
  unknown: BenchmarkRow[]
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
    unknown: number
  }>
}

/**
 * A `+`/`-`/`x`/`!` mark is the table's own call. A `~` ratio, or a blank
 * mark whose ratio is not 1, has no ratio interval in this table: that is
 * not "unchanged". A ratio outside the threshold is never "unchanged".
 */
export function classifyComparison(mark: string, ratioStr: string, threshold = 10): ChangeKind {
  const trimmed = mark.trim()
  switch (trimmed) {
    case '+':
      return 'regressed'
    case '-':
      return 'improved'
    case 'x':
      return 'incomparable'
    case '!':
      return 'failed'
    default:
      break
  }
  const ratioNum = parseRatio(ratioStr)
  const hedged = trimmed === '~' || ratioStr.trim().startsWith('~')
  if (Number.isFinite(ratioNum) && ratioNum > 0 && Number.isFinite(threshold) && threshold > 0) {
    if (ratioNum >= threshold) {
      return 'regressed'
    }
    if (ratioNum <= 1 / threshold) {
      return 'improved'
    }
  }
  if (hedged || (Number.isFinite(ratioNum) && ratioNum !== 1)) {
    return 'unknown'
  }
  return 'unchanged'
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

export function parseComparison(raw: string, threshold = 10): ParsedComparison {
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

    const change = classifyComparison(mark, ratioStr, threshold)
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
    unknown: deduped.filter((r) => r.change === 'unknown'),
  }
}

function parseContenderCell(cell: string, threshold: number): CompareManyContenderCell {
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
    change: classifyComparison(mark, ratioStr, threshold),
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

export function parseCompareMany(raw: string, threshold = 10): ParsedCompareMany {
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
      contenders.push(parseContenderCell(cellText, threshold))
    }

    rows.push({ benchmark, baseline, contenders })
  }

  // Deduplicate rows (asv_runner double-discovery workaround)
  const dedupedRows = deduplicateRows(rows)

  // Build per-contender summary
  const summaryPerContender = contenderLabels.map((label, idx) => {
    const counts = { label, regressed: 0, improved: 0, unchanged: 0, incomparable: 0, failed: 0, unknown: 0 }
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

export type CompareVerdict = 'slower' | 'faster' | 'unchanged' | 'failed'

export interface CompareMeasurement {
  median: number | null
  unit: string
}

export interface CompareJsonRecord {
  name: string
  params: string[]
  machine: string
  environment: string
  before: CompareMeasurement
  after: CompareMeasurement
  ratio: number | null
  ratioCi: [number, number, number] | null
  rounds: number | null
  verdict: CompareVerdict
  aaBand: [number, number, number] | null
}

export interface CompareJsonDocument {
  schemaVersion: 1
  before: { commit: string, label: string }
  after: { commit: string, label: string }
  records: CompareJsonRecord[]
}

export type SelectedComparison =
  | { kind: 'json', doc: CompareJsonDocument }
  | { kind: 'markdown', parsed: ParsedComparison }

const COMPARE_VERDICTS: CompareVerdict[] = ['slower', 'faster', 'unchanged', 'failed']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTriple(value: unknown, label: string): [number, number, number] | null {
  if (value == null) {
    return null
  }
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`asv compare ${label} must be [point, low, high] or null`)
  }
  const nums = value.slice(0, 3).map((item) => (typeof item === 'number' ? item : Number.NaN))
  if (nums.some((item) => !Number.isFinite(item))) {
    return null
  }
  return [nums[0], nums[1], nums[2]]
}

function asMeasurement(value: unknown): CompareMeasurement {
  if (!isRecord(value)) {
    return { median: null, unit: '' }
  }
  const median = typeof value.median === 'number' && Number.isFinite(value.median)
    ? value.median
    : null
  const unit = typeof value.unit === 'string' ? value.unit : ''
  return { median, unit }
}

function asParams(value: unknown): string[] {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new TypeError('asv compare params must be a list')
  }
  return value.map((item) => String(item))
}

function asVerdict(value: unknown): CompareVerdict {
  if (typeof value === 'string' && COMPARE_VERDICTS.includes(value as CompareVerdict)) {
    return value as CompareVerdict
  }
  throw new Error('asv compare verdict must be slower, faster, unchanged, or failed')
}

function asRounds(value: unknown): number | null {
  if (value == null) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('asv compare rounds must be a number or null')
  }
  return value
}

function asRatio(value: unknown): number | null {
  if (value == null) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('asv compare ratio must be a number or null')
  }
  return value
}

function parseCompareJsonRecord(value: unknown): CompareJsonRecord {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error('asv compare record needs a name')
  }
  return {
    name: value.name,
    params: asParams(value.params),
    machine: typeof value.machine === 'string' ? value.machine : '',
    environment: typeof value.environment === 'string' ? value.environment : '',
    before: asMeasurement(value.before),
    after: asMeasurement(value.after),
    ratio: asRatio(value.ratio),
    ratioCi: asTriple(value.ratio_ci, 'ratio_ci'),
    rounds: asRounds(value.rounds),
    verdict: asVerdict(value.verdict),
    aaBand: asTriple(value.aa_band, 'aa_band'),
  }
}

function parseCompareJsonValue(value: Record<string, unknown>): CompareJsonDocument {
  if (value.schema_version !== 1) {
    throw new Error(`Unsupported asv compare schema_version ${String(value.schema_version)}`)
  }
  if (!Array.isArray(value.records)) {
    throw new TypeError('asv compare JSON needs a records list')
  }
  const before = isRecord(value.before) ? value.before : {}
  const after = isRecord(value.after) ? value.after : {}
  return {
    schemaVersion: 1,
    before: {
      commit: typeof before.commit === 'string' ? before.commit : '',
      label: typeof before.label === 'string' ? before.label : '',
    },
    after: {
      commit: typeof after.commit === 'string' ? after.commit : '',
      label: typeof after.label === 'string' ? after.label : '',
    },
    records: value.records.map((record) => parseCompareJsonRecord(record)),
  }
}

/**
 * True when `asv compare --help` lists json among the --format choices.
 * Older asv builds advertise github, or github and latex, and stay on the
 * markdown scraper.
 */
export function helpSupportsCompareJson(helpText: string): boolean {
  return /\{[^}\n]*\bjson\b[^}\n]*\}/.test(helpText)
}

/**
 * True when `asv compare --help` lists latex among the --format choices.
 * asv 0.6.6 has no --format flag, so the .tex artifact is skipped.
 */
export function helpSupportsCompareLatex(helpText: string): boolean {
  return /\{[^}\n]*\blatex\b[^}\n]*\}/.test(helpText)
}

/**
 * schema_version 1 JSON is parsed. Anything else that is not that document
 * is the markdown table older asv builds print.
 */
export function selectComparison(raw: string, threshold = 10): SelectedComparison {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) {
    return { kind: 'markdown', parsed: parseComparison(raw, threshold) }
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return { kind: 'markdown', parsed: parseComparison(raw, threshold) }
  }
  if (!isRecord(value) || !('schema_version' in value) || !Array.isArray(value.records)) {
    return { kind: 'markdown', parsed: parseComparison(raw, threshold) }
  }
  return { kind: 'json', doc: parseCompareJsonValue(value) }
}

export function compareJsonBenchmarkLabel(record: CompareJsonRecord, showEnv: boolean): string {
  const params = record.params.map((item) => String(item))
  const named = params.length > 0 ? `${record.name}(${params.join(', ')})` : record.name
  const short = shortenBenchmark(named)
  if (showEnv && (record.machine || record.environment)) {
    return `${short} [${record.machine}/${record.environment}]`
  }
  return short
}

/**
 * Widest distance from 1 to an A/A band edge. A smaller change still meets
 * that band, so this is the smallest change the run can resolve.
 */
export function smallestResolvableChange(records: CompareJsonRecord[]): number | null {
  let widest: number | null = null
  for (const record of records) {
    if (!record.aaBand) {
      continue
    }
    const [, low, high] = record.aaBand
    const edge = Math.max(high - 1, 1 - low)
    if (!Number.isFinite(edge) || edge < 0) {
      continue
    }
    if (widest === null || edge > widest) {
      widest = edge
    }
  }
  return widest
}

export function formatResolvableChange(edge: number): string {
  const pct = edge * 100
  const whole = pct >= 10 && Math.abs(pct - Math.round(pct)) < 1e-9
  return `${pct.toFixed(whole ? 0 : 1)}%`
}

export function resolvableChangeLine(records: CompareJsonRecord[]): string {
  const edge = smallestResolvableChange(records)
  if (edge === null) {
    return 'This run recorded no A/A band, so the smallest change it can resolve is unknown.'
  }
  if (edge === 0) {
    return 'Smallest change this run can resolve: any nonzero change.'
  }
  return `Smallest change this run can resolve: ${formatResolvableChange(edge)}.`
}

export function formatRatioInterval(triple: [number, number, number] | null): string {
  if (!triple) {
    return 'n/a'
  }
  const [point, low, high] = triple
  return `${point.toFixed(2)} [${low.toFixed(2)}, ${high.toFixed(2)}]`
}

export function jsonCriticalRegression(
  doc: CompareJsonDocument,
  threshold: number,
  onVerdict = false,
): boolean {
  return doc.records.some((record) => {
    if (record.verdict !== 'slower') {
      return false
    }
    if (onVerdict) {
      return true
    }
    return record.ratio !== null && record.ratio >= threshold
  })
}
