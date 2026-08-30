import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every workspace package's own source directories are LINTED (#259).
 *
 * `pnpm turbo lint` runs the `lint` task PER WORKSPACE PACKAGE, and each package
 * names its own targets. Before #259, 25 of the 28 packages that had a `lint`
 * script named `src` ALONE — and all 25 had a `test/` directory — so 654 files
 * were linted by nothing while `turbo lint` reported green over them by never
 * looking. `registry` was a third shape (`eslint llui`, missing its own `test`),
 * `packages/vike/test-types` and `site/pages` were two more directories in the
 * same position, and the 12 `examples/*` apps plus the 6 benchmark apps had no
 * `lint` script at all. That is 46 workspace members, of which 18 were linted in
 * full, 28 in part or not at all.
 *
 * This is #252/#256's shape one level in: there the ROOT was not a workspace
 * member so nothing reached `scripts/`; here the packages ARE members and simply
 * do not name the directories. Both fail the same way — green by omission, with
 * no error to attribute it to.
 *
 * The invariant is TOTAL and has no exemption list, deliberately. Every gap above
 * was measured before it was closed (38 errors across the packages' `test/`, 7
 * across `examples/`, 0 in `site/pages`, `vike/test-types` and all six benchmark
 * apps), and an allowlist of 18 "not linted for now" entries would have been the
 * thing that rots — the repo's own registry/dist guards are explicit that an
 * allowlist is reviewed like an allowlist, not like configuration. If a package
 * genuinely must not lint a directory, that decision belongs in `eslint.config.ts`
 * as an `ignores` entry, where it is one fact in one place, rather than as a
 * silently missing word in one of 46 package.json files.
 *
 * Three separable parts, because each can fail alone:
 *
 *   SELECTION  — every workspace member with tracked TS source has a `lint` script.
 *   COVERAGE   — that script's targets include every directory holding that source.
 *   INVOCATION — a root script, `verify`, and an un-neutered CI step actually run it.
 *
 * Enumeration is `git ls-files`, never a filesystem walk: `.claude/worktrees/` is
 * gitignored and holds a FULL CHECKOUT of every sibling lane, so a walk from the
 * repo root would collect every other branch's packages as if they were this one's.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Extensions ESLint is configured to lint in this repo. */
const LINTED_EXTENSIONS = /\.(ts|tsx|mts|cts)$/

/**
 * The workspace globs from `pnpm-workspace.yaml`, as anchored patterns over a
 * package's repo-relative directory. Derived from that file rather than restated,
 * so a new workspace glob cannot leave a whole tree outside this guard silently.
 */
function workspacePatterns(): RegExp[] {
  const yaml = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const globs: string[] = []
  let inPackages = false
  for (const raw of yaml.split('\n')) {
    if (/^packages:\s*$/.test(raw)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const glob = /^\s+-\s+'?([^'\s]+)'?\s*$/.exec(raw)?.[1]
      if (glob !== undefined) {
        globs.push(glob)
        continue
      }
      if (raw.trim() !== '') break
    }
  }
  expect(globs.length, 'no package globs parsed out of pnpm-workspace.yaml').toBeGreaterThan(0)
  return globs.map((glob) => new RegExp('^' + glob.split('*').join('[^/]+') + '$'))
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((entry) => entry !== '')
}

interface Member {
  /** Repo-relative package directory. */
  readonly dir: string
  /** Top-level subdirectories of the package holding tracked lintable source. */
  readonly sourceDirs: readonly string[]
  /** The package's `lint` script, or '' when it has none. */
  readonly lint: string
}

function members(): Member[] {
  const files = trackedFiles()
  const patterns = workspacePatterns()
  const dirs = [
    ...new Set(
      files
        .filter((file) => path.basename(file) === 'package.json')
        .map((file) => path.dirname(file)),
    ),
  ]
    .filter((dir) => patterns.some((pattern) => pattern.test(dir)))
    .sort()

  return dirs.map((dir) => {
    const sourceDirs = new Set<string>()
    for (const file of files) {
      if (!file.startsWith(dir + '/')) continue
      if (!LINTED_EXTENSIONS.test(file)) continue
      const rest = file.slice(dir.length + 1).split('/')
      // A lint TARGET is a directory, so a file sitting directly in the package
      // root contributes nothing to cover — `eslint <dir>` cannot name it.
      const top = rest[0]
      if (rest.length >= 2 && top !== undefined) sourceDirs.add(top)
    }
    const pkg: unknown = JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'))
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {}
    return { dir, sourceDirs: [...sourceDirs].sort(), lint: scripts['lint'] ?? '' }
  })
}

/** The directories a `lint` script hands to eslint, e.g. `eslint src test` -> [src, test]. */
function lintTargets(script: string): string[] {
  const targets = /^eslint\s+(.*)$/.exec(script.trim())?.[1]
  if (targets === undefined) return []
  return targets.split(/\s+/).filter((token) => token !== '' && !token.startsWith('-'))
}

