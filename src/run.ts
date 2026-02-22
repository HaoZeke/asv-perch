import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { getInput, info, setFailed, setOutput, warning } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { context, getOctokit } from '@actions/github'
import { create as createGlob } from '@actions/glob'
import yaml from 'js-yaml'
import { parseCompareMany, parseComparison } from './parse'
import { renderComment, renderCompareManyComment } from './render'

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
  autoDraftOnRegression: boolean
  commentMarker: string
  labelBefore: string
  labelAfter: string
  asvSpyglassRef: string
  runnerInfo: string
  dashboardUrl: string
}

// Step 1: Resolve inputs
export function resolveInputs(): ResolvedInputs {
  const token = getInput('github-token', { required: true })
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

  const baseFileInput = getInput('base-file') || ''
  const prFileInput = getInput('pr-file') || ''
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

  // SHAs or direct files required unless comparison-text-file or structured configs provided
  if (!comparisonTextFile && comparisonMode === 'compare') {
    const hasFiles = baseFileInput && prFileInput
    const hasShas = baseSha && prSha
    if (!hasFiles && !hasShas) {
      throw new Error('base-sha/pr-sha (or base-file/pr-file) are required unless comparison-text-file is provided')
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
    autoDraftOnRegression: getInput('auto-draft-on-regression') === 'true',
    commentMarker: getInput('comment-marker') || '<!-- asv-benchmark-result -->',
    labelBefore: getInput('label-before') || 'main',
    labelAfter: getInput('label-after') || 'pr',
    asvSpyglassRef: getInput('asv-spyglass-ref') || 'enh-multiple-comparisons',
    runnerInfo: getInput('runner-info') || 'ubuntu-latest',
    dashboardUrl: getInput('dashboard-url') || '',
  }
}

// Step 2: Find result files by SHA prefix
export async function findResultFiles(
  resultsPath: string,
  baseSha: string,
  prSha: string,
): Promise<{ baseFile: string, prFile: string }> {
  const basePrefix = baseSha.slice(0, 8)
  const prPrefix = prSha.slice(0, 8)

  const globber = await createGlob(`${resultsPath}/**/*.json`)
  const allFiles = await globber.glob()

  let baseFile = ''
  let prFile = ''

  for (const f of allFiles) {
    const basename = f.split('/').pop() || ''
    if (basename.startsWith(basePrefix)) {
      baseFile = f
    }
    if (basename.startsWith(prPrefix)) {
      prFile = f
    }
  }

  if (!baseFile) {
    throw new Error(`No result file found for base SHA prefix ${basePrefix} in ${resultsPath}`)
  }
  if (!prFile) {
    throw new Error(`No result file found for PR SHA prefix ${prPrefix} in ${resultsPath}`)
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

  // Find benchmarks.json for asv-spyglass
  const benchGlobber = await createGlob(`${resultsPath}/**/benchmarks.json`)
  const benchFiles = await benchGlobber.glob()
  const benchmarksArg = benchFiles.length > 0
    ? ['--benchmarks-path', benchFiles[0]]
    : []

  const spyglassUrl = `git+https://github.com/HaoZeke/asv_spyglass.git@${asvSpyglassRef}`

  info(`Running: uvx --from "${spyglassUrl}" asv-spyglass compare`)
  const result = await getExecOutput(
    'uvx',
    [
      '--from', spyglassUrl,
      'asv-spyglass', 'compare',
      baseFile,
      prFile,
      ...benchmarksArg,
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
  const prefix = sha.slice(0, 8)
  const globber = await createGlob(`${resultsPath}/**/*.json`)
  const allFiles = await globber.glob()

  for (const f of allFiles) {
    const basename = f.split('/').pop() || ''
    if (basename.startsWith(prefix)) {
      return f
    }
  }

  throw new Error(`No result file found for SHA prefix ${prefix} in ${resultsPath}`)
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
  // Find benchmarks.json for asv-spyglass
  const benchGlobber = await createGlob(`${resultsPath}/**/benchmarks.json`)
  const benchFiles = await benchGlobber.glob()
  const benchmarksArg = benchFiles.length > 0
    ? ['--benchmarks-path', benchFiles[0]]
    : []

  // Build label arguments
  const labelArgs: string[] = []
  if (baselineLabel) {
    labelArgs.push('--label-baseline', baselineLabel)
  }
  if (contenderLabels && contenderLabels.length > 0) {
    for (const label of contenderLabels) {
      labelArgs.push('--label-contender', label)
    }
  }

  const spyglassUrl = `git+https://github.com/HaoZeke/asv_spyglass.git@${asvSpyglassRef}`

  info(`Running: uvx --from "${spyglassUrl}" asv-spyglass compare-many`)
  const result = await getExecOutput(
    'uvx',
    [
      '--from', spyglassUrl,
      'asv-spyglass', 'compare-many',
      baselineFile,
      ...contenderFiles,
      ...benchmarksArg,
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
    return `cp -r ${stashDir}/${basename} ${p}`
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
  parsed: ReturnType<typeof parseComparison>,
  threshold: number,
): boolean {
  return parsed.regressed.some((r) => r.ratioNum >= threshold)
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
    const octokit = getOctokit(inputs.token)
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

      if (inputs.comparisonMode === 'compare-many') {
        const parsed = parseCompareMany(rawOutput)
        hasRegression = parsed.summaryPerContender.some((s) => s.regressed > 0)
        commentBody = renderCompareManyComment(parsed, rawOutput, {
          baseSha: inputs.baselineSha || inputs.baseSha,
          prSha: '',
          runnerInfo: inputs.runnerInfo,
          dashboardUrl: inputs.dashboardUrl || undefined,
          commentMarker: inputs.commentMarker,
          regressionThreshold: inputs.regressionThreshold,
          contenderMeta,
        })
      } else {
        const parsed = parseComparison(rawOutput)
        hasRegression = detectRegression(parsed, inputs.regressionThreshold)
        commentBody = renderComment(parsed, rawOutput, {
          baseSha: inputs.baseSha,
          prSha: inputs.prSha,
          runnerInfo: inputs.runnerInfo,
          dashboardUrl: inputs.dashboardUrl || undefined,
          commentMarker: inputs.commentMarker,
          regressionThreshold: inputs.regressionThreshold,
        })
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

      const parsed = parseCompareMany(rawOutput)
      hasRegression = parsed.summaryPerContender.some((s) => s.regressed > 0)
      commentBody = renderCompareManyComment(parsed, rawOutput, {
        baseSha: inputs.baselineSha,
        prSha: '',
        runnerInfo: inputs.runnerInfo,
        dashboardUrl: inputs.dashboardUrl || undefined,
        commentMarker: inputs.commentMarker,
        regressionThreshold: inputs.regressionThreshold,
        contenderMeta,
      })
    } else {
      // Standard compare mode: resolve files (direct paths or SHA-based lookup)
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

      rawOutput = await runComparison(
        resolvedBaseFile,
        resolvedPrFile,
        inputs.resultsPath,
        inputs.labelBefore,
        inputs.labelAfter,
        inputs.asvSpyglassRef,
        inputs.asvSpyglassArgs,
      )
      setOutput('comparison', rawOutput)

      const parsed = parseComparison(rawOutput)
      hasRegression = detectRegression(parsed, inputs.regressionThreshold)
      commentBody = renderComment(parsed, rawOutput, {
        baseSha: inputs.baseSha,
        prSha: inputs.prSha,
        runnerInfo: inputs.runnerInfo,
        dashboardUrl: inputs.dashboardUrl || undefined,
        commentMarker: inputs.commentMarker,
        regressionThreshold: inputs.regressionThreshold,
      })
    }

    setOutput('regression-detected', hasRegression.toString())

    // Find PR -- use prSha first, fall back to baselineSha for compare-many
    const searchSha = inputs.prSha || inputs.baselineSha || inputs.baseSha
    const pr = searchSha ? await findPullRequest(octokit, owner, repo, searchSha) : null

    if (!pr) {
      warning(`No PR found for SHA ${searchSha || '(none)'}. Writing summary only.`)
      writeSummary(commentBody)
      setOutput('comment-id', '')
      setOutput('pr-number', '')
      return
    }

    info(`Targeting PR #${pr.number}`)
    setOutput('pr-number', pr.number.toString())

    // Post/update comment
    const commentId = await postOrUpdateComment(
      octokit,
      owner,
      repo,
      pr.number,
      commentBody,
      inputs.commentMarker,
    )
    setOutput('comment-id', commentId.toString())

    // Write summary
    writeSummary(commentBody)

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
