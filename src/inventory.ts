/**
 * Environment inventory extraction and SBOM-style diffs from ASV result JSON.
 *
 * Mirrors asv_spyglass inventory.py + sbom_diff.py so the Action can attach
 * env diffs without installing Python spyglass for this feature.
 */

import { readFileSync } from 'node:fs'

export type ComponentKind = 'library' | 'runtime' | 'machine' | 'env' | string

export type InventoryChangeKind = 'unchanged' | 'added' | 'removed' | 'version-bumped'

export interface Component {
  name: string
  version: string
  kind: ComponentKind
  purl?: string
}

export interface EnvInventory {
  machine: string
  envName: string
  python: string
  commitHash: string
  sourcePath: string
  components: Component[]
}

export interface ComponentChange {
  name: string
  kind: InventoryChangeKind
  baselineVersion: string | null
  solvedVersion: string | null
  componentKind: ComponentKind
}

export interface InventoryDiffSummary {
  unchanged: number
  added: number
  removed: number
  versionBumped: number
}

/** Normalize ASV version fields (null, list, string) to a plain string. */
export function normVersion(v: unknown): string {
  if (v === null || v === undefined) {
    return ''
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      return ''
    }
    return normVersion(v[0])
  }
  return String(v).trim()
}

function componentKey(name: string): string {
  return name.toLowerCase()
}

/**
 * Build an environment inventory from a raw ASV result JSON object.
 * Reads requirements, python, params (and env_name / commit_hash / machine).
 */
export function inventoryFromResult(
  data: Record<string, unknown>,
  sourcePath = '',
): EnvInventory {
  const paramsRaw = data.params
  const params: Record<string, unknown>
    = paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
      ? paramsRaw as Record<string, unknown>
      : {}

  const machine = String(params.machine ?? '')
  const envName = String(data.env_name ?? '')
  // Prefer top-level python, then params.python; normalize lists/nulls
  const python = normVersion(data.python ?? params.python ?? '')
  const commitHash = String(data.commit_hash ?? '')

  const components: Component[] = []

  if (python) {
    components.push({
      name: 'python',
      version: python,
      kind: 'runtime',
      purl: `pkg:generic/python@${python}`,
    })
  }

  const reqsRaw = data.requirements
  const reqs: Record<string, unknown>
    = reqsRaw && typeof reqsRaw === 'object' && !Array.isArray(reqsRaw)
      ? reqsRaw as Record<string, unknown>
      : {}

  const reqNames = Object.keys(reqs).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  for (const name of reqNames) {
    let identity = String(name)
    if (identity.startsWith('pip+')) {
      identity = identity.slice(4)
    }
    let version = normVersion(reqs[name])
    if (!version && identity in params) {
      version = normVersion(params[identity])
    }
    components.push({
      name: identity,
      version,
      kind: 'library',
      purl: version ? `pkg:pypi/${identity}@${version}` : `pkg:pypi/${identity}`,
    })
  }

  for (const key of ['arch', 'cpu', 'os', 'num_cpu', 'ram'] as const) {
    if (key in params && params[key] !== null && params[key] !== undefined && params[key] !== '') {
      components.push({
        name: `machine.${key}`,
        version: String(params[key]),
        kind: 'machine',
      })
    }
  }

  if (envName) {
    components.push({
      name: 'asv.env_name',
      version: envName,
      kind: 'env',
    })
  }

  components.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind.localeCompare(b.kind)
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return {
    machine,
    envName,
    python,
    commitHash,
    sourcePath,
    components,
  }
}

/** Load inventory from an ASV result JSON file path. */
export function inventoryFromResultPath(path: string): EnvInventory {
  const raw = readFileSync(path, 'utf-8')
  const data = JSON.parse(raw) as Record<string, unknown>
  return inventoryFromResult(data, path)
}

/**
 * Classify every component name between baseline and solved inventories.
 * Default kinds: library + runtime (package/runtime surface).
 * Pass kinds = null to include all kinds.
 */
