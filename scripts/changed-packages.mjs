#!/usr/bin/env node
// Which publishable packages have a change that can REACH THE TARBALL since a
// given ref — the question `/publish` step 2 actually needs.
//
// It replaced a shell loop in the skill, for two reasons measured in one
// release:
//
// 1. The loop answered WRONG, SILENTLY. It built its package list with
//    `PUBLISHABLE=$(node -e '…')` and iterated `for pkg in $PUBLISHABLE`; under
//    zsh the embedded single-quoted script broke the command substitution, the
//    list came back EMPTY, and the loop printed nothing — which reads exactly
//    like "no packages changed" and would have shipped a release that bumped
//    nothing. It was caught only because the operator already knew two packages
//    had changed. A release gate whose failure mode is an empty success line is
//    the worst shape available, and a shell loop in a Markdown file is checked
//    by nothing.
//
// 2. It over-reported. `git diff -- packages/<pkg>/` counts EVERY file in the
//    package, but `files` is `["dist","src"]` everywhere (plus `styles` for
//    @llui/agent), so `test/`, `vitest.config.ts` and `eslint.config.ts` never
//    reach a consumer. A test-only commit therefore demanded a version bump —
//    and for a package like @llui/components that bump is not free: its
//    dependents' `^0.x` ranges exclude the new minor, so a test-only change
//    cascades into republishing four more packages. That is exactly what the
//    RTL-browser-test fix left queued up for the next release.
//
// The predicate is "could this change alter what a consumer installs", which is
// wider than `files`: a `tsconfig*.json` edit changes emitted `dist/` without
// touching `src/`, and npm always packs `package.json`, `README*` and
// `LICENSE*` whatever `files` says. Getting that wrong in the QUIET direction
// ships a stale tarball, so every rule below errs toward reporting a change.
//
// Usage:
//   node scripts/changed-packages.mjs [<ref>]      # default: last `release:` commit
//   node scripts/changed-packages.mjs --json
//
// Exits non-zero only on a real error (bad ref, unreadable manifest). "Nothing
// changed" is a successful empty list, and `--json` says so explicitly.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * npm packs these regardless of `files`, so a change to one reaches consumers.
 * Matched case-insensitively against the package-relative path's first segment.
 * @type {readonly RegExp[]}
 */
const ALWAYS_PACKED = [/^package\.json$/i, /^readme(\.[^/]+)?$/i, /^licen[cs]e(\.[^/]+)?$/i]

/**
 * Not packed, but they change what `tsc` EMITS into `dist/`, so a change here
 * alters the tarball without touching `src/`.
 * @type {readonly RegExp[]}
 */
const AFFECTS_EMIT = [/^tsconfig[^/]*\.json$/i]

/**
 * Read a package manifest.
 * @param {string} dir package directory name under `packages/`
 * @returns {{ name: string, version: string, private?: boolean, files?: string[] } | null}
 */
function manifest(dir) {
  const p = path.join(ROOT, 'packages', dir, 'package.json')
  if (!existsSync(p)) return null
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(p, 'utf8'))
  return /** @type {{ name: string, version: string, private?: boolean, files?: string[] }} */ (
    parsed
  )
}

/**
 * Every publishable package directory, in `readdirSync` order.
 * @returns {string[]}
 */
export function publishableDirs() {
  return readdirSync(path.join(ROOT, 'packages')).filter((dir) => {
    const pkg = manifest(dir)
    return pkg !== null && pkg.private !== true
  })
}

/**
 * Does a package-relative path reach the tarball, or change what is emitted
 * into it?
 *
 * `files` entries are directory names in this repo (`dist`, `src`, `styles`),
 * so a prefix match is the whole rule. `dist` is gitignored, so it never
 * appears in a diff — harmless, and left in rather than special-cased so the
 * predicate keeps meaning "what `files` says" if that ever changes.
 *
 * @param {string} relative package-relative POSIX path, e.g. `src/index.ts`
 * @param {readonly string[]} files the manifest's `files` array
 * @returns {boolean}
 */
