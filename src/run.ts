import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { getInput, info, notice, setFailed, setOutput, warning } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { context, getOctokit } from '@actions/github'
import { create as createGlob } from '@actions/glob'
import yaml from 'js-yaml'
import { envDiffSectionFromPaths } from './inventory'
import { helpSupportsCompareJson, helpSupportsCompareLatex, jsonCriticalRegression, parseCompareMany, selectComparison } from './parse'
import type { ParsedComparison } from './parse'
import type { RenderOptions } from './render'
import { renderCompareJsonComment, renderCompareManyComment, renderTwoWayComment } from './render'

type ComparisonMode = 'compare' | 'compare-many'

export interface BaselineConfig {
  label?: string
  file?: string
  sha?: string
  setup?: string
  runPrefix?: string
  env?: string
  description?: string
}

export interface ContenderConfig {
  label: string
  file?: string
  sha?: string
  setup?: string
  runPrefix?: string
  env?: string
  description?: string
}

interface ResolvedInputs {
  token: string
  resultsPath: string
  baseSha: string
  prSha: string
  baseFile: string
  prFile: string
  comparisonTextFile: string
  comparisonMode: ComparisonMode
  baselineSha: string
  contenderShas: string[]
  baselineFile: string
  contenderFiles: string[]
  baselineConfig: BaselineConfig | null
  contenderConfigs: ContenderConfig[]
  baselineLabel: string
  contenderLabels: string[]
  benchmarkCommand: string
  initCommand: string
  preservePaths: string[]
  asvSpyglassArgs: string[]
  regressionThreshold: number
  regressionOnVerdict: boolean
  latexTable: boolean
  latexTablePath: string
  autoDraftOnRegression: boolean
  commentMarker: string
  labelBefore: string
  labelAfter: string
  asvSpyglassRef: string
  runnerInfo: string
  dashboardUrl: string
  envDiff: boolean
  postComment: boolean
  uploadCommentArtifact: boolean
  commentArtifactName: string
  commentArtifactPath: string
}

/** Parse a boolean action input. Empty string uses the provided default. */
export function parseBoolInput(raw: string, defaultValue: boolean): boolean {
  const v = raw.trim().toLowerCase()
  if (!v) {
    return defaultValue
  }
  if (v === 'true' || v === '1' || v === 'yes') {
    return true
  }
  if (v === 'false' || v === '0' || v === 'no') {
    return false
  }
  return defaultValue
}

