import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatResolvableChange,
  helpSupportsCompareJson,
  jsonCriticalRegression,
  parseComparison,
  resolvableChangeLine,
  selectComparison, smallestResolvableChange,
} from '../src/parse'
import { renderComment, renderCompareJsonComment, renderTwoWayComment } from '../src/render'
import { detectRegression, interpretComparison } from '../src/run'

const raw = readFileSync(join(__dirname, 'fixtures', 'compare_schema_v1.json'), 'utf-8')
const markdown = readFileSync(join(__dirname, 'fixtures', 'comparison.txt'), 'utf-8')

const opts = {
  baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  prSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  runnerInfo: 'ubuntu-22.04',
  commentMarker: '<!-- asv-benchmark-result -->',
  regressionThreshold: 10,
}

function jsonDoc() {
  const selected = selectComparison(raw)
  if (selected.kind !== 'json') {
    throw new Error('fixture is schema_version 1 JSON')
  }
  return selected.doc
}

describe('parse compare JSON', () => {
  it('keeps one record per benchmark and parameter combination', () => {
    const doc = jsonDoc()
    expect(doc.schemaVersion).toBe(1)
    expect(doc.records).toHaveLength(6)
    const byKey = new Map(doc.records.map((record) => [
      `${record.name}|${record.params.join(',')}`,
      record,
    ]))
    const slow = byKey.get('bench.time_slow|')!
    expect(slow.verdict).toBe('slower')
    expect(slow.ratio).toBeCloseTo(1.03)
    expect(slow.ratioCi).toEqual([1.03, 1.02, 1.04])
    expect(slow.rounds).toBe(6)
    expect(slow.aaBand).toEqual([1, 0.99, 1.01])
    expect(slow.before.unit).toBe('seconds')
    expect(slow.params).toEqual([])

    expect(byKey.get('bench.time_fast|')!.verdict).toBe('faster')
    expect(byKey.get('bench.time_same|')!.verdict).toBe('unchanged')
    const failed = byKey.get('bench.time_fail|')!
    expect(failed.verdict).toBe('failed')
    expect(failed.ratio).toBeNull()
    expect(failed.ratioCi).toBeNull()
    expect(failed.rounds).toBeNull()
    expect(failed.aaBand).toBeNull()

    const grid = byKey.get('group.time_grid|left,2')!
    expect(grid.verdict).toBe('slower')
    expect(grid.params).toEqual(['left', '2'])
    expect(byKey.get('group.time_grid|right,1')!.verdict).toBe('unchanged')
  })

  it('names the widest A/A band edge as the smallest resolvable change', () => {
    const doc = jsonDoc()
    expect(smallestResolvableChange(doc.records)).toBeCloseTo(0.04)
    expect(formatResolvableChange(0.04)).toBe('4.0%')
    expect(formatResolvableChange(0.1)).toBe('10%')
    expect(resolvableChangeLine(doc.records)).toBe('Smallest change this run can resolve: 4.0%.')
  })

  it('says the resolvable change is unknown when no A/A band was stored', () => {
    expect(resolvableChangeLine([{
      name: 'bench.time_fail',
      params: [],
      machine: 'ci',
      environment: 'virtualenv-py3.12',
      before: { median: null, unit: 'seconds' },
      after: { median: null, unit: 'seconds' },
      ratio: null,
      ratioCi: null,
      rounds: null,
      verdict: 'failed',
      aaBand: null,
    }])).toContain('unknown')
  })

  it('flags a critical regression from a slower ratio', () => {
    const doc = jsonDoc()
    expect(jsonCriticalRegression(doc, 10)).toBe(false)
    expect(jsonCriticalRegression(doc, 1.1)).toBe(true)
    expect(jsonCriticalRegression(doc, 10, true)).toBe(true)
  })

  it('rejects a newer schema', () => {
    expect(() => selectComparison('{"schema_version":2,"records":[]}')).toThrow(/schema_version/)
  })

  it('falls back to markdown scraping when the text is a table', () => {
    const selected = selectComparison(markdown)
    expect(selected.kind).toBe('markdown')
    if (selected.kind !== 'markdown') {
      return
    }
    expect(selected.parsed.rows).toHaveLength(parseComparison(markdown).rows.length)
    expect(selected.parsed.regressed).toHaveLength(3)
  })
})

describe('helpSupportsCompareJson', () => {
  it('accepts json in the format choices and ignores older asv', () => {
    expect(helpSupportsCompareJson('--format {github,latex,json}')).toBe(true)
    expect(helpSupportsCompareJson('--format {github,latex}')).toBe(false)
    expect(helpSupportsCompareJson('usage: asv compare [-h] revision1 revision2')).toBe(false)
  })
})

describe('jSON comment body', () => {
  it('matches the golden comment', () => {
    const doc = jsonDoc()
    const body = renderCompareJsonComment(doc, raw, opts)
    const golden = readFileSync(
      join(__dirname, 'fixtures', 'compare_schema_v1_comment.md'),
      'utf-8',
    ).replace(/\n$/, '')
    expect(body).toBe(golden)
  })

  it('renders markdown through the same entry point for older asv', () => {
    expect(renderTwoWayComment(markdown, opts)).toBe(renderComment(parseComparison(markdown), markdown, opts))
    const interpreted = interpretComparison(markdown, 10, opts)
    expect(interpreted.body).toContain('Raw asv-spyglass output')
    expect(interpreted.hasRegression).toBe(detectRegression(parseComparison(markdown), 10))
    const fromJson = interpretComparison(raw, 1.1, opts)
    const byVerdict = interpretComparison(raw, 10, { ...opts, regressionOnVerdict: true })
    expect(byVerdict.hasRegression).toBe(true)
    const byThreshold = interpretComparison(raw, 10, opts)
    expect(byThreshold.hasRegression).toBe(false)
    expect(fromJson.body).toContain('Smallest change this run can resolve: 4.0%.')
    expect(fromJson.body).toContain('`group.time_grid(left, 2)`')
    expect(fromJson.body).toContain('1.20 [1.15, 1.25]')
    expect(fromJson.body).toContain('1.00 [0.97, 1.04]')
    expect(fromJson.hasRegression).toBe(true)
  })
})
