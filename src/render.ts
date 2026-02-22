import type { BenchmarkRow, CompareManyRow, ParsedCompareMany, ParsedComparison } from './parse'
import { shortenBenchmark } from './parse'

export interface ContenderMeta {
  label: string
  env?: string
  description?: string
}

export interface RenderOptions {
  baseSha: string
  prSha: string
  runnerInfo: string
  dashboardUrl?: string
  commentMarker: string
  regressionThreshold: number
  rawOutputLabel?: string
  contenderMeta?: ContenderMeta[]
}

function emojiForChange(change: string): string {
  switch (change) {
    case 'regressed': return ':red_circle:'
    case 'improved': return ':green_circle:'
    case 'failed': return ':warning:'
    case 'incomparable': return ':grey_question:'
    default: return ':white_circle:'
  }
}

function renderBenchmarkTable(rows: BenchmarkRow[], includeEmoji: boolean): string {
  if (rows.length === 0) {
    return ''
  }

  const lines: string[] = []

  if (includeEmoji) {
    lines.push('| | Benchmark | Before | After | Ratio |')
    lines.push('|---|---|--:|--:|--:|')
    for (const row of rows) {
      const emoji = emojiForChange(row.change)
      const name = `\`${shortenBenchmark(row.benchmark)}\``
      lines.push(`| ${emoji} | ${name} | ${row.before} | ${row.after} | ${row.ratio}x |`)
    }
  } else {
    lines.push('| Benchmark | Before | After | Ratio |')
    lines.push('|---|--:|--:|--:|')
    for (const row of rows) {
      const name = `\`${shortenBenchmark(row.benchmark)}\``
      lines.push(`| ${name} | ${row.before} | ${row.after} | ~${row.ratio}x |`)
    }
  }

  return lines.join('\n')
}

function renderSummaryTable(parsed: ParsedComparison): string {
  const lines: string[] = []
  lines.push('| | Count |')
  lines.push('|---|---:|')

  if (parsed.regressed.length > 0) {
    lines.push(`| :red_circle: Regressed | ${parsed.regressed.length} |`)
  }
  if (parsed.improved.length > 0) {
    lines.push(`| :green_circle: Improved | ${parsed.improved.length} |`)
  }
  if (parsed.unchanged.length > 0) {
    lines.push(`| :white_circle: Unchanged | ${parsed.unchanged.length} |`)
  }
  if (parsed.incomparable.length > 0) {
    lines.push(`| :grey_question: Incomparable | ${parsed.incomparable.length} |`)
  }
  if (parsed.failed.length > 0) {
    lines.push(`| :warning: Failed | ${parsed.failed.length} |`)
  }

  return lines.join('\n')
}

function renderAlert(parsed: ParsedComparison): string {
  const regCount = parsed.regressed.length
  const impCount = parsed.improved.length

  if (regCount > 0) {
    return `> [!WARNING]\n> **${regCount} benchmark(s) regressed**`
  }
  if (impCount > 0) {
    return `> [!TIP]\n> **${impCount} benchmark(s) improved**`
  }
  return `> [!NOTE]\n> **All benchmarks unchanged**`
}

