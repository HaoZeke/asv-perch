import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBenchmarkShellCommand, detectRegression, readComparisonTextFile, resolveInputs } from '../src/run'
import { parseCompareMany, parseComparison } from '../src/parse'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
}))

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
  getOctokit: vi.fn(),
}))

// Mock @actions/exec
vi.mock('@actions/exec', () => ({
  exec: vi.fn(),
  getExecOutput: vi.fn(),
}))

// Mock @actions/glob
vi.mock('@actions/glob', () => ({
  create: vi.fn(),
}))

const fixture = readFileSync(
  join(__dirname, 'fixtures', 'comparison.txt'),
  'utf-8',
)

// Helper: set up getInput mock with defaults for all known keys
async function mockInputs(overrides: Record<string, string>): Promise<void> {
  const core = await import('@actions/core')
  const getInput = vi.mocked(core.getInput)
  getInput.mockImplementation((name: string) => {
    if (name in overrides) {
      return overrides[name]
    }
    // Defaults for all known inputs
    const defaults: Record<string, string> = {
      'github-token': 'ghp_test',
      'results-path': '',
      'base-sha': '',
      'pr-sha': '',
      'base-file': '',
      'pr-file': '',
      'metadata-file': '',
      'comparison-text-file': '',
      'comparison-mode': 'compare',
      'baseline-sha': '',
      'contender-shas': '',
      'baseline-file': '',
      'contender-files': '',
      'baseline': '',
      'contenders': '',
      'benchmark-command': '',
      'baseline-label': '',
      'contender-labels': '',
      'asv-spyglass-args': '',
      'regression-threshold': '10',
      'auto-draft-on-regression': 'false',
      'comment-marker': '<!-- asv-benchmark-result -->',
      'label-before': 'main',
      'label-after': 'pr',
      'asv-spyglass-ref': 'enh-multiple-comparisons',
      'runner-info': 'ubuntu-latest',
      'dashboard-url': '',
    }
    return defaults[name] || ''
  })
}

describe('resolveInputs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reads explicit SHA inputs', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'base-sha': 'abc123def456',
      'pr-sha': 'def456abc123',
    })

    const result = resolveInputs()
    expect(result.baseSha).toBe('abc123def456')
    expect(result.prSha).toBe('def456abc123')
    expect(result.token).toBe('ghp_test')
  })

  it('reads SHAs from metadata file', async () => {
    const fs = await import('node:fs')
    const tmpDir = join(__dirname, 'fixtures')
    const metaPath = join(tmpDir, 'test_metadata.txt')
    fs.writeFileSync(metaPath, 'main_sha=aabbccdd11223344\npr_sha=55667788aabbccdd\n')

    await mockInputs({
      'results-path': '/tmp/results',
      'metadata-file': metaPath,
    })

    const result = resolveInputs()
    expect(result.baseSha).toBe('aabbccdd11223344')
    expect(result.prSha).toBe('55667788aabbccdd')

    fs.unlinkSync(metaPath)
  })

  it('reads base_sha= key from metadata file', async () => {
    const fs = await import('node:fs')
    const tmpDir = join(__dirname, 'fixtures')
    const metaPath = join(tmpDir, 'test_metadata2.txt')
    fs.writeFileSync(metaPath, 'base_sha=aabbccdd11223344\npr_sha=55667788aabbccdd\n')

    await mockInputs({
      'results-path': '/tmp/results',
      'metadata-file': metaPath,
    })

    const result = resolveInputs()
    expect(result.baseSha).toBe('aabbccdd11223344')

    fs.unlinkSync(metaPath)
  })

  it('throws when SHAs are missing', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
    })

    expect(() => resolveInputs()).toThrow('base-sha/pr-sha (or base-file/pr-file) are required unless comparison-text-file is provided')
  })

  it('explicit SHAs override metadata file', async () => {
    const fs = await import('node:fs')
    const tmpDir = join(__dirname, 'fixtures')
    const metaPath = join(tmpDir, 'test_metadata3.txt')
    fs.writeFileSync(metaPath, 'main_sha=frommetadata1234\npr_sha=frommetadata5678\n')

    await mockInputs({
      'results-path': '/tmp/results',
      'base-sha': 'explicit_base_sha',
      'pr-sha': 'explicit_pr_sha',
      'metadata-file': metaPath,
    })

    const result = resolveInputs()
    expect(result.baseSha).toBe('explicit_base_sha')
    expect(result.prSha).toBe('explicit_pr_sha')

    fs.unlinkSync(metaPath)
  })
})