// Step 1: Resolve inputs
export function resolveInputs(): ResolvedInputs {
  const postComment = parseBoolInput(getInput('post-comment') || '', true)
  const uploadCommentArtifact = parseBoolInput(getInput('upload-comment-artifact') || '', false)
  const autoDraftOnRegression = getInput('auto-draft-on-regression') === 'true'
  // Token required when posting comments or converting PR to draft
  const tokenRequired = postComment || autoDraftOnRegression
  const token = getInput('github-token', { required: tokenRequired }) || ''
  const resultsPath = getInput('results-path') || ''
  const comparisonTextFile = getInput('comparison-text-file') || ''
  const comparisonMode = (getInput('comparison-mode') || 'compare') as ComparisonMode
  let baselineSha = getInput('baseline-sha') || ''
  let baselineFile = getInput('baseline-file') || ''
  const contenderShasRaw = getInput('contender-shas') || ''
  const contenderShas = contenderShasRaw
    ? contenderShasRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const contenderFilesRaw = getInput('contender-files') || ''
  let contenderFilesList = contenderFilesRaw
    ? contenderFilesRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  let baselineLabel = getInput('baseline-label') || ''
  const contenderLabelsRaw = getInput('contender-labels') || ''
  let contenderLabelsList = contenderLabelsRaw
    ? contenderLabelsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const benchmarkCommand = getInput('benchmark-command') || ''
  const initCommand = getInput('init-command') || ''
  const preservePathsRaw = getInput('preserve-paths') || ''
  const preservePaths = preservePathsRaw
    ? preservePathsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  // Normalize YAML-parsed objects: map kebab-case keys to camelCase
  function normalizeConfig<T>(raw: Record<string, unknown>): T {
    if ('run-prefix' in raw) {
      const { 'run-prefix': rp, ...rest } = raw
      return { ...rest, runPrefix: rp } as T
    }
    return raw as T
  }

  // Parse structured baseline YAML
  const baselineYaml = getInput('baseline') || ''
  let baselineConfig: BaselineConfig | null = null
  if (baselineYaml) {
    baselineConfig = normalizeConfig<BaselineConfig>(yaml.load(baselineYaml) as Record<string, unknown>)
    if (baselineConfig.sha && !baselineSha) {
      baselineSha = baselineConfig.sha
    }
    if (baselineConfig.file && !baselineFile) {
      baselineFile = baselineConfig.file
    }
    if (baselineConfig.label && !baselineLabel) {
      baselineLabel = baselineConfig.label
    }
  }

  // Parse structured contenders YAML -- overrides flat lists when provided
  const contendersYaml = getInput('contenders') || ''
  let contenderConfigs: ContenderConfig[] = []
  if (contendersYaml) {
    const rawList = yaml.load(contendersYaml) as Record<string, unknown>[]
    contenderConfigs = rawList.map((c) => normalizeConfig<ContenderConfig>(c))
    // Extract files, SHAs, and labels from structured config
    contenderFilesList = contenderConfigs
      .map((c) => c.file || '')
      .filter(Boolean)
    const configShas = contenderConfigs
      .map((c) => c.sha || '')
      .filter(Boolean)
    if (configShas.length > 0 && contenderShas.length === 0) {
      contenderShas.push(...configShas)
    }
    contenderLabelsList = contenderConfigs.map((c) => c.label)
  }
  const asvSpyglassArgsRaw = getInput('asv-spyglass-args') || ''
  const asvSpyglassArgs = asvSpyglassArgsRaw
    ? asvSpyglassArgsRaw.split(/\s+/).filter(Boolean)
    : []

  let baseFileInput = getInput('base-file') || ''
  let prFileInput = getInput('pr-file') || ''
  let baseSha = getInput('base-sha')
  let prSha = getInput('pr-sha')
  const metadataFile = getInput('metadata-file')

  // Parse metadata file for SHAs if not explicitly set
  if (metadataFile && existsSync(metadataFile)) {
    const content = readFileSync(metadataFile, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!baseSha && (trimmed.startsWith('main_sha=') || trimmed.startsWith('base_sha='))) {
        baseSha = trimmed.split('=')[1].trim()
      }
      if (!prSha && trimmed.startsWith('pr_sha=')) {
        prSha = trimmed.split('=')[1].trim()
      }
    }
  }

  // Structured configs can satisfy SHA/file requirements
  const hasStructuredBaseline = baselineConfig && (baselineConfig.sha || baselineConfig.file || baselineConfig.runPrefix || baselineConfig.setup)
  const hasStructuredContenders = contenderConfigs.length > 0

  // Map structured configs to compare-mode SHAs when in compare mode
  if (comparisonMode === 'compare' && hasStructuredBaseline && hasStructuredContenders) {
    if (baselineConfig?.sha && !baseSha) {
      baseSha = baselineConfig.sha
    }
    if (contenderConfigs.length > 0 && contenderConfigs[0].sha && !prSha) {
      prSha = contenderConfigs[0].sha
    }
    if (baselineConfig?.file && !baseFileInput) {
      baseFileInput = baselineConfig.file
    }
    if (contenderConfigs[0]?.file && !prFileInput) {
      prFileInput = contenderConfigs[0].file
    }
  }

  // SHAs or direct files required unless comparison-text-file or structured configs provided
  if (!comparisonTextFile && comparisonMode === 'compare') {
    const hasFiles = baseFileInput && prFileInput
    const hasShas = baseSha && prSha
    const hasStructured = hasStructuredBaseline && hasStructuredContenders
    if (!hasFiles && !hasShas && !hasStructured) {
      throw new Error('base-sha/pr-sha (or base-file/pr-file, or baseline/contenders YAML) are required unless comparison-text-file is provided')
    }
  }
  if (!comparisonTextFile && comparisonMode === 'compare-many') {
    const hasFiles = baselineFile && contenderFilesList.length > 0
    const hasShas = baselineSha && contenderShas.length > 0
    const hasStructured = hasStructuredBaseline && hasStructuredContenders
    if (!hasFiles && !hasShas && !hasStructured) {
      throw new Error('baseline-sha/contender-shas (or baseline-file/contender-files, or baseline/contenders YAML) are required for compare-many mode unless comparison-text-file is provided')
    }
  }

  return {
    token,
    resultsPath,
    baseSha: baseSha || '',
    prSha: prSha || '',
    baseFile: baseFileInput,
    prFile: prFileInput,
    comparisonTextFile,
    comparisonMode,
    baselineSha,
    contenderShas,
    baselineFile,
    contenderFiles: contenderFilesList,
    baselineConfig,
    contenderConfigs,
    baselineLabel,
    contenderLabels: contenderLabelsList,
    benchmarkCommand,
    initCommand,
    preservePaths,
    asvSpyglassArgs,
    regressionThreshold: Number.parseFloat(getInput('regression-threshold') || '10'),
    regressionOnVerdict: parseBoolInput(getInput('regression-on-verdict') || '', false),
    latexTable: parseBoolInput(getInput('latex-table') || '', false),
    latexTablePath: getInput('latex-table-path') || 'asv-compare.tex',
    autoDraftOnRegression,
    commentMarker: getInput('comment-marker') || '<!-- asv-benchmark-result -->',
    labelBefore: getInput('label-before') || baselineConfig?.label || 'main',
    labelAfter: getInput('label-after') || contenderConfigs[0]?.label || 'pr',
    asvSpyglassRef: getInput('asv-spyglass-ref') || 'main',
    runnerInfo: getInput('runner-info') || 'ubuntu-latest',
    dashboardUrl: getInput('dashboard-url') || '',
    // Pure-TS JSON parse of result files -- cheap; default on when result files exist
    envDiff: parseBoolInput(getInput('env-diff') || '', true),
    postComment,
    uploadCommentArtifact,
    commentArtifactName: getInput('comment-artifact-name') || 'asv-perch-comment',
    commentArtifactPath: getInput('comment-artifact-path') || 'asv-perch-comment.md',
  }
}

