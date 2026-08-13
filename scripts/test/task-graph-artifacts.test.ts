import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Repo-wide guard: a test task that runs its OWN package's build output must
 * declare `build`, not only `^build` (#97).
 *
 * `^build` means DEPENDENCIES' builds — it never builds the package it belongs
 * to. `@llui/mcp`'s suite spawns `packages/mcp/dist/cli.js`, so on a fresh
 * worktree or a clean CI checkout the artifact simply is not there. The spawn
 * still succeeds and produces nothing, so the failure surfaces as
 * `expected '' to contain …` rather than a missing-file error — and it is
 * INVISIBLE in a long-lived checkout where some earlier build left a `dist/`
 * behind. That signature was misattributed to test flakiness twice.
 *
 * The gate is the task graph, not the test: a suite that needs an artifact
 * should say so where the build order is decided.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packagesDir = join(repoRoot, 'packages')

/** The task names whose `dependsOn` this gate checks, in root `turbo.json`. */
const TEST_TASKS = ['test', 'test:coverage'] as const

/** A test file reaching one directory up into `dist/` is resolving its own
 *  package's build output — `__dirname` inside `<pkg>/test` makes `../dist/`
 *  exactly that. Over-approximating costs one redundant task edge; missing a
 *  case costs an empty-output failure nobody can read. */
const OWN_DIST = '../dist/'

interface TurboTask {
  dependsOn?: string[]
}

interface TurboConfig {
  tasks?: Record<string, TurboTask>
}

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out
}

/** The `dependsOn` turbo resolves for `<pkg>`'s `task`: a package-level
 *  `turbo.json` overrides the root definition for that package. */
function effectiveDependsOn(pkgDir: string, task: string): string[] {
  const local = join(pkgDir, 'turbo.json')
  if (existsSync(local)) {
    const override = readJson<TurboConfig>(local).tasks?.[task]
    if (override !== undefined) return override.dependsOn ?? []
  }
  return readJson<TurboConfig>(join(repoRoot, 'turbo.json')).tasks?.[task]?.dependsOn ?? []
}

interface Offender {
  pkg: string
  task: string
  file: string
}

function packagesRunningOwnBuildOutput(): Offender[] {
  const offenders: Offender[] = []
  for (const entry of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, entry)
    const manifest = join(pkgDir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = readJson<PackageJson>(manifest)
    const users = filesUnder(join(pkgDir, 'test')).filter(
      (file) => file.endsWith('.ts') && readFileSync(file, 'utf8').includes(OWN_DIST),
    )
    if (users.length === 0) continue
    for (const task of TEST_TASKS) {
      if (pkg.scripts?.[task] === undefined) continue
      if (effectiveDependsOn(pkgDir, task).includes('build')) continue
      offenders.push({
        pkg: pkg.name ?? entry,
        task,
        file: relative(repoRoot, users[0]!),
      })
    }
  }
  return offenders
}

describe('test tasks declare the build they run (#97)', () => {
  it('finds the suites that execute their own dist/', () => {
    // A broken scan would make the assertion below vacuous. `@llui/mcp` spawns
    // its CLI from `dist/`, which is what made this class of defect visible.
    const files = filesUnder(join(packagesDir, 'mcp', 'test')).filter((file) =>
      readFileSync(file, 'utf8').includes(OWN_DIST),
    )
    expect(files.length).toBeGreaterThan(0)
  })

  it('declares `build` (not only `^build`) wherever a suite runs its own dist/', () => {
    expect(packagesRunningOwnBuildOutput()).toEqual([])
  })
})