describe('detectRegression', () => {
  it('detects critical regression above threshold', () => {
    const parsed = parseComparison(fixture)
    expect(detectRegression(parsed, 10)).toBe(true)
  })

  it('no critical regression below threshold', () => {
    const parsed = parseComparison(fixture)
    expect(detectRegression(parsed, 20)).toBe(false)
  })

  it('exact threshold match is regression', () => {
    const parsed = parseComparison(fixture)
    expect(detectRegression(parsed, 15)).toBe(true)
  })

  it('no regression in improvements-only input', () => {
    const input = `| Change | Before | After | Ratio | Benchmark (Parameter) |
|--------|--------|-------|-------|-----------------------|
| -      | 100ns  | 50ns  |  0.50 | benchmarks.Fast.test   |`
    const parsed = parseComparison(input)
    expect(detectRegression(parsed, 10)).toBe(false)
  })

  it('no regression in empty input', () => {
    const parsed = parseComparison('')
    expect(detectRegression(parsed, 10)).toBe(false)
  })
})

describe('resolveInputs with comparison-text-file', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does not require SHAs when comparison-text-file is provided', async () => {
    await mockInputs({
      'comparison-text-file': '/tmp/comparison.txt',
    })

    const result = resolveInputs()
    expect(result.comparisonTextFile).toBe('/tmp/comparison.txt')
    expect(result.baseSha).toBe('')
    expect(result.prSha).toBe('')
  })

  it('parses contender-shas and contender-labels', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'comparison-text-file': '/tmp/comparison.txt',
      'comparison-mode': 'compare-many',
      'baseline-sha': 'aabb1234',
      'contender-shas': 'ccdd5678, eeff9012',
      'baseline-label': 'py311',
      'contender-labels': 'opt-build, debug-build',
      'asv-spyglass-args': '--split --only-changed',
    })

    const result = resolveInputs()
    expect(result.comparisonMode).toBe('compare-many')
    expect(result.baselineSha).toBe('aabb1234')
    expect(result.contenderShas).toEqual(['ccdd5678', 'eeff9012'])
    expect(result.baselineLabel).toBe('py311')
    expect(result.contenderLabels).toEqual(['opt-build', 'debug-build'])
    expect(result.asvSpyglassArgs).toEqual(['--split', '--only-changed'])
  })

  it('throws for compare-many without baseline-sha/file and no comparison-text-file', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'comparison-mode': 'compare-many',
    })

    expect(() => resolveInputs()).toThrow('are required for compare-many mode')
  })

  it('accepts direct file paths for compare-many without SHAs', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'comparison-mode': 'compare-many',
      'baseline-file': '/tmp/results/py311/result.json',
      'contender-files': '/tmp/results/py312/result.json, /tmp/results/gpu/result.json',
      'baseline-label': 'py311',
      'contender-labels': 'py312, gpu',
    })

    const result = resolveInputs()
    expect(result.baselineFile).toBe('/tmp/results/py311/result.json')
    expect(result.contenderFiles).toEqual(['/tmp/results/py312/result.json', '/tmp/results/gpu/result.json'])
    expect(result.baselineSha).toBe('')
    expect(result.contenderShas).toEqual([])
  })

  it('accepts direct file paths for compare without SHAs', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'base-file': '/tmp/results/base.json',
      'pr-file': '/tmp/results/pr.json',
    })

    const result = resolveInputs()
    expect(result.baseFile).toBe('/tmp/results/base.json')
    expect(result.prFile).toBe('/tmp/results/pr.json')
    expect(result.baseSha).toBe('')
    expect(result.prSha).toBe('')
  })
})