/**
 * Build "## Environment inventory" markdown from two result JSON paths.
 * Returns undefined when env-diff is disabled or files cannot be read.
 */
export function maybeBuildEnvDiffSection(
  enabled: boolean,
  baselinePath: string | undefined,
  contenderPath: string | undefined,
): string | undefined {
  if (!enabled || !baselinePath || !contenderPath) {
    return undefined
  }
  try {
    const section = envDiffSectionFromPaths(baselinePath, contenderPath)
    info(`Environment inventory: compared ${baselinePath} vs ${contenderPath}`)
    return section
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warning(`env-diff skipped: ${msg}`)
    return undefined
  }
}

/** Write comment body to a file for artifact upload / workflow hand-off. */
export function writeCommentBodyFile(path: string, body: string): void {
  const dir = dirname(path)
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, `${body}\n`, 'utf-8')
  info(`Wrote comment body to ${path}`)
}

/**
 * asv names the interleaved base' environment `{env}~aa`. That file shares
 * the base commit's hash prefix with the real result, and it is not the
 * baseline measurement.
 */
export function isAaEnvironmentResult(filePath: string): boolean {
  const basename = filePath.split('/').pop() || ''
  return basename.includes('~aa.json')
}

/**
 * Pick the result file for a commit. When the A/A copy and the real result
 * both match the hash prefix, keep the real result. Several machines still
 * resolve to the last primary match, as before.
 */
export function selectResultFile(files: string[], sha: string): string {
  const prefix = sha.slice(0, 8)
  if (!prefix) {
    return ''
  }
  const matches = files.filter((filePath) => {
    const basename = filePath.split('/').pop() || ''
    return basename.startsWith(prefix)
  })
  const primary = matches.filter((filePath) => !isAaEnvironmentResult(filePath))
  const pool = primary.length > 0 ? primary : matches
  return pool.length > 0 ? pool[pool.length - 1] : ''
}

// Step 2: Find result files by SHA prefix
export async function findResultFiles(
  resultsPath: string,
  baseSha: string,
  prSha: string,
): Promise<{ baseFile: string, prFile: string }> {
  const globber = await createGlob(`${resultsPath}/**/*.json`)
  const allFiles = await globber.glob()
  const baseFile = selectResultFile(allFiles, baseSha)
  const prFile = selectResultFile(allFiles, prSha)

  if (!baseFile) {
    throw new Error(`No result file found for base SHA prefix ${baseSha.slice(0, 8)} in ${resultsPath}`)
  }
  if (!prFile) {
    throw new Error(`No result file found for PR SHA prefix ${prSha.slice(0, 8)} in ${resultsPath}`)
  }

  info(`Base result: ${baseFile}`)
  info(`PR result: ${prFile}`)
  return { baseFile, prFile }
}

// Step 3: Run asv-spyglass compare
export async function runComparison(
  baseFile: string,
  prFile: string,
  resultsPath: string,
  labelBefore: string,
  labelAfter: string,
  asvSpyglassRef: string,
  extraArgs: string[] = [],
): Promise<string> {
  // Try pre-computed comparison first
  const precomputed = join(resultsPath, 'comparison.txt')
  if (existsSync(precomputed)) {
    info('Using pre-computed comparison.txt')
    return readFileSync(precomputed, 'utf-8')
  }

  // Find benchmarks.json for asv-spyglass (BCONF is a positional arg)
  const benchGlobber = await createGlob(`${resultsPath}/**/benchmarks.json`)
  const benchFiles = await benchGlobber.glob()
  const bconfArg = benchFiles.length > 0 ? [benchFiles[0]] : []

  const spyglassUrl = `git+https://github.com/airspeed-velocity/asv_spyglass.git@${asvSpyglassRef}`

  info(`Running: uvx --from "${spyglassUrl}" asv-spyglass compare`)
  const result = await getExecOutput(
    'uvx',
    [
      '--from', spyglassUrl,
      'asv-spyglass', 'compare',
      baseFile,
      prFile,
      ...bconfArg,
      '--label-before', labelBefore,
      '--label-after', labelAfter,
      ...extraArgs,
    ],
    { silent: false },
  )

  return result.stdout
}

