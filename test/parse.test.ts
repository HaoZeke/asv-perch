import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCompareMany, parseComparison, shortenBenchmark } from '../src/parse'

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'comparison.txt'),
  'utf-8',
)

const compareManyFixture = readFileSync(
  join(__dirname, 'fixtures', 'compare_many.txt'),
  'utf-8',
)

const splitFixture = readFileSync(
  join(__dirname, 'fixtures', 'compare_split.txt'),
  'utf-8',
)

describe('parseComparison', () => {
  it('parses the fixture into correct row counts', () => {
    const result = parseComparison(fixture)
    expect(result.rows).toHaveLength(10)
    expect(result.regressed).toHaveLength(3)
    expect(result.improved).toHaveLength(2)
    expect(result.unchanged).toHaveLength(5)
    expect(result.incomparable).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it('extracts correct data from a regressed row', () => {
    const result = parseComparison(fixture)
    const first = result.regressed[0]
    expect(first.mark).toBe('+')
    expect(first.change).toBe('regressed')
    expect(first.before).toBe('167+/-3ns')
    expect(first.after).toBe('187+/-3ns')
    expect(first.ratio).toBe('1.12')
    expect(first.ratioNum).toBeCloseTo(1.12)
    expect(first.benchmark).toContain('TimeSuite.time_values(10)')
  })

  it('extracts correct data from an improved row', () => {
    const result = parseComparison(fixture)
    const first = result.improved[0]
    expect(first.mark).toBe('-')
    expect(first.change).toBe('improved')
    expect(first.before).toBe('157+/-3ns')
    expect(first.after).toBe('137+/-3ns')
    expect(first.ratioNum).toBeCloseTo(0.87)
  })

  it('handles ~ prefix on ratio for unchanged rows', () => {
    const result = parseComparison(fixture)
    const unchanged = result.unchanged[0]
    expect(unchanged.ratio).toBe('~0.91')
    expect(unchanged.ratioNum).toBeCloseTo(0.91)
    expect(unchanged.change).toBe('unchanged')
  })

  it('handles empty input', () => {
    const result = parseComparison('')
    expect(result.rows).toHaveLength(0)
    expect(result.regressed).toHaveLength(0)
    expect(result.improved).toHaveLength(0)
    expect(result.unchanged).toHaveLength(0)
  })

  it('handles header-only input', () => {
    const headerOnly = `| Change   | Before      | After       |   Ratio | Benchmark (Parameter) |
|----------|-------------|-------------|---------|------------------------|`
    const result = parseComparison(headerOnly)
    expect(result.rows).toHaveLength(0)
  })

  it('handles malformed lines gracefully', () => {
    const input = `| Change   | Before      | After       |   Ratio | Benchmark (Parameter) |
|----------|-------------|-------------|---------|------------------------|
| +        | 100ns       | 200ns       |    2.00 | benchmarks.Foo.bar     |
this line is not a table row
| garbage |
| +        | 50ns        | 100ns       |    2.00 | benchmarks.Baz.qux     |`
    const result = parseComparison(input)
    expect(result.rows).toHaveLength(2)
    expect(result.regressed).toHaveLength(2)
  })

  it('classifies x mark as incomparable', () => {
    const input = `| Change | Before | After | Ratio | Benchmark (Parameter) |
|--------|--------|-------|-------|-----------------------|
| x      | 100ns  | n/a   |   n/a | benchmarks.Broken.test |`
    const result = parseComparison(input)
    expect(result.incomparable).toHaveLength(1)
    expect(result.incomparable[0].change).toBe('incomparable')
  })

  it('classifies ! mark as failed', () => {
    const input = `| Change | Before | After | Ratio | Benchmark (Parameter) |
|--------|--------|-------|-------|-----------------------|
| !      | 100ns  | err   |   n/a | benchmarks.Fail.test   |`
    const result = parseComparison(input)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].change).toBe('failed')
  })
})