export function renderComment(parsed: ParsedComparison, rawOutput: string, opts: RenderOptions): string {
  const parts: string[] = []

  parts.push(opts.commentMarker)
  parts.push('## Benchmark Results')
  parts.push('')
  parts.push(renderAlert(parsed))
  parts.push('')
  parts.push(renderSummaryTable(parsed))

  // Regressions section
  if (parsed.regressed.length > 0) {
    parts.push('')
    parts.push('### Regressions')
    parts.push('')
    parts.push(renderBenchmarkTable(parsed.regressed, true))
  }

  // Improvements section
  if (parsed.improved.length > 0) {
    parts.push('')
    parts.push('### Improvements')
    parts.push('')
    parts.push(renderBenchmarkTable(parsed.improved, true))
  }

  // Failed section
  if (parsed.failed.length > 0) {
    parts.push('')
    parts.push('### Failed')
    parts.push('')
    parts.push(renderBenchmarkTable(parsed.failed, true))
  }

  // Incomparable section
  if (parsed.incomparable.length > 0) {
    parts.push('')
    parts.push('<details>')
    parts.push(`<summary>${parsed.incomparable.length} incomparable benchmark(s)</summary>`)
    parts.push('')
    parts.push(renderBenchmarkTable(parsed.incomparable, false))
    parts.push('')
    parts.push('</details>')
  }

  // Unchanged section (collapsible)
  if (parsed.unchanged.length > 0) {
    parts.push('')
    parts.push('<details>')
    parts.push(`<summary>${parsed.unchanged.length} unchanged benchmark(s)</summary>`)
    parts.push('')
    parts.push(renderBenchmarkTable(parsed.unchanged, false))
    parts.push('')
    parts.push('</details>')
  }

  // Details section
  parts.push('')
  parts.push('<details>')
  parts.push('<summary>Details</summary>')
  parts.push('')
  if (opts.baseSha) {
    parts.push(`- **Base:** \`${opts.baseSha.slice(0, 8)}\``)
  }
  if (opts.prSha) {
    parts.push(`- **Head:** \`${opts.prSha.slice(0, 8)}\``)
  }
  parts.push(`- **Runner:** \`${opts.runnerInfo}\``)
  if (opts.dashboardUrl) {
    parts.push(`- **Dashboard:** [View full results](${opts.dashboardUrl})`)
  }
  parts.push('')
  parts.push('</details>')

  // Raw output section
  const rawLabel = opts.rawOutputLabel || 'Raw asv-spyglass output'
  parts.push('')
  parts.push('<details>')
  parts.push(`<summary>${rawLabel}</summary>`)
  parts.push('')
  parts.push('```')
  parts.push(rawOutput.trim())
  parts.push('```')
  parts.push('')
  parts.push('</details>')

  return parts.join('\n')
}

function emojiForMark(mark: string): string {
  switch (mark) {
    case '+': return ':red_circle:'
    case '-': return ':green_circle:'
    case 'x': return ':grey_question:'
    case '!': return ':warning:'
    default: return ':white_circle:'
  }
}

function renderCompareManyTable(rows: CompareManyRow[], contenderLabels: string[]): string {
  const lines: string[] = []

  // Header
  const headerCols = ['| | Benchmark | Baseline']
  for (const label of contenderLabels) {
    headerCols.push(label)
  }
  lines.push(`${headerCols.join(' | ')} |`)

  // Separator
  const sepCols = ['|---', '---', '---:']
  for (let i = 0; i < contenderLabels.length; i++) {
    sepCols.push('---:')
  }
  lines.push(`${sepCols.join('|')}|`)

  // Data rows
  for (const row of rows) {
    // Pick worst emoji across contenders for the row-level indicator
    let worstChange = 'unchanged'
    for (const c of row.contenders) {
      if (c.change === 'regressed') {
        worstChange = 'regressed'
        break
      }
      if (c.change === 'improved' && worstChange !== 'regressed') {
        worstChange = 'improved'
      }
      if (c.change === 'incomparable' && worstChange === 'unchanged') {
        worstChange = 'incomparable'
      }
      if (c.change === 'failed') {
        worstChange = 'failed'
        break
      }
    }
    const rowEmoji = emojiForChange(worstChange)
    const name = `\`${shortenBenchmark(row.benchmark)}\``

    const cells = [`| ${rowEmoji}`, name, row.baseline]
    for (const c of row.contenders) {
      const cellEmoji = emojiForMark(c.mark)
      cells.push(`${cellEmoji} ${c.value} (${c.ratio})`)
    }
    lines.push(`${cells.join(' | ')} |`)
  }

  return lines.join('\n')
}

