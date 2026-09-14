import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EXTERNAL_BUILD_INPUTS, publishableDirs, reachesTarball } from '../changed-packages.mjs'

const ROOT = path.resolve(__dirname, '../..')

/**
 * `/publish` step 2 decides which packages get a version bump. Its old shell
 * loop failed in the two worst ways available to a release gate, both measured
 * in one release:
 *
 *  - it answered WRONG and SILENTLY (a zsh quoting bug emptied the package
 *    list, so "no packages changed" and "the loop broke" printed identically),
 *  - and it over-reported, counting `test/` as a reason to republish — which
 *    for `@llui/components` cascades into four more packages whose `^0.x`
 *    ranges exclude the new minor.
 *
 * The logic now lives in `scripts/changed-packages.mjs`, where `check:scripts`
 * type-checks it and `lint:scripts` lints it. These tests pin the predicate,
 * not the plumbing: the git walk is what CI exercises.
 */
describe('reachesTarball', () => {
  const FILES = ['dist', 'src']

  it('counts published source roots', () => {
    expect(reachesTarball('src/index.ts', FILES)).toBe(true)
    expect(reachesTarball('src/components/menu-machine.ts', FILES)).toBe(true)
    expect(reachesTarball('dist/index.js', FILES)).toBe(true)
  })

  it('counts what npm packs regardless of `files`', () => {
    expect(reachesTarball('package.json', FILES)).toBe(true)
    expect(reachesTarball('README.md', FILES)).toBe(true)
    expect(reachesTarball('LICENSE', FILES)).toBe(true)
    expect(reachesTarball('LICENCE.txt', FILES)).toBe(true)
  })

  // A tsconfig edit changes what `tsc` emits into dist/ without touching src/,
  // so treating it as unpublished would ship a stale tarball — the quiet
  // direction, which is the one that matters.
  it('counts config that changes emitted output', () => {
    expect(reachesTarball('tsconfig.build.json', FILES)).toBe(true)
    expect(reachesTarball('tsconfig.json', FILES)).toBe(true)
  })

  it('does NOT count files that never reach a consumer', () => {
    expect(reachesTarball('test/styles/form-controls.browser.test.ts', FILES)).toBe(false)
    expect(reachesTarball('vitest.config.ts', FILES)).toBe(false)
    expect(reachesTarball('eslint.config.ts', FILES)).toBe(false)
  })

  // The exact case this was written for: the RTL browser-test fix.
  it('classifies a test-only change as not needing a bump', () => {
    expect(reachesTarball('test/styles/form-controls.browser.test.ts', FILES)).toBe(false)
  })

  it('honours a package-specific `files` entry', () => {
    // @llui/agent ships `styles` too; nothing else does.
    expect(reachesTarball('styles/a.css', ['dist', 'styles', 'src'])).toBe(true)
    expect(reachesTarball('styles/a.css', FILES)).toBe(false)
  })

  // A prefix match must not let `src-notes/` in on the strength of `src`.
  it('matches whole path segments, not string prefixes', () => {
    expect(reachesTarball('srcs/index.ts', FILES)).toBe(false)
    expect(reachesTarball('src-notes/index.ts', FILES)).toBe(false)
    expect(reachesTarball('dist-old/index.js', FILES)).toBe(false)
  })
})

describe('publishableDirs', () => {
  it('is every packages/* without `private: true`, by exact set', () => {
    const fromGit = execFileSync('git', ['ls-files', '--', 'packages/*/package.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .filter((p) => p.split('/').length === 3)
      .filter((p) => {
        const parsed: unknown = JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'))
        return (parsed as { private?: boolean }).private !== true
      })
      .map((p) => p.split('/')[1]!)
      .sort()

    expect([...publishableDirs()].sort()).toEqual(fromGit)
    // Vacuity: a predicate that excluded everything would satisfy the equality
    // above only if the git side were empty too, but pin the floor anyway.
    expect(fromGit.length).toBeGreaterThan(20)
  })
})

describe('EXTERNAL_BUILD_INPUTS', () => {
  it('names every path it lists, and each exists', () => {
    for (const entry of EXTERNAL_BUILD_INPUTS) {
      expect(
        execFileSync('git', ['ls-files', '--', entry.path], { cwd: ROOT, encoding: 'utf8' }).trim(),
        `${entry.path} is listed but not tracked`,
      ).toBe(entry.path)
      expect(entry.why.length, `${entry.path} needs a reason`).toBeGreaterThan(10)
    }
  })

  // The table cannot be derived, so it can go stale. A build step that lands
  // outside `packages/` and is named by neither this table nor the exemption
  // below is invisible to change detection — it would ship a stale tarball with
  // nothing reporting it. Fail instead, and make the author choose.
  it('accounts for every build-ish script outside packages/', () => {
    const candidates = execFileSync(
      'git',
      ['ls-files', '--', 'scripts/publish*', 'scripts/add-js-extensions.mjs'],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)

    // `publish-order.mjs` computes an ORDER; it produces no artifact, so a
    // change to it cannot alter a tarball.
    const NOT_A_BUILD_INPUT = new Set(['scripts/publish-order.mjs'])

    const named = new Set(EXTERNAL_BUILD_INPUTS.map((e) => e.path))
    const uncovered = candidates.filter((p) => !named.has(p) && !NOT_A_BUILD_INPUT.has(p))
    expect(uncovered, 'add these to EXTERNAL_BUILD_INPUTS or to NOT_A_BUILD_INPUT').toEqual([])
    expect(candidates.length).toBeGreaterThan(2)
  })

  // Scope is the whole point: a per-package script marked ALL forces 25 bumps
  // plus every cascade they trigger.
  it('scopes the components-only style publisher to components', () => {
    const entry = EXTERNAL_BUILD_INPUTS.find(
      (e) => e.path === 'scripts/publish-component-styles.mjs',
    )
    expect(entry).toBeDefined()
    expect(entry!.affects).toEqual(['components'])
  })

  it('names a real package directory in every non-ALL entry', () => {
    const dirs = new Set(publishableDirs())
    for (const entry of EXTERNAL_BUILD_INPUTS) {
      if (entry.affects === 'ALL') continue
      for (const dir of entry.affects) expect(dirs.has(dir), `${dir} is not a package`).toBe(true)
    }
  })
})