describe('parseCompareMany', () => {
  it('parses the compare-many fixture into correct row counts', () => {
    const result = parseCompareMany(compareManyFixture)
    expect(result.rows).toHaveLength(8)
    expect(result.contenderLabels).toHaveLength(2)
  })

  it('extracts contender labels from header', () => {
    const result = parseCompareMany(compareManyFixture)
    expect(result.contenderLabels[0]).toBe('opt-build (Ratio)')
    expect(result.contenderLabels[1]).toBe('debug-build (Ratio)')
  })

  it('extracts correct data from a regressed contender cell', () => {
    const result = parseCompareMany(compareManyFixture)
    const first = result.rows[0]
    expect(first.baseline).toBe('167+/-3ns')
    expect(first.contenders[0].value).toBe('187+/-3ns')
    expect(first.contenders[0].mark).toBe('+')
    expect(first.contenders[0].change).toBe('regressed')
    expect(first.contenders[0].ratioNum).toBeCloseTo(1.12)
  })

  it('extracts correct data from an improved contender cell', () => {
    const result = parseCompareMany(compareManyFixture)
    // Row 1 (time_values(100)), contender 1 (debug-build): "195+/-4ns (- 0.98)"
    const row = result.rows[1]
    expect(row.contenders[1].mark).toBe('-')
    expect(row.contenders[1].change).toBe('improved')
    expect(row.contenders[1].ratioNum).toBeCloseTo(0.98)
  })

  it('handles ~ prefix on unchanged contender cells', () => {
    const result = parseCompareMany(compareManyFixture)
    // Row 4 (time_keys(200)), contender 0: "1.07+/-0us (  ~0.91)"
    const row = result.rows[4]
    expect(row.contenders[0].ratio).toBe('~0.91')
    expect(row.contenders[0].change).toBe('unchanged')
    expect(row.contenders[0].ratioNum).toBeCloseTo(0.91)
  })

  it('handles incomparable (x) contender cells', () => {
    const result = parseCompareMany(compareManyFixture)
    // Row 7 (time_broken), contender 0: "n/a (x n/a)"
    const row = result.rows[7]
    expect(row.contenders[0].mark).toBe('x')
    expect(row.contenders[0].change).toBe('incomparable')
  })

  it('builds correct per-contender summary', () => {
    const result = parseCompareMany(compareManyFixture)
    // opt-build: 3 regressed (+), 1 improved (-), 3 unchanged (~), 1 incomparable (x)
    expect(result.summaryPerContender[0].regressed).toBe(3)
    expect(result.summaryPerContender[0].improved).toBe(1)
    expect(result.summaryPerContender[0].unchanged).toBe(3)
    expect(result.summaryPerContender[0].incomparable).toBe(1)
    // debug-build: 1 regressed, 1 improved, 6 unchanged, 0 incomparable
    expect(result.summaryPerContender[1].regressed).toBe(1)
    expect(result.summaryPerContender[1].improved).toBe(1)
    expect(result.summaryPerContender[1].unchanged).toBe(6)
  })

  it('handles empty input', () => {
    const result = parseCompareMany('')
    expect(result.rows).toHaveLength(0)
    expect(result.contenderLabels).toHaveLength(0)
    expect(result.summaryPerContender).toHaveLength(0)
  })
})

describe('parseComparison with --split output', () => {
  it('parses split output as a single comparison', () => {
    // The split output has multiple tables separated by section headers.
    // parseComparison skips non-table lines and merges all table rows.
    const result = parseComparison(splitFixture)
    expect(result.rows).toHaveLength(6)
    expect(result.improved).toHaveLength(2)
    expect(result.regressed).toHaveLength(2)
    expect(result.unchanged).toHaveLength(2)
  })
})

describe('shortenBenchmark', () => {
  it('strips benchmarks. prefix', () => {
    expect(shortenBenchmark('benchmarks.TimeSuite.time_values(10)'))
      .toBe('TimeSuite.time_values(10)')
  })

  it('strips env label suffix', () => {
    expect(shortenBenchmark('benchmarks.TimeSuite.time_values(10) [env1/foo -> env2/bar]'))
      .toBe('TimeSuite.time_values(10)')
  })

  it('handles names without prefix', () => {
    expect(shortenBenchmark('TimeSuite.time_values(10)'))
      .toBe('TimeSuite.time_values(10)')
  })

  it('handles names without suffix', () => {
    expect(shortenBenchmark('benchmarks.Foo.bar'))
      .toBe('Foo.bar')
  })
})
