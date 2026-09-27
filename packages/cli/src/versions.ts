import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DependencyRequirement } from './registry.js'
import { compareVersions, minimumOfRange, parseVersion } from './semver.js'

/**
 * `llui add`'s pre-flight: is every `@llui/*` package the resolved items need
 * at least as new as the version they were built against?
 *
 * The project's version of a package is read, in order, from:
 *
 * 1. the INSTALLED package — `node_modules/<pkg>/package.json`, found by
 *    Node's own lookup (the project directory, then each ancestor), so a
 *    workspace that hoists to its root is read correctly. This is what the
 *    copied source will actually import, so it wins over any declaration.
 * 2. the project's `package.json` range (`dependencies`, `devDependencies`,
 *    `optionalDependencies`, `peerDependencies`), when nothing is installed
 *    yet. A range is compared by its MINIMUM SATISFYING version (`^0.19.2` ->
 *    0.19.2): that is the version a fresh install is allowed to resolve, so it
 *    is the most the project can promise. A range with no determinable floor
 *    (`latest`, `*`, a git or file spec) is reported as unverified — a
 *    warning, never a failure, because refusing on a guess would block a
 *    legitimate setup.
 * 3. otherwise the package is missing: nothing to compare, and the install hint
 *    carries the minimum (`@llui/components@^0.20.1`).
 */

/** Where a project's version of a package came from. */
export type ProjectVersion =
  | { kind: 'installed'; version: string; packageJson: string }
  | { kind: 'declared'; range: string; version: string | null }
  | { kind: 'missing' }

export type VersionStatus = 'ok' | 'older' | 'missing' | 'unverified'

export interface VersionCheck {
  name: string
  minimum: string
  requiredBy: string[]
  project: ProjectVersion
  status: VersionStatus
}

/** A package the project has, older than the items need. */
export interface VersionMismatch {
  name: string
  /** The version compared: installed, or the declared range's floor. */
  installed: string
  minimum: string
  requiredBy: string[]
  /** Set when `installed` is a `package.json` range's floor, not an installed package. */
  declared?: string
}

/**
 * Thrown by `add()` BEFORE anything is written when an installed `@llui/*`
 * package is older than an item needs. `--force` turns it into a warning.
 */
export class VersionMismatchError extends Error {
  readonly mismatches: VersionMismatch[]
  readonly upgradeCommand: string