/** The uncovered source directories of a member — empty iff the member is fully linted. */
function uncovered(member: Member): string[] {
  const targets = new Set(lintTargets(member.lint))
  return member.sourceDirs.filter((dir) => !targets.has(dir))
}

describe('every workspace package lints its own sources (#259)', () => {
  const all = members()
  const withSource = all.filter((member) => member.sourceDirs.length > 0)

  it('enumerates the workspace, and the enumeration is not vacuous', () => {
    // A broken glob parse, a wrong cwd or a `git ls-files` that returned nothing
    // would make every assertion below pass by having nothing to judge.
    expect(all.length).toBeGreaterThan(40)
    expect(withSource.length).toBeGreaterThan(40)
    expect(all.map((member) => member.dir)).toContain('packages/dom')
    expect(all.map((member) => member.dir)).toContain('registry')
    expect(all.map((member) => member.dir)).toContain('site')
    // ...and that the source-directory walk itself found something real, rather
    // than reporting every package as having nothing to lint.
    const dom = withSource.find((member) => member.dir === 'packages/dom')
    expect(dom?.sourceDirs).toEqual(['src', 'test'])
  })

  it('reports an under-covered package — the predicate, on known input', () => {
    // The instrument, asserted in BOTH directions before any verdict is read off
    // it. A coverage check that had silently stopped reporting would be green on
    // exactly the repo #259 describes, which is the failure class it exists to
    // prevent rather than an unlucky way to fail.
    const gap: Member = { dir: 'x', sourceDirs: ['src', 'test'], lint: 'eslint src' }
    expect(uncovered(gap)).toEqual(['test'])

    const none: Member = { dir: 'x', sourceDirs: ['src'], lint: '' }
    expect(uncovered(none)).toEqual(['src'])

    const covered: Member = { dir: 'x', sourceDirs: ['src', 'test'], lint: 'eslint src test' }
    expect(uncovered(covered)).toEqual([])

    // Flags are not directories: `eslint --max-warnings=0 src` covers `src`.
    const flagged: Member = { dir: 'x', sourceDirs: ['src'], lint: 'eslint --max-warnings=0 src' }
    expect(uncovered(flagged)).toEqual([])
  })

  it('gives every package with tracked source a lint script', () => {
    const missing = withSource.filter((member) => member.lint === '').map((member) => member.dir)
    expect(missing).toEqual([])
  })

  it('names EVERY directory holding that source', () => {
    const gaps = withSource
      .filter((member) => uncovered(member).length > 0)
      .map(
        (member) =>
          `${member.dir}: has ${uncovered(member).join(', ')} — lint is \`${member.lint}\``,
      )
    expect(gaps).toEqual([])
  })

  it('names only directories that exist', () => {
    // eslint exits non-zero on a target it cannot resolve, so a stale name turns
    // the whole package's lint into a hard failure rather than a silent gap —
    // the loud direction, but still worth catching at the source.
    const stale: string[] = []
    for (const member of all) {
      for (const target of lintTargets(member.lint)) {
        if (!existsSync(path.join(ROOT, member.dir, target))) {
          stale.push(`${member.dir}: lint names \`${target}\`, which does not exist`)
        }
      }
    }
    expect(stale).toEqual([])
  })

  it('is actually INVOKED — by a root script, by verify, and by CI', () => {
    const rootPkg: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const scripts = (rootPkg as { scripts?: Record<string, string> }).scripts ?? {}

    // The per-package task is only reachable through turbo; a root `lint` that
    // stopped fanning out would leave all 46 scripts unrun and still exit 0.
    expect(scripts['lint']).toBe('turbo run lint')
    // `pnpm verify` is the documented local pre-merge run. A gate CI runs and
    // verify does not is a gate contributors meet only after pushing.
    expect(scripts['verify']).toMatch(/turbo run [^&|]*\blint\b/)

    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const STEP_BOUNDARY = '\n      - '
    // `.slice(1)` drops the preamble before the first step: a real step cannot
    // live there, and a JOB-level block scalar can legally put a body line at
    // exactly 8 spaces, which is the one way a non-step could be mistaken for one.
    const steps = ci.split(STEP_BOUNDARY).slice(1)
    const invoking = steps.filter((step) => /^ {8}run: pnpm turbo lint\b/m.test(step))

    expect(invoking.length, 'ci.yml must contain a step running `pnpm turbo lint`').toBeGreaterThan(
      0,
    )

    for (const step of invoking) {
      // `continue-on-error` would silently turn a build-failing gate back into a
      // log line. Checked on EVERY invocation, so a clean step followed by a
      // neutered duplicate is caught too.
      expect(step).not.toMatch(/^ {8}continue-on-error:\s*true$/m)
      // CI's build step carries `--filter=!@llui/site`; lint runs UNFILTERED, and
      // carrying that filter across is how a genuine break once reached `main`.
      expect(step).not.toMatch(/--filter/)
    }
  })
})