// Find a result file by SHA prefix
export async function findResultFileByPrefix(
  resultsPath: string,
  sha: string,
): Promise<string> {
  const globber = await createGlob(`${resultsPath}/**/*.json`)
  const allFiles = await globber.glob()
  const found = selectResultFile(allFiles, sha)
  if (found) {
    return found
  }

  throw new Error(`No result file found for SHA prefix ${sha.slice(0, 8)} in ${resultsPath}`)
}

// Step 3b: Run asv-spyglass compare-many
export async function runCompareMany(
  baselineFile: string,
  contenderFiles: string[],
  resultsPath: string,
  asvSpyglassRef: string,
  extraArgs: string[] = [],
  baselineLabel?: string,
  contenderLabels?: string[],
): Promise<string> {
  // Find benchmarks.json for asv-spyglass (--bconf flag for compare-many)
  const benchGlobber = await createGlob(`${resultsPath}/**/benchmarks.json`)
  const benchFiles = await benchGlobber.glob()
  const bconfArg = benchFiles.length > 0
    ? ['--bconf', benchFiles[0]]
    : []

  // Build label arguments (--label/-l, baseline first)
  const labelArgs: string[] = []
  if (baselineLabel) {
    labelArgs.push('--label', baselineLabel)
  }
  if (contenderLabels && contenderLabels.length > 0) {
    for (const label of contenderLabels) {
      labelArgs.push('--label', label)
    }
  }

  const spyglassUrl = `git+https://github.com/airspeed-velocity/asv_spyglass.git@${asvSpyglassRef}`

  info(`Running: uvx --from "${spyglassUrl}" asv-spyglass compare-many`)
  const result = await getExecOutput(
    'uvx',
    [
      '--from', spyglassUrl,
      'asv-spyglass', 'compare-many',
      baselineFile,
      ...contenderFiles,
      ...bconfArg,
      ...labelArgs,
      ...extraArgs,
    ],
    { silent: false },
  )

  return result.stdout
}

const DEFAULT_BENCHMARK_COMMAND = 'asv run --record-samples {sha}^!'

// Build the shell command for a benchmark run.
// setup:      sourced/eval'd before the command (joined with &&)
// run-prefix: prepended with a space (wrapper pattern: pixi run -e bench CMD)
// Both can be combined: setup && run-prefix benchmarkCommand
export function buildBenchmarkShellCommand(
  setup: string | undefined,
  runPrefix: string | undefined,
  sha: string,
  benchmarkCommand: string,
): string {
  const cmd = benchmarkCommand.replace(/\{sha\}/g, sha)
  const resolvedSetup = setup?.replace(/\{sha\}/g, sha)
  const resolvedPrefix = runPrefix?.replace(/\{sha\}/g, sha)
  const benchCmd = resolvedPrefix ? `${resolvedPrefix} ${cmd}` : cmd
  if (resolvedSetup) {
    return `${resolvedSetup} && ${benchCmd}`
  }
  return benchCmd
}

// Build the git checkout + preserve command prefix for an entry.
// When preserve-paths is set, stash files before checkout and restore after.
export function buildCheckoutCommand(
  sha: string,
  preservePaths: string[],
): string {
  if (preservePaths.length === 0) {
    return `git checkout -f ${sha} && git clean -fd`
  }
  const stashDir = '/tmp/_asv_preserve'
  const stash = preservePaths.map((p) => `cp -r ${p} ${stashDir}/`).join(' && ')
  const restore = preservePaths.map((p) => {
    const basename = p.replace(/\/$/, '').split('/').pop()!
    return `rm -rf ${p} && cp -r ${stashDir}/${basename} ${p}`
  }).join(' && ')
  return `mkdir -p ${stashDir} && ${stash} && git checkout -f ${sha} && git clean -fd && ${restore}`
}