  constructor(mismatches: VersionMismatch[], upgradeCommand: string) {
    super(
      formatMismatches(mismatches, upgradeCommand) +
        '\nNothing was written. Pass --force to copy the files anyway.',
    )
    this.name = 'VersionMismatchError'
    this.mismatches = mismatches
    this.upgradeCommand = upgradeCommand
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function ancestors(dir: string): string[] {
  const out: string[] = []
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    out.push(d)
    if (path.dirname(d) === d) return out
  }
}

/**
 * The installed `name` visible from `fromDir`, walking up the `node_modules`
 * chain the way Node resolves a bare import. Reads `package.json` directly
 * rather than `require.resolve`-ing it: a package's `exports` map may not
 * expose `./package.json`.
 */
export async function findInstalled(
  fromDir: string,
  name: string,
): Promise<{ version: string; packageJson: string } | null> {
  for (const dir of ancestors(fromDir)) {
    if (path.basename(dir) === 'node_modules') continue
    const packageJson = path.join(dir, 'node_modules', ...name.split('/'), 'package.json')
    const pkg = await readJson(packageJson)
    if (pkg === null) continue
    const version = field(pkg, 'version')
    return { version: typeof version === 'string' ? version : '', packageJson }
  }
  return null
}

const DECLARATION_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

/** The project's version of `name`: installed, declared, or missing (see the module doc). */
export async function projectVersion(cwd: string, name: string): Promise<ProjectVersion> {
  const installed = await findInstalled(cwd, name)
  if (installed !== null) return { kind: 'installed', ...installed }
  const pkg = await readJson(path.join(cwd, 'package.json'))
  for (const key of DECLARATION_FIELDS) {
    const range = field(field(pkg, key), name)
    if (typeof range === 'string')
      return { kind: 'declared', range, version: minimumOfRange(range) }
  }
  return { kind: 'missing' }
}

/** Compare every requirement that carries a minimum against the project. */
export async function checkVersions(
  cwd: string,
  requirements: readonly DependencyRequirement[],
): Promise<VersionCheck[]> {
  const out: VersionCheck[] = []
  for (const req of requirements) {
    if (req.minimum === null) continue
    const project = await projectVersion(cwd, req.name)
    const compared =
      project.kind === 'installed'
        ? parseVersion(project.version) === null
          ? null
          : project.version
        : project.kind === 'declared'
          ? project.version
          : undefined
    const status: VersionStatus =
      compared === undefined
        ? 'missing'
        : compared === null
          ? 'unverified'
          : compareVersions(compared, req.minimum) < 0
            ? 'older'
            : 'ok'
    out.push({ name: req.name, minimum: req.minimum, requiredBy: req.requiredBy, project, status })
  }
  return out
}

/** The `older` checks, as mismatches. */
export function mismatchesOf(checks: readonly VersionCheck[]): VersionMismatch[] {
  const out: VersionMismatch[] = []
  for (const c of checks) {
    if (c.status !== 'older') continue
    const { project } = c
    if (project.kind === 'installed') {
      out.push({
        name: c.name,
        installed: project.version,
        minimum: c.minimum,
        requiredBy: c.requiredBy,
      })
    } else if (project.kind === 'declared' && project.version !== null) {
      out.push({
        name: c.name,
        installed: project.version,
        minimum: c.minimum,
        requiredBy: c.requiredBy,
        declared: project.range,
      })
    }
  }
  return out
}

const LOCKFILES: readonly [file: string, command: string][] = [
  ['pnpm-lock.yaml', 'pnpm add'],
  ['yarn.lock', 'yarn add'],
  ['bun.lock', 'bun add'],
  ['bun.lockb', 'bun add'],
  ['package-lock.json', 'npm install'],
]

/**
 * The install command of the package manager this project uses, judged by the
 * nearest lockfile (a workspace keeps it at its root). `npm install` when
 * there is none.
 */
export async function installCommand(cwd: string): Promise<string> {
  for (const dir of ancestors(cwd)) {
    for (const [file, command] of LOCKFILES) {
      try {
        await access(path.join(dir, file))
        return command
      } catch {
        // not here — keep looking
      }
    }
  }
  return 'npm install'
}

export function upgradeCommandFor(command: string, mismatches: readonly VersionMismatch[]): string {
  return `${command} ${mismatches.map((m) => `${m.name}@^${m.minimum}`).join(' ')}`
}

/** The human-readable mismatch report: one line per package, then the upgrade command. */
export function formatMismatches(
  mismatches: readonly VersionMismatch[],
  upgradeCommand: string,
): string {
  const lines = mismatches.map((m) => {
    const have =
      m.declared === undefined
        ? `installed ${m.installed}`
        : `package.json declares ${m.declared} (as low as ${m.installed})`
    return `  ${m.name}: ${have}, requires >= ${m.minimum} (${m.requiredBy.join(', ')})`
  })
  return [
    'These registry items need newer @llui packages than this project has:',
    ...lines,
    `Upgrade: ${upgradeCommand}`,
  ].join('\n')
}

/** Warnings for requirements whose project version could not be determined. */
export function formatUnverified(checks: readonly VersionCheck[]): string[] {
  return checks.flatMap((c) => {
    if (c.status !== 'unverified') return []
    const what =
      c.project.kind === 'declared'
        ? `package.json declares ${JSON.stringify(c.project.range)}`
        : c.project.kind === 'installed'
          ? `${c.project.packageJson} has version ${JSON.stringify(c.project.version)}`
          : 'it is not installed'
    return [
      `Could not determine the version of ${c.name} (${what}); ` +
        `${c.requiredBy.join(', ')} require >= ${c.minimum}.`,
    ]
  })
}