function renderCompareManyAlert(parsed: ParsedCompareMany): string {
  const totalRegressed = parsed.summaryPerContender.reduce((sum, s) => sum + s.regressed, 0)
  const totalImproved = parsed.summaryPerContender.reduce((sum, s) => sum + s.improved, 0)

  if (totalRegressed > 0) {
    return `> [!WARNING]\n> **${totalRegressed} regression(s) detected across contenders**`
  }
  if (totalImproved > 0) {
    return `> [!TIP]\n> **${totalImproved} improvement(s) detected across contenders**`
  }
  return `> [!NOTE]\n> **All benchmarks unchanged across contenders**`
}

function renderCompareManySummary(parsed: ParsedCompareMany): string {
  const lines: string[] = []

  const headerCols = ['| | Contender']
  const sepCols = ['|---', '---']
  const metrics = [':red_circle: Regressed', ':green_circle: Improved', ':white_circle: Unchanged']

  lines.push(`${headerCols.join(' | ')} | ${metrics.join(' | ')} |`)
  lines.push(`${sepCols.join('|')}|---:|---:|---:|`)

  for (const s of parsed.summaryPerContender) {
    lines.push(`| | ${s.label} | ${s.regressed} | ${s.improved} | ${s.unchanged} |`)
  }

  return lines.join('\n')
}

export function renderCompareManyComment(parsed: ParsedCompareMany, rawOutput: string, opts: RenderOptions): string {
  const parts: string[] = []

  parts.push(opts.commentMarker)
  parts.push('## Benchmark Results (Multi-Way Comparison)')
  parts.push('')
  parts.push(renderCompareManyAlert(parsed))
  parts.push('')
  parts.push(renderCompareManySummary(parsed))

  // Separate changed from unchanged rows
  const changedRows = parsed.rows.filter((row) =>
    row.contenders.some((c) => c.change === 'regressed' || c.change === 'improved' || c.change === 'failed'),
  )
  const unchangedRows = parsed.rows.filter((row) =>
    row.contenders.every((c) => c.change === 'unchanged' || c.change === 'incomparable'),
  )

  // Changed benchmarks table
  if (changedRows.length > 0) {
    parts.push('')
    parts.push('### Changed Benchmarks')
    parts.push('')
    parts.push(renderCompareManyTable(changedRows, parsed.contenderLabels))
  }

  // Unchanged collapsible
  if (unchangedRows.length > 0) {
    parts.push('')
    parts.push('<details>')
    parts.push(`<summary>${unchangedRows.length} unchanged benchmark(s)</summary>`)
    parts.push('')
    parts.push(renderCompareManyTable(unchangedRows, parsed.contenderLabels))
    parts.push('')
    parts.push('</details>')
  }

  // Details section
  parts.push('')
  parts.push('<details>')
  parts.push('<summary>Details</summary>')
  parts.push('')
  if (opts.baseSha) {
    parts.push(`- **Baseline:** \`${opts.baseSha.slice(0, 8)}\``)
  }
  parts.push(`- **Runner:** \`${opts.runnerInfo}\``)
  if (opts.dashboardUrl) {
    parts.push(`- **Dashboard:** [View full results](${opts.dashboardUrl})`)
  }
  if (opts.contenderMeta && opts.contenderMeta.length > 0) {
    parts.push('')
    parts.push('**Contenders:**')
    parts.push('')
    for (const meta of opts.contenderMeta) {
      const envStr = meta.env ? ` (env: \`${meta.env}\`)` : ''
      const descStr = meta.description ? ` -- ${meta.description}` : ''
      parts.push(`- **${meta.label}**${envStr}${descStr}`)
    }
  }
  parts.push('')
  parts.push('</details>')

  // Raw output section
  const rawLabel = opts.rawOutputLabel || 'Raw asv-spyglass output'
  parts.push('')
  parts.push('<details>')
  parts.push(`<summary>${rawLabel}</summary>`)
  parts.push('')
  parts.push('```')
  parts.push(rawOutput.trim())
  parts.push('```')
  parts.push('')
  parts.push('</details>')

  return parts.join('\n')
}