// Execute benchmark commands for all entries that have setup/run-prefix/sha.
// Baseline runs first, then contenders run in parallel.
export async function executeBenchmarks(
  baselineConfig: BaselineConfig | null,
  contenderConfigs: ContenderConfig[],
  benchmarkCommand: string,
  initCommand?: string,
  preservePaths: string[] = [],
): Promise<void> {
  const template = benchmarkCommand || DEFAULT_BENCHMARK_COMMAND

  // Run init command once (e.g. asv machine --yes)
  if (initCommand) {
    info(`Running init command: ${initCommand}`)
    await exec('bash', ['-c', initCommand])
  }

  // Helper: prepend git checkout if entry has sha and preserve-paths is set
  function withCheckout(
    sha: string,
    setup: string | undefined,
    runPrefix: string | undefined,
  ): { setup: string | undefined, runPrefix: string | undefined } {
    if (preservePaths.length > 0) {
      const checkout = buildCheckoutCommand(sha, preservePaths)
      return { setup: setup ? `${checkout} && ${setup}` : checkout, runPrefix }
    }
    return { setup, runPrefix }
  }

  // Run baseline benchmark first
  if (baselineConfig?.sha && (baselineConfig.setup || baselineConfig.runPrefix || benchmarkCommand || preservePaths.length > 0)) {
    const { setup, runPrefix } = withCheckout(baselineConfig.sha, baselineConfig.setup, baselineConfig.runPrefix)
    const cmd = buildBenchmarkShellCommand(setup, runPrefix, baselineConfig.sha, template)
    info(`Running baseline benchmark: ${cmd}`)
    await exec('bash', ['-c', cmd])
  }

  // Run contender benchmarks in parallel
  const contenderTasks = contenderConfigs
    .filter((c) => c.sha && (c.setup || c.runPrefix || benchmarkCommand || preservePaths.length > 0))
    .map(async (contender) => {
      const { setup, runPrefix } = withCheckout(contender.sha!, contender.setup, contender.runPrefix)
      const cmd = buildBenchmarkShellCommand(setup, runPrefix, contender.sha!, template)
      info(`Running benchmark for "${contender.label}": ${cmd}`)
      await exec('bash', ['-c', cmd])
    })

  if (contenderTasks.length > 0) {
    await Promise.all(contenderTasks)
  }
}

// Read pre-computed comparison text file
export function readComparisonTextFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Comparison text file not found: ${path}`)
  }
  info(`Using pre-computed comparison file: ${path}`)
  return readFileSync(path, 'utf-8')
}

// Step 5: Detect critical regression
export function detectRegression(
  parsed: ParsedComparison,
  threshold: number,
): boolean {
  return parsed.regressed.some((r) => r.ratioNum >= threshold)
}

export function interpretComparison(
  raw: string,
  threshold: number,
  opts: RenderOptions,
): { body: string, hasRegression: boolean } {
  const selected = selectComparison(raw, threshold)
  if (selected.kind === 'json') {
    return {
      body: renderCompareJsonComment(selected.doc, raw, opts),
      hasRegression: jsonCriticalRegression(selected.doc, threshold, opts.regressionOnVerdict === true),
    }
  }
  return {
    body: renderTwoWayComment(raw, opts),
    hasRegression: detectRegression(selected.parsed, threshold),
  }
}

/**
 * Run `asv compare --format json` when this asv advertises schema_version 1.
 * Returns null when the installed asv is older or the command fails, so the
 * caller can scrape the markdown table instead.
 */
export async function readAsvCompareJson(baseSha: string, prSha: string): Promise<string | null> {
  if (!baseSha || !prSha) {
    return null
  }
  let help
  try {
    help = await getExecOutput('asv', ['compare', '--help'], {
      silent: true,
      ignoreReturnCode: true,
    })
  } catch {
    info('asv compare is not available; using markdown output')
    return null
  }
  const helpText = `${help.stdout}\n${help.stderr}`
  if (help.exitCode !== 0 || !helpSupportsCompareJson(helpText)) {
    info('asv compare has no JSON format; using markdown output')
    return null
  }
  let result
  try {
    result = await getExecOutput('asv', ['compare', baseSha, prSha, '--format', 'json'], {
      silent: true,
      ignoreReturnCode: true,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warning(`asv compare --format json failed (${msg}); falling back to markdown`)
    return null
  }
  if (result.exitCode !== 0) {
    warning('asv compare --format json failed; falling back to markdown')
    return null
  }
  try {
    if (selectComparison(result.stdout).kind !== 'json') {
      warning('asv compare --format json did not return schema_version 1; falling back to markdown')
      return null
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warning(`${msg}; falling back to markdown`)
    return null
  }
  return result.stdout
}

/**
 * Run `asv compare --format latex` when this asv advertises it.
 * Returns null, after a notice, on asv 0.6.6 and on any failed compare.
 */
export async function readAsvCompareLatex(baseSha: string, prSha: string): Promise<string | null> {
  if (!baseSha || !prSha) {
    notice('latex-table skipped: base and head SHAs are required')
    return null
  }
  let help
  try {
    help = await getExecOutput('asv', ['compare', '--help'], {
      silent: true,
      ignoreReturnCode: true,
    })
  } catch {
    notice('latex-table skipped: asv compare is not available')
    return null
  }
  const helpText = `${help.stdout}\n${help.stderr}`
  if (help.exitCode !== 0 || !helpSupportsCompareLatex(helpText)) {
    notice('latex-table skipped: this asv compare has no --format=latex')
    return null
  }
  let result
  try {
    result = await getExecOutput('asv', ['compare', baseSha, prSha, '--format', 'latex'], {
      silent: true,
      ignoreReturnCode: true,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    notice(`latex-table skipped: asv compare --format latex failed (${msg})`)
    return null
  }
  if (result.exitCode !== 0 || !result.stdout.includes('\\begin{tabular}')) {
    notice('latex-table skipped: asv compare --format latex did not write a table')
    return null
  }
  return result.stdout
}

// Step 7: Find PR by SHA
export async function findPullRequest(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ number: number, nodeId: string } | null> {
  const { data: searchResults } = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} is:pr sha:${sha}`,
    per_page: 1,
  })

  if (searchResults.items.length < 1) {
    return null
  }

  return {
    number: searchResults.items[0].number,
    nodeId: searchResults.items[0].node_id,
  }
}

