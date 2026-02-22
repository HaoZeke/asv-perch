import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCompareMany, parseComparison } from '../src/parse'
import { renderComment, renderCompareManyComment } from '../src/render'

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'comparison.txt'),
  'utf-8',
)

const compareManyFixture = readFileSync(
  join(__dirname, 'fixtures', 'compare_many.txt'),
  'utf-8',
)

const defaultOpts = {
  baseSha: 'a1b2c3d4e5f6g7h8',
  prSha: 'e5f6g7h8a1b2c3d4',
  runnerInfo: 'ubuntu-22.04',
  commentMarker: '<!-- asv-benchmark-result -->',
  regressionThreshold: 10,
}

describe('renderComment', () => {
  it('renders mixed results with all sections', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, defaultOpts)

    // Marker
    expect(body).toContain('<!-- asv-benchmark-result -->')

    // Title
    expect(body).toContain('## Benchmark Results')

    // Warning alert for regressions
    expect(body).toContain('> [!WARNING]')
    expect(body).toContain('3 benchmark(s) regressed')

    // Summary table
    expect(body).toContain(':red_circle: Regressed | 3')
    expect(body).toContain(':green_circle: Improved | 2')
    expect(body).toContain(':white_circle: Unchanged | 5')

    // Regressions section
    expect(body).toContain('### Regressions')
    expect(body).toContain('`TimeSuite.time_values(10)`')

    // Improvements section
    expect(body).toContain('### Improvements')
    expect(body).toContain('`TimeSuite.time_keys(10)`')

    // Unchanged collapsible
    expect(body).toContain('5 unchanged benchmark(s)')
    expect(body).toContain('<details>')

    // Details section
    expect(body).toContain('**Base:** `a1b2c3d4`')
    expect(body).toContain('**Head:** `e5f6g7h8`')
    expect(body).toContain('**Runner:** `ubuntu-22.04`')

    // Raw output section
    expect(body).toContain('Raw asv-spyglass output')
  })

  it('renders dashboard URL when provided', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, {
      ...defaultOpts,
      dashboardUrl: 'https://example.com/dashboard',
    })

    expect(body).toContain('[View full results](https://example.com/dashboard)')
  })

  it('omits dashboard link when not provided', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, defaultOpts)

    expect(body).not.toContain('Dashboard')
  })

  it('renders TIP alert when only improvements', () => {
    const input = `| Change | Before | After | Ratio | Benchmark (Parameter) |
|--------|--------|-------|-------|-----------------------|
| -      | 100ns  | 50ns  |  0.50 | benchmarks.Fast.test   |`
    const parsed = parseComparison(input)
    const body = renderComment(parsed, input, defaultOpts)

    expect(body).toContain('> [!TIP]')
    expect(body).toContain('1 benchmark(s) improved')
    expect(body).not.toContain('### Regressions')
  })

  it('renders NOTE alert when all unchanged', () => {
    const input = `| Change | Before | After | Ratio | Benchmark (Parameter) |
|--------|--------|-------|-------|-----------------------|
|        | 100ns  | 101ns | ~1.01 | benchmarks.Same.test   |`
    const parsed = parseComparison(input)
    const body = renderComment(parsed, input, defaultOpts)

    expect(body).toContain('> [!NOTE]')
    expect(body).toContain('All benchmarks unchanged')
    expect(body).not.toContain('### Regressions')
    expect(body).not.toContain('### Improvements')
  })

  it('renders empty results gracefully', () => {
    const parsed = parseComparison('')
    const body = renderComment(parsed, '', defaultOpts)

    expect(body).toContain('<!-- asv-benchmark-result -->')
    expect(body).toContain('## Benchmark Results')
    expect(body).toContain('> [!NOTE]')
  })

  it('strips env labels from benchmark names in rendered tables', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, defaultOpts)

    // Rendered tables should use shortened names (no env label suffix)
    expect(body).toContain('`TimeSuite.time_values(10)`')
    expect(body).toContain('`TimeSuite.time_keys(10)`')

    // Raw output section preserves original text -- extract rendered section only
    const renderedSection = body.split('Raw asv-spyglass output')[0]
    expect(renderedSection).not.toContain('[rgx1gen11/conda-py3.11-numpy -> rgx1gen11/conda-py3.11-numpy]')
  })

  it('uses configurable rawOutputLabel', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, {
      ...defaultOpts,
      rawOutputLabel: 'Full comparison output',
    })

    expect(body).toContain('Full comparison output')
    expect(body).not.toContain('Raw asv-spyglass output')
  })

  it('omits Base/Head lines when SHAs are empty', () => {
    const parsed = parseComparison(fixture)
    const body = renderComment(parsed, fixture, {
      ...defaultOpts,
      baseSha: '',
      prSha: '',
    })

    expect(body).not.toContain('**Base:**')
    expect(body).not.toContain('**Head:**')
    expect(body).toContain('**Runner:**')
  })
})

describe('renderCompareManyComment', () => {
  it('renders multi-way comparison with all sections', () => {
    const parsed = parseCompareMany(compareManyFixture)
    const body = renderCompareManyComment(parsed, compareManyFixture, defaultOpts)

    // Marker and title
    expect(body).toContain('<!-- asv-benchmark-result -->')
    expect(body).toContain('## Benchmark Results (Multi-Way Comparison)')

    // Warning alert for regressions
    expect(body).toContain('> [!WARNING]')
    expect(body).toContain('regression(s) detected across contenders')

    // Summary table with contender labels
    expect(body).toContain('opt-build (Ratio)')
    expect(body).toContain('debug-build (Ratio)')

    // Changed benchmarks section
    expect(body).toContain('### Changed Benchmarks')

    // Unchanged collapsible
    expect(body).toContain('unchanged benchmark(s)')
    expect(body).toContain('<details>')
  })

  it('renders TIP alert when only improvements across contenders', () => {
    const input = `| Benchmark (Parameter)     | baseline   | fast (Ratio)         |
|---------------------------|------------|----------------------|
| benchmarks.Fast.test      | 100ns      | 50ns (- 0.50)        |`
    const parsed = parseCompareMany(input)
    const body = renderCompareManyComment(parsed, input, defaultOpts)

    expect(body).toContain('> [!TIP]')
    expect(body).toContain('improvement(s) detected across contenders')
  })

  it('renders NOTE alert when all unchanged', () => {
    const input = `| Benchmark (Parameter)     | baseline   | same (Ratio)         |
|---------------------------|------------|----------------------|
| benchmarks.Same.test      | 100ns      | 101ns (  ~1.01)      |`
    const parsed = parseCompareMany(input)
    const body = renderCompareManyComment(parsed, input, defaultOpts)

    expect(body).toContain('> [!NOTE]')
    expect(body).toContain('All benchmarks unchanged across contenders')
  })

  it('uses configurable rawOutputLabel', () => {
    const parsed = parseCompareMany(compareManyFixture)
    const body = renderCompareManyComment(parsed, compareManyFixture, {
      ...defaultOpts,
      rawOutputLabel: 'Compare-many output',
    })

    expect(body).toContain('Compare-many output')
    expect(body).not.toContain('Raw asv-spyglass output')
  })

  it('shows Baseline instead of Base for multi-way', () => {
    const parsed = parseCompareMany(compareManyFixture)
    const body = renderCompareManyComment(parsed, compareManyFixture, defaultOpts)

    expect(body).toContain('**Baseline:**')
    expect(body).not.toContain('**Head:**')
  })
})