export function reachesTarball(relative, files) {
  if (ALWAYS_PACKED.some((re) => re.test(relative))) return true
  if (AFFECTS_EMIT.some((re) => re.test(relative))) return true
  return files.some((entry) => {
    const root = entry.replace(/^\.\//, '').replace(/\/+$/, '')
    return root !== '' && (relative === root || relative.startsWith(`${root}/`))
  })
}

/**
 * The most recent `release:` commit, or null when none exists.
 * @returns {string | null}
 */
export function lastReleaseRef() {
  const out = execFileSync('git', ['log', '--grep=^release:', '--format=%H', '-n', '1'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  return out === '' ? null : out
}

/**
 * Package-relative paths that changed under `packages/<dir>/` since `ref`.
 * @param {string} dir
 * @param {string} ref
 * @returns {string[]}
 */
function changedPaths(dir, ref) {
  const prefix = `packages/${dir}/`
  const out = execFileSync('git', ['diff', '--name-only', `${ref}..HEAD`, '--', prefix], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .map((p) => p.slice(prefix.length))
}

/**
 * @typedef {object} PackageChange
 * @property {string} dir directory under `packages/`
 * @property {string} name published package name
 * @property {string} version current version
 * @property {string[]} shipped changed paths that reach the tarball
 * @property {string[]} ignored changed paths that do not
 */

/**
 * Classify every publishable package's changes since `ref`.
 * @param {string} ref
 * @returns {PackageChange[]}
 */
export function classify(ref) {
  /** @type {PackageChange[]} */
  const out = []
  for (const dir of publishableDirs()) {
    const pkg = manifest(dir)
    if (pkg === null) continue
    const files = pkg.files ?? []
    /** @type {string[]} */
    const shipped = []
    /** @type {string[]} */
    const ignored = []
    for (const rel of changedPaths(dir, ref)) {
      ;(reachesTarball(rel, files) ? shipped : ignored).push(rel)
    }
    if (shipped.length > 0 || ignored.length > 0) {
      out.push({ dir, name: pkg.name, version: pkg.version, shipped, ignored })
    }
  }
  return out
}

/**
 * Files OUTSIDE `packages/` whose change still alters a tarball, mapped to what
 * they affect. Per-package detection cannot see these at all — they live in
 * `scripts/` — so without this table a change to one of them ships a stale
 * package with nothing reporting it.
 *
 * The value is either `'ALL'` or the specific package directories. Getting that
 * distinction right matters in BOTH directions: a per-package script listed as
 * `'ALL'` forces 25 needless bumps (and, for anything depended on, a cascade on
 * top), while a global one listed per-package misses the rest. Measured: the
 * first cut of this file matched `scripts/publish*` by GLOB and so classified
 * `publish-component-styles.mjs` — which only `@llui/components`' build runs —
 * as global, demanding an `--all` release for a change touching one package.
 *
 * `scripts/test/changed-packages.test.ts` fails when a `scripts/publish*` or
 * `scripts/*-extensions.mjs` file exists that this table does not name, so a
 * new build step cannot land silently uncovered.
 *
 * @type {ReadonlyArray<{ path: string, affects: 'ALL' | readonly string[], why: string }>}
 */
export const EXTERNAL_BUILD_INPUTS = [
  {
    path: 'scripts/add-js-extensions.mjs',
    affects: 'ALL',
    why: "rewrites every package's emitted relative imports to carry .js",
  },
  {
    path: 'scripts/publish.sh',
    affects: 'ALL',
    why: 'the publisher itself — cleans dist and packs every package',
  },
  {
    path: 'scripts/publish-component-styles.mjs',
    affects: ['components'],
    why: "reconciles @llui/components' dist/styles/ CSS artifact set",
  },
  {
    path: 'tsconfig.json',
    affects: 'ALL',
    why: 'the root config every packages/<p>/tsconfig.json extends, and every tsconfig.build.json extends that',
  },
]

/**
 * Which external build inputs changed since `ref`, and what they affect.
 * @param {string} ref
 * @returns {{ path: string, affects: 'ALL' | readonly string[] }[]}
 */
export function changedExternalInputs(ref) {
  const paths = EXTERNAL_BUILD_INPUTS.map((e) => e.path).filter((p) =>
    existsSync(path.join(ROOT, p)),
  )
  if (paths.length === 0) return []
  const out = execFileSync('git', ['diff', '--name-only', `${ref}..HEAD`, '--', ...paths], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const changed = new Set(out.split('\n').filter(Boolean))
  return EXTERNAL_BUILD_INPUTS.filter((e) => changed.has(e.path)).map((e) => ({
    path: e.path,
    affects: e.affects,
  }))
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const refArg = args.find((a) => !a.startsWith('--'))
  const ref = refArg ?? lastReleaseRef()

  if (ref === null) {
    const message = 'no `release:` commit found — treat ALL packages as changed'
    if (json) console.log(JSON.stringify({ ref: null, all: true, message }, null, 2))
    else console.log(message)
    return
  }

  const changes = classify(ref)
  const external = changedExternalInputs(ref)
  const all = external.some((e) => e.affects === 'ALL')
  /** Package dirs pulled in by a per-package external input. */
  const externallyDirty = new Set(
    external.flatMap((e) => (e.affects === 'ALL' ? [] : [...e.affects])),
  )

  const shipped = changes.filter((c) => c.shipped.length > 0 || externallyDirty.has(c.dir))
  const testOnly = changes.filter((c) => c.shipped.length === 0 && !externallyDirty.has(c.dir))

  if (json) {
    console.log(JSON.stringify({ ref, external, all, shipped, testOnly }, null, 2))
    return
  }

  /** @param {number} n */
  const plural = (n) => `${n} file${n === 1 ? '' : 's'}`
  console.log(`Since ${ref.slice(0, 8)}:`)
  if (external.length > 0) {
    console.log('\n  EXTERNAL BUILD INPUTS changed:')
    for (const e of external) {
      const scope = e.affects === 'ALL' ? 'ALL packages — treat as --all' : e.affects.join(', ')
      console.log(`    ${e.path}  ->  ${scope}`)
    }
  }
  console.log(`\n  CHANGED (reaches the tarball) — ${shipped.length}:`)
  for (const c of shipped) {
    const via = c.shipped.length === 0 ? ' (via an external build input)' : ''
    console.log(
      `    ${c.dir.padEnd(24)} ${c.name}@${c.version}  (${plural(c.shipped.length)})${via}`,
    )
  }
  if (shipped.length === 0 && !all) console.log('    (none)')
  if (all) console.log('    …plus EVERY other publishable package (--all)')
  if (testOnly.length > 0) {
    console.log(`\n  NOT published — no bump needed — ${testOnly.length}:`)
    for (const c of testOnly) {
      console.log(`    ${c.dir.padEnd(24)} ${c.name}  (${c.ignored.join(', ')})`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