// Step 8: Post or update comment
export async function postOrUpdateComment(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  marker: string,
): Promise<number> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  })

  const existing = comments.find((c) => c.body?.includes(marker))

  if (existing) {
    info(`Updating existing comment: ${existing.id}`)
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    })
    return existing.id
  } else {
    info('Creating new comment')
    const { data: created } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    })
    return created.id
  }
}

// Step 9: Write to GITHUB_STEP_SUMMARY
export function writeSummary(body: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    appendFileSync(summaryPath, `${body}\n`)
    info('Written to GITHUB_STEP_SUMMARY')
  }
}

// Step 10: Convert PR to draft via GraphQL
export async function convertToDraft(
  octokit: ReturnType<typeof getOctokit>,
  nodeId: string,
  prNumber: number,
): Promise<void> {
  const mutation = `
    mutation($id: ID!) {
      convertPullRequestToDraft(input: {pullRequestId: $id}) {
        pullRequest {
          number
          isDraft
        }
      }
    }
  `
  await octokit.graphql(mutation, { id: nodeId })
  info(`PR #${prNumber} converted to draft due to critical regression`)
}

// Main orchestration
export async function run(): Promise<void> {
  try {
    // Step 1
    const inputs = resolveInputs()
    const octokit = inputs.token ? getOctokit(inputs.token) : null
    const { owner, repo } = context.repo

    // Execute benchmark commands if any configs have setup/runPrefix/sha or benchmark-command
    const hasRunnable = inputs.baselineConfig?.runPrefix || inputs.baselineConfig?.setup
      || inputs.contenderConfigs.some((c) => c.runPrefix || c.setup)
      || inputs.benchmarkCommand
      || inputs.preservePaths.length > 0
    if (hasRunnable && !inputs.comparisonTextFile) {
      await executeBenchmarks(
        inputs.baselineConfig,
        inputs.contenderConfigs,
        inputs.benchmarkCommand,
        inputs.initCommand || undefined,
        inputs.preservePaths,
      )
    }

    let rawOutput: string
    let commentBody: string
    let hasRegression = false
    // Result JSON paths for optional env-diff (pure TS; no spyglass needed)
    let envDiffBaseFile = ''
    let envDiffContenderFile = ''

    // Build contender metadata for render
    const contenderMeta = inputs.contenderConfigs.length > 0
      ? inputs.contenderConfigs.map((c) => ({
          label: c.label,
          env: c.env,
          description: c.description,
        }))
      : undefined

    if (inputs.comparisonTextFile) {
      // Direct comparison text file mode -- skip asv-spyglass entirely
      rawOutput = readComparisonTextFile(inputs.comparisonTextFile)
      setOutput('comparison', rawOutput)

      // Env-diff still works when explicit result files are also provided
      envDiffBaseFile = inputs.baseFile || inputs.baselineFile
      envDiffContenderFile = inputs.prFile || inputs.contenderFiles[0] || ''
      const envDiffSection = maybeBuildEnvDiffSection(
        inputs.envDiff,
        envDiffBaseFile,
        envDiffContenderFile,
      )

      if (inputs.comparisonMode === 'compare-many') {
        const parsed = parseCompareMany(rawOutput, inputs.regressionThreshold)
        hasRegression = parsed.summaryPerContender.some((s) => s.regressed > 0)
        commentBody = renderCompareManyComment(parsed, rawOutput, {
          baseSha: inputs.baselineSha || inputs.baseSha,
          prSha: '',
          runnerInfo: inputs.runnerInfo,
          dashboardUrl: inputs.dashboardUrl || undefined,
          commentMarker: inputs.commentMarker,
          regressionThreshold: inputs.regressionThreshold,
          regressionOnVerdict: inputs.regressionOnVerdict,
          contenderMeta,
          envDiffSection,
        })
      } else {
        const interpreted = interpretComparison(rawOutput, inputs.regressionThreshold, {
          baseSha: inputs.baseSha,
          prSha: inputs.prSha,
          runnerInfo: inputs.runnerInfo,
          dashboardUrl: inputs.dashboardUrl || undefined,
          commentMarker: inputs.commentMarker,
          regressionThreshold: inputs.regressionThreshold,
          regressionOnVerdict: inputs.regressionOnVerdict,
          envDiffSection,
        })
        hasRegression = interpreted.hasRegression
        commentBody = interpreted.body
      }
    } else if (inputs.comparisonMode === 'compare-many') {
      // compare-many mode: resolve files (direct paths or SHA-based lookup)
      let resolvedBaselineFile: string
      let resolvedContenderFiles: string[]

      if (inputs.baselineFile && inputs.contenderFiles.length > 0) {
        // Direct file paths provided -- no lookup needed
        resolvedBaselineFile = inputs.baselineFile
        resolvedContenderFiles = inputs.contenderFiles
        info(`Baseline result (direct): ${resolvedBaselineFile}`)
        for (const f of resolvedContenderFiles) {
          info(`Contender result (direct): ${f}`)
        }
      } else {
        // SHA-based lookup
        resolvedBaselineFile = await findResultFileByPrefix(inputs.resultsPath, inputs.baselineSha)
        info(`Baseline result: ${resolvedBaselineFile}`)
        resolvedContenderFiles = []
        for (const sha of inputs.contenderShas) {
          const f = await findResultFileByPrefix(inputs.resultsPath, sha)
          info(`Contender result (${sha.slice(0, 8)}): ${f}`)
          resolvedContenderFiles.push(f)
        }
      }

      envDiffBaseFile = resolvedBaselineFile
      envDiffContenderFile = resolvedContenderFiles[0] || ''

      rawOutput = await runCompareMany(
        resolvedBaselineFile,
        resolvedContenderFiles,
        inputs.resultsPath,
        inputs.asvSpyglassRef,
        inputs.asvSpyglassArgs,
        inputs.baselineLabel,
        inputs.contenderLabels,
      )
      setOutput('comparison', rawOutput)

      const envDiffSection = maybeBuildEnvDiffSection(
        inputs.envDiff,
        envDiffBaseFile,
        envDiffContenderFile,
      )

      const parsed = parseCompareMany(rawOutput, inputs.regressionThreshold)
      hasRegression = parsed.summaryPerContender.some((s) => s.regressed > 0)
      commentBody = renderCompareManyComment(parsed, rawOutput, {
        baseSha: inputs.baselineSha,
        prSha: '',
        runnerInfo: inputs.runnerInfo,
        dashboardUrl: inputs.dashboardUrl || undefined,
        commentMarker: inputs.commentMarker,
        regressionThreshold: inputs.regressionThreshold,
        regressionOnVerdict: inputs.regressionOnVerdict,
        contenderMeta,
        envDiffSection,
      })
    } else {
      // Prefer asv compare JSON when this asv knows schema_version 1.
      // Older asv falls through to the markdown table.
      const jsonOutput = await readAsvCompareJson(inputs.baseSha, inputs.prSha)
      let envDiffSection: string | undefined
      if (jsonOutput) {
        info('Using asv compare --format json')
        rawOutput = jsonOutput
        if (inputs.envDiff && ((inputs.baseFile && inputs.prFile) || inputs.resultsPath)) {
          try {
            const files = (inputs.baseFile && inputs.prFile)
              ? { baseFile: inputs.baseFile, prFile: inputs.prFile }
              : await findResultFiles(inputs.resultsPath, inputs.baseSha, inputs.prSha)
            envDiffBaseFile = files.baseFile
            envDiffContenderFile = files.prFile
            envDiffSection = maybeBuildEnvDiffSection(
              inputs.envDiff,
              envDiffBaseFile,
              envDiffContenderFile,
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            warning(`env-diff skipped: ${msg}`)
          }
        }
      } else {
        let resolvedBaseFile: string
        let resolvedPrFile: string

        if (inputs.baseFile && inputs.prFile) {
          resolvedBaseFile = inputs.baseFile
          resolvedPrFile = inputs.prFile
          info(`Base result (direct): ${resolvedBaseFile}`)
          info(`PR result (direct): ${resolvedPrFile}`)
        } else {
          const found = await findResultFiles(
            inputs.resultsPath,
            inputs.baseSha,
            inputs.prSha,
          )
          resolvedBaseFile = found.baseFile
          resolvedPrFile = found.prFile
        }

        envDiffBaseFile = resolvedBaseFile
        envDiffContenderFile = resolvedPrFile

        rawOutput = await runComparison(
          resolvedBaseFile,
          resolvedPrFile,
          inputs.resultsPath,
          inputs.labelBefore,
          inputs.labelAfter,
          inputs.asvSpyglassRef,
          inputs.asvSpyglassArgs,
        )
        envDiffSection = maybeBuildEnvDiffSection(
          inputs.envDiff,
          envDiffBaseFile,
          envDiffContenderFile,
        )
      }
      setOutput('comparison', rawOutput)

      const interpreted = interpretComparison(rawOutput, inputs.regressionThreshold, {
        baseSha: inputs.baseSha,
        prSha: inputs.prSha,
        runnerInfo: inputs.runnerInfo,
        dashboardUrl: inputs.dashboardUrl || undefined,
        commentMarker: inputs.commentMarker,
        regressionThreshold: inputs.regressionThreshold,
        regressionOnVerdict: inputs.regressionOnVerdict,
        envDiffSection,
      })
      hasRegression = interpreted.hasRegression
      commentBody = interpreted.body
    }

    setOutput('regression-detected', hasRegression.toString())

    if (inputs.latexTable) {
      const tex = await readAsvCompareLatex(inputs.baseSha, inputs.prSha)
      if (tex) {
        writeCommentBodyFile(inputs.latexTablePath, tex)
        setOutput('latex-table-path', inputs.latexTablePath)
        info(
          `latex-table: wrote ${inputs.latexTablePath}. `
          + 'Upload that path with actions/upload-artifact.',
        )
      } else {
        setOutput('latex-table-path', '')
      }
    } else {
      setOutput('latex-table-path', '')
    }

    // Always write job summary when possible
    writeSummary(commentBody)

    // Token-less path: prepare markdown for a follow-up actions/upload-artifact step
    // (keeps the action bundle small; no @actions/artifact dependency)
    if (inputs.uploadCommentArtifact) {
      writeCommentBodyFile(inputs.commentArtifactPath, commentBody)
      setOutput('comment-body-path', inputs.commentArtifactPath)
      setOutput('comment-artifact-name', inputs.commentArtifactName)
      info(
        `upload-comment-artifact: wrote ${inputs.commentArtifactPath}. `
        + `Add actions/upload-artifact with name "${inputs.commentArtifactName}" `
        + 'and that path (or use comment-body-path output).',
      )
    } else {
      setOutput('comment-body-path', '')
      setOutput('comment-artifact-name', '')
    }

    // Skip PR API work when not posting and not auto-drafting
    if (!inputs.postComment && !inputs.autoDraftOnRegression) {
      info('post-comment=false: skipping PR comment API')
      setOutput('comment-id', '')
      setOutput('pr-number', '')
      return
    }

    if (!octokit) {
      warning('No github-token: cannot post PR comment or convert to draft')
      setOutput('comment-id', '')
      setOutput('pr-number', '')
      return
    }

    // Find PR -- use prSha first, fall back to baselineSha for compare-many
    const searchSha = inputs.prSha || inputs.baselineSha || inputs.baseSha
    const pr = searchSha ? await findPullRequest(octokit, owner, repo, searchSha) : null

    if (!pr) {
      warning(`No PR found for SHA ${searchSha || '(none)'}. Summary/artifact only.`)
      setOutput('comment-id', '')
      setOutput('pr-number', '')
      return
    }

    info(`Targeting PR #${pr.number}`)
    setOutput('pr-number', pr.number.toString())

    if (inputs.postComment) {
      const commentId = await postOrUpdateComment(
        octokit,
        owner,
        repo,
        pr.number,
        commentBody,
        inputs.commentMarker,
      )
      setOutput('comment-id', commentId.toString())
    } else {
      setOutput('comment-id', '')
    }

    // Convert to draft on regression
    if (hasRegression && inputs.autoDraftOnRegression) {
      await convertToDraft(octokit, pr.nodeId, pr.number)
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    } else {
      setFailed(String(error))
    }
  }
}
