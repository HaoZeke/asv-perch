import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyInventoryDiff,
  envDiffSectionFromPaths,
  inventoryFromResult,
  inventoryFromResultPath,
  renderInventorySection,
  summarizeDiff,
} from '../src/inventory'

const fixtures = join(__dirname, 'fixtures')

describe('inventoryFromResult', () => {
  it('extracts python runtime, requirements, machine, env', () => {
    const inv = inventoryFromResult({
      commit_hash: 'a0f29428eeb7563d7d5ab8385c722e8d5560bd06',
      env_name: 'virtualenv-py3.12-numpy',
      python: '3.12',
      requirements: { numpy: '' },
      params: {
        arch: 'x86_64',
        machine: 'rgx1gen11',
        python: '3.12',
        numpy: '',
      },
    })

    expect(inv.machine).toBe('rgx1gen11')
    expect(inv.envName).toBe('virtualenv-py3.12-numpy')
    expect(inv.python).toBe('3.12')
    expect(inv.commitHash.startsWith('a0f29428')).toBe(true)

    const byName = Object.fromEntries(inv.components.map((c) => [c.name, c]))
    expect(byName.python.kind).toBe('runtime')
    expect(byName.python.version).toBe('3.12')
    expect(byName.numpy.kind).toBe('library')
    expect(byName['asv.env_name'].kind).toBe('env')
    expect(byName['machine.arch'].version).toBe('x86_64')
  })

  it('strips pip+ prefix from requirement names', () => {
    const inv = inventoryFromResult({
      python: '3.12',
      requirements: { 'pip+rich': '13.0' },
      params: {},
    })
    const names = inv.components.map((c) => c.name)
    expect(names).toContain('rich')
    expect(names).not.toContain('pip+rich')
  })

  it('normalizes list versions', () => {
    const inv = inventoryFromResult({
      python: ['3.11', 'extra'],
      requirements: {},
      params: {},
    })
    expect(inv.components.find((c) => c.name === 'python')?.version).toBe('3.11')
  })
})

describe('inventoryFromResultPath fixtures', () => {
  it('loads virtualenv-py3.12 without numpy', () => {
    const inv = inventoryFromResultPath(
      join(fixtures, 'a0f29428-virtualenv-py3.12.json'),
    )
    const names = inv.components.map((c) => c.name)
    expect(names).toContain('python')
    expect(names).not.toContain('numpy')
  })

  it('loads virtualenv-py3.12-numpy', () => {
    const inv = inventoryFromResultPath(
      join(fixtures, 'a0f29428-virtualenv-py3.12-numpy.json'),
    )
    const names = inv.components.map((c) => c.name)
    expect(names).toContain('numpy')
  })
})

describe('classifyInventoryDiff', () => {
  const bare = inventoryFromResultPath(
    join(fixtures, 'a0f29428-virtualenv-py3.12.json'),
  )
  const withNumpy = inventoryFromResultPath(
    join(fixtures, 'a0f29428-virtualenv-py3.12-numpy.json'),
  )
  const conda311 = inventoryFromResultPath(
    join(fixtures, 'a0f29428-conda-py3.11-numpy.json'),
  )

  it('classifies numpy as added', () => {
    const changes = classifyInventoryDiff(bare, withNumpy, ['library', 'runtime'])
    const byName = Object.fromEntries(changes.map((c) => [c.name, c]))
    expect(byName.numpy.kind).toBe('added')
    expect(byName.python.kind).toBe('unchanged')
  })

  it('classifies numpy as removed', () => {
    const changes = classifyInventoryDiff(withNumpy, bare, ['library'])
    const byName = Object.fromEntries(changes.map((c) => [c.name, c]))
    expect(byName.numpy.kind).toBe('removed')
  })

  it('classifies python version-bumped', () => {
    const changes = classifyInventoryDiff(conda311, withNumpy, ['runtime'])
    const byName = Object.fromEntries(changes.map((c) => [c.name, c]))
    expect(byName.python.kind).toBe('version-bumped')
    expect(byName.python.baselineVersion).toBe('3.11')
    expect(byName.python.solvedVersion).toBe('3.12')
  })

  it('kinds=null includes env name changes', () => {
    const changes = classifyInventoryDiff(bare, withNumpy, null)
    const byName = Object.fromEntries(changes.map((c) => [c.name, c]))
    expect(byName['asv.env_name'].kind).toBe('version-bumped')
  })

  it('summarizeDiff counts kinds', () => {
    const changes = classifyInventoryDiff(bare, withNumpy, ['library', 'runtime'])
    const s = summarizeDiff(changes)
    expect(s.added).toBe(1)
    expect(s.unchanged).toBeGreaterThanOrEqual(1)
    expect(s.removed).toBe(0)
  })
})

describe('renderInventorySection', () => {
  it('renders ## Environment inventory with summary and table', () => {
    const bare = inventoryFromResultPath(
      join(fixtures, 'a0f29428-virtualenv-py3.12.json'),
    )
    const withNumpy = inventoryFromResultPath(
      join(fixtures, 'a0f29428-virtualenv-py3.12-numpy.json'),
    )
    const md = renderInventorySection(bare, withNumpy, { onlyChanged: true })

    expect(md).toContain('## Environment inventory')
    expect(md).toContain('**Summary:**')
    expect(md).toContain('added')
    expect(md).toContain('`numpy`')
    expect(md).toContain('| Status | Component |')
    // only_changed: unchanged python should not appear as a table row
    expect(md).not.toMatch(/\| unchanged \| `python`/)
  })

  it('envDiffSectionFromPaths integrates load+render', () => {
    const md = envDiffSectionFromPaths(
      join(fixtures, 'a0f29428-virtualenv-py3.12.json'),
      join(fixtures, 'a0f29428-virtualenv-py3.12-numpy.json'),
    )
    expect(md).toContain('## Environment inventory')
    expect(md).toContain('numpy')
  })
})