export function classifyInventoryDiff(
  baseline: EnvInventory,
  solved: EnvInventory,
  kinds: Iterable<string> | null = ['library', 'runtime'],
): ComponentChange[] {
  const allow = kinds === null ? null : new Set([...kinds].map((k) => k.toLowerCase()))

  const baseBy = new Map<string, Component>()
  for (const c of baseline.components) {
    if (allow === null || allow.has(c.kind.toLowerCase())) {
      baseBy.set(componentKey(c.name), c)
    }
  }
  const solBy = new Map<string, Component>()
  for (const c of solved.components) {
    if (allow === null || allow.has(c.kind.toLowerCase())) {
      solBy.set(componentKey(c.name), c)
    }
  }

  const names = [...new Set([...baseBy.keys(), ...solBy.keys()])].sort()
  const out: ComponentChange[] = []

  for (const name of names) {
    const b = baseBy.get(name)
    const s = solBy.get(name)
    if (!b && s) {
      out.push({
        name: s.name,
        kind: 'added',
        baselineVersion: null,
        solvedVersion: s.version || '',
        componentKind: s.kind,
      })
    } else if (b && !s) {
      out.push({
        name: b.name,
        kind: 'removed',
        baselineVersion: b.version || '',
        solvedVersion: null,
        componentKind: b.kind,
      })
    } else if (b && s) {
      const kind: InventoryChangeKind
        = (b.version || '') === (s.version || '') ? 'unchanged' : 'version-bumped'
      out.push({
        name: b.name,
        kind,
        baselineVersion: b.version || '',
        solvedVersion: s.version || '',
        componentKind: b.kind,
      })
    }
  }

  return out
}

export function summarizeDiff(changes: ComponentChange[]): InventoryDiffSummary {
  const summary: InventoryDiffSummary = {
    unchanged: 0,
    added: 0,
    removed: 0,
    versionBumped: 0,
  }
  for (const c of changes) {
    if (c.kind === 'unchanged') {
      summary.unchanged++
    } else if (c.kind === 'added') {
      summary.added++
    } else if (c.kind === 'removed') {
      summary.removed++
    } else if (c.kind === 'version-bumped') {
      summary.versionBumped++
    }
  }
  return summary
}

function envLabel(inv: EnvInventory): string {
  return inv.machine ? `${inv.machine}/${inv.envName}` : inv.envName
}

/**
 * Short markdown section for PR comments ("## Environment inventory").
 * Only-changed table by default; summary always includes full counts.
 */
export function renderInventorySection(
  baseline: EnvInventory,
  solved: EnvInventory,
  options: {
    kinds?: Iterable<string> | null
    onlyChanged?: boolean
  } = {},
): string {
  const kinds = options.kinds === undefined ? ['library', 'runtime'] : options.kinds
  const onlyChanged = options.onlyChanged !== false

  const allChanges = classifyInventoryDiff(baseline, solved, kinds)
  const summary = summarizeDiff(allChanges)
  const tableChanges = onlyChanged
    ? allChanges.filter((c) => c.kind !== 'unchanged')
    : allChanges

  const lines: string[] = []
  lines.push('## Environment inventory')
  lines.push('')
  lines.push(
    `Baseline (\`${envLabel(baseline)}\`) → contender (\`${envLabel(solved)}\`).`,
  )
  if (baseline.commitHash || solved.commitHash) {
    const b = baseline.commitHash ? baseline.commitHash.slice(0, 12) : ' - '
    const s = solved.commitHash ? solved.commitHash.slice(0, 12) : ' - '
    lines.push(`Commits: \`${b}\` → \`${s}\`.`)
  }
  lines.push('')
  lines.push(
    `**Summary:** ${summary.added} added, ${summary.removed} removed, `
    + `${summary.versionBumped} version-bumped, ${summary.unchanged} unchanged`,
  )
  lines.push('')

  if (tableChanges.length === 0) {
    lines.push('_No component changes under the current filter._')
    return lines.join('\n')
  }

  lines.push('| Status | Component | Baseline | Contender | Kind |')
  lines.push('|--------|-----------|----------|-----------|------|')
  for (const c of tableChanges) {
    let bv = c.baselineVersion === null ? ' - ' : c.baselineVersion
    let sv = c.solvedVersion === null ? ' - ' : c.solvedVersion
    if (bv === '') {
      bv = '(empty)'
    }
    if (sv === '') {
      sv = '(empty)'
    }
    lines.push(
      `| ${c.kind} | \`${c.name}\` | \`${bv}\` | \`${sv}\` | ${c.componentKind} |`,
    )
  }

  return lines.join('\n')
}

/**
 * Diff two result file paths and return the comment section markdown.
 * Returns empty string on parse failure (caller may log a warning).
 */
export function envDiffSectionFromPaths(
  baselinePath: string,
  contenderPath: string,
  options?: {
    kinds?: Iterable<string> | null
    onlyChanged?: boolean
  },
): string {
  const baseline = inventoryFromResultPath(baselinePath)
  const contender = inventoryFromResultPath(contenderPath)
  return renderInventorySection(baseline, contender, options)
}