describe('yaml baseline/contenders parsing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('parses baseline YAML config', async () => {
    const baselineYaml = 'label: main\nsha: abc12345\nrun-prefix: pixi run -e bench'
    await mockInputs({
      'comparison-text-file': '/tmp/comparison.txt',
      'comparison-mode': 'compare-many',
      'baseline': baselineYaml,
      'contenders': '- label: pr\n  sha: def67890',
    })

    const result = resolveInputs()
    expect(result.baselineConfig).not.toBeNull()
    expect(result.baselineConfig!.label).toBe('main')
    expect(result.baselineConfig!.sha).toBe('abc12345')
    expect(result.baselineConfig!.runPrefix).toBe('pixi run -e bench')
    expect(result.baselineSha).toBe('abc12345')
    expect(result.baselineLabel).toBe('main')
  })

  it('parses contenders YAML list', async () => {
    const contendersYaml = [
      '- label: pr',
      '  sha: def67890',
      '  run-prefix: pixi run -e bench',
      '- label: pr-debug',
      '  sha: def67890',
      '  run-prefix: pixi run -e bench-debug',
      '  env: bench-debug',
      '  description: Debug build with sanitizers',
    ].join('\n')
    await mockInputs({
      'comparison-text-file': '/tmp/comparison.txt',
      'comparison-mode': 'compare-many',
      'baseline-sha': 'abc12345',
      'contenders': contendersYaml,
    })

    const result = resolveInputs()
    expect(result.contenderConfigs).toHaveLength(2)
    expect(result.contenderConfigs[0].label).toBe('pr')
    expect(result.contenderConfigs[0].runPrefix).toBe('pixi run -e bench')
    expect(result.contenderConfigs[1].label).toBe('pr-debug')
    expect(result.contenderConfigs[1].env).toBe('bench-debug')
    expect(result.contenderConfigs[1].description).toBe('Debug build with sanitizers')
    expect(result.contenderLabels).toEqual(['pr', 'pr-debug'])
  })

  it('contenders YAML extracts SHAs into contenderShas', async () => {
    await mockInputs({
      'comparison-text-file': '/tmp/comparison.txt',
      'comparison-mode': 'compare-many',
      'baseline-sha': 'abc12345',
      'contenders': '- label: pr\n  sha: def67890\n- label: pr2\n  sha: ghi11111',
    })

    const result = resolveInputs()
    expect(result.contenderShas).toEqual(['def67890', 'ghi11111'])
  })

  it('structured baseline/contenders satisfy compare-many requirements', async () => {
    await mockInputs({
      'results-path': '/tmp/results',
      'comparison-mode': 'compare-many',
      'baseline': 'label: main\nsha: abc12345\nrun-prefix: pixi run -e bench',
      'contenders': '- label: pr\n  sha: def67890\n  run-prefix: source ./bench.sh',
    })

    // Should not throw -- structured config satisfies requirements
    const result = resolveInputs()
    expect(result.baselineConfig).not.toBeNull()
    expect(result.contenderConfigs).toHaveLength(1)
  })

  it('benchmark-command is passed through', async () => {
    await mockInputs({
      'base-sha': 'abc12345',
      'pr-sha': 'def67890',
      'benchmark-command': 'asv run --quick {sha}^!',
    })

    const result = resolveInputs()
    expect(result.benchmarkCommand).toBe('asv run --quick {sha}^!')
  })
})

describe('buildBenchmarkShellCommand', () => {
  it('substitutes {sha} in benchmark command', () => {
    const cmd = buildBenchmarkShellCommand(undefined, undefined, 'abc123', 'asv run --record-samples {sha}^!')
    expect(cmd).toBe('asv run --record-samples abc123^!')
  })

  it('prepends run-prefix when provided', () => {
    const cmd = buildBenchmarkShellCommand(undefined, 'pixi run -e bench', 'abc123', 'asv run --record-samples {sha}^!')
    expect(cmd).toBe('pixi run -e bench asv run --record-samples abc123^!')
  })

  it('prepends setup with && when provided', () => {
    const cmd = buildBenchmarkShellCommand('source ./env.sh', undefined, 'abc123', 'asv run --record-samples {sha}^!')
    expect(cmd).toBe('source ./env.sh && asv run --record-samples abc123^!')
  })

  it('combines setup and run-prefix', () => {
    const cmd = buildBenchmarkShellCommand('export FOO=1', 'pixi run -e bench', 'abc123', 'asv run --record-samples {sha}^!')
    expect(cmd).toBe('export FOO=1 && pixi run -e bench asv run --record-samples abc123^!')
  })

  it('handles multiple {sha} placeholders', () => {
    const cmd = buildBenchmarkShellCommand(undefined, undefined, 'abc123', 'echo {sha} && asv run {sha}^!')
    expect(cmd).toBe('echo abc123 && asv run abc123^!')
  })

  it('works with no setup/prefix and custom command', () => {
    const cmd = buildBenchmarkShellCommand(undefined, undefined, 'def456', 'pixi run bench {sha}')
    expect(cmd).toBe('pixi run bench def456')
  })
})

describe('readComparisonTextFile', () => {
  it('reads an existing file', () => {
    const fixturePath = join(__dirname, 'fixtures', 'comparison.txt')
    const result = readComparisonTextFile(fixturePath)
    expect(result).toContain('TimeSuite')
  })

  it('throws for non-existent file', () => {
    expect(() => readComparisonTextFile('/tmp/nonexistent_file_12345.txt'))
      .toThrow('Comparison text file not found')
  })
})

describe('compare-many parsing integration', () => {
  it('parses compare-many fixture and detects regressions', () => {
    const compareManyFixture = readFileSync(
      join(__dirname, 'fixtures', 'compare_many.txt'),
      'utf-8',
    )
    const parsed = parseCompareMany(compareManyFixture)
    const hasRegression = parsed.summaryPerContender.some((s) => s.regressed > 0)
    expect(hasRegression).toBe(true)
  })
})
