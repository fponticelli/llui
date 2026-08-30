import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import shared from '../../vitest.shared'

/**
 * Repo-wide guard on the vitest configuration set (#249).
 *
 * `vitest.shared.ts` states the workspace's timeout budgets ONCE, deliberately
 * (#147): the failures a saturated `pnpm -r run test` produces are not owned by
 * any one package, and this repo already spent four separate one-file patches
 * on one cause. That only holds while every config actually reaches the base —
 * and `vitest.scripts.config.ts` did not. It defined its whole config
 * standalone, so `scripts/test/**` ran on vitest's stock 5 s `testTimeout`
 * while everything else ran on 30 s.
 *
 * Nothing could see it. Each config is a separate module, `pnpm test:scripts`
 * is green on a quiet machine, and the divergence only bites under load — which
 * is where CI lives and where nobody reads a red as a misconfiguration. Two
 * lanes in one batch hit it independently and both re-ran instead.
 *
 * So the gate is on the config SET, not on any one file. Three properties, and
 * the third is the general form of what actually went wrong:
 *
 *   1. every config resolves the shared budgets (allowlisted per FILE AND
 *      FIELD, never per field alone — a bare-field entry switches the check off
 *      everywhere, which is the `registry-attrs` lesson, and is measured: with
 *      a bare key the shadowing mutation below SURVIVES);
 *   2. the scripts config discovers ONLY `scripts/test/**` — `mergeConfig`
 *      concatenates arrays, so the natural spelling of this fix would have left
 *      the shared `test/**` glob in place beside it;
 *   3. every discovery glob in every config names a directory that EXISTS. A
 *      glob that cannot match anything is dead configuration, and it is how a
 *      concatenated array hides: it costs nothing today and silently starts
 *      matching the day someone adds a directory of that name.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * A config that deliberately differs from the shared budget, keyed
 * `<repo-relative path>: <field>`. NEVER key by field alone: an entry that
 * names only `testTimeout` excuses every config in the repo, which is exactly
 * the shadowing #147 is about.
 */
const BUDGET_ALLOWED: Readonly<Record<string, string>> = {
  'packages/lexical-loro/vitest.stress.config.ts: testTimeout':
    'The dedicated stress lane. It runs on its own command (`test:stress`) and its own daily ' +
    'workflow, never in a PR, and its accumulated histories cannot fit the 30 s PR budget. ' +
    '`lexical-loro-stress-lane.test.ts` pins that it EXCEEDS the workspace budget ' +
    '(`toBeGreaterThan(30_000)`) and that the lane does not retry; the exact 180_000 is ' +
    'deliberately not pinned anywhere, so treat this entry as licence for "larger", not for a value.',
}

/**
 * DISCOVERY IS `git ls-files`, NOT A DIRECTORY WALK, and that is a bug fix
 * rather than a style choice. A walk from the repo root reaches
 * `.claude/worktrees/`, which is gitignored and holds a FULL CHECKOUT of every
 * sibling agent lane. From the main worktree that walk finds 210 configs, 180
 * of them foreign; the budget assertion then fails on other branches' configs
 * (an allowlist key is repo-relative and can never match a `.claude/...` path),
 * and the `import()` of 180 foreign modules takes this file's transform from
 * 5.6 s to 171 s — or down entirely if a sibling is mid-edit. CI never sees it
 * (fresh checkout); `pnpm verify` on a developer's machine sees it every time.
 *
 * `--cached --others --exclude-standard` is tracked PLUS untracked-but-not-
 * ignored, so a brand-new config is covered before it is staged while anything
 * gitignored — every sibling worktree included — is structurally unreachable.
 */
function repoConfigPaths(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return out
    .split('\0')
    .filter((path) => /(^|\/)vitest(\..+)?\.config\.ts$/.test(path))
    .sort()
}

const configPaths = repoConfigPaths()

interface ResolvedConfig {
  readonly test?: {
    readonly testTimeout?: number
    readonly hookTimeout?: number
    readonly include?: readonly string[]
  }
}

const loaded = new Map<string, ResolvedConfig>(
  await Promise.all(
    configPaths.map(
      async (path) =>
        [
          path,
          (
            (await import(pathToFileURL(resolve(repoRoot, path)).href)) as {
              default: ResolvedConfig
            }
          ).default,
        ] as const,
    ),
  ),
)

/** The static directory prefix of a glob — everything before the first segment
 *  containing a wildcard. `test/stress/(star)(star)/*.stress.ts` -> `test/stress`. */
function globRoot(glob: string): string {
  const segments = glob.split('/')
  const wildcard = segments.findIndex((segment) => segment.includes('*'))
  return segments.slice(0, wildcard < 0 ? segments.length : wildcard).join('/')
}

describe('the vitest configuration set', () => {
  // VACUITY GUARD, in BOTH directions. A floor (`> 25`) only catches
  // under-collection, and the defect this file was written after was
  // OVER-collection: the directory walk it used to do found 210 configs from
  // the main worktree and a floor waved that through. Assert the EXACT set.
  //
  // Bump this when you add or remove a workspace — that is the intended cost of
  // an exact count, and it is one line.
  it('sweeps exactly the configs this repository owns', () => {
    expect(configPaths).toEqual([
      'packages/a2ui/vitest.config.ts',
      'packages/agent-bridge/vitest.config.ts',
      'packages/agent-e2e/vitest.config.ts',
      'packages/agent/vitest.config.ts',
      'packages/cli/vitest.config.ts',
      'packages/compiler-ssr/vitest.config.ts',
      'packages/compiler/vitest.config.ts',
      'packages/components/vitest.config.ts',
      'packages/devmode-annotate-editor/vitest.config.ts',
      'packages/devmode-annotate/vitest.config.ts',
      'packages/dom/vitest.config.ts',
      'packages/effects/vitest.config.ts',
      'packages/interactions/vitest.config.ts',
      'packages/lexical-collab/vitest.config.ts',
      'packages/lexical-loro/vitest.config.ts',
      'packages/lexical-loro/vitest.stress.config.ts',
      'packages/lexical/vitest.config.ts',
      'packages/markdown-editor/vitest.config.ts',
      'packages/markdown/vitest.config.ts',
      'packages/mcp/vitest.config.ts',
      'packages/notes-format/vitest.config.ts',
      'packages/router/vitest.config.ts',
      'packages/security/vitest.config.ts',
      'packages/test/vitest.config.ts',
      'packages/transitions/vitest.config.ts',
      'packages/vike/vitest.config.ts',
      'packages/vite-plugin/vitest.config.ts',
      'registry/vitest.config.ts',
      'site/vitest.config.ts',
      'vitest.scripts.config.ts',
    ])
    for (const path of configPaths) expect(loaded.get(path)?.test, path).toBeTruthy()
  })

  it('states the timeout budgets in exactly one place', () => {
    const base = shared.test
    expect(base?.testTimeout).toBeTypeOf('number')
    expect(base?.hookTimeout).toBeTypeOf('number')

    const diverged: string[] = []
    for (const path of configPaths) {
      const test = loaded.get(path)?.test
      for (const field of ['testTimeout', 'hookTimeout'] as const) {
        if (test?.[field] === base?.[field]) continue
        if (BUDGET_ALLOWED[`${path}: ${field}`]) continue
        diverged.push(`${path}: ${field} is ${String(test?.[field])}, shared is ${base?.[field]}`)
      }
    }
    expect(diverged).toEqual([])
  })

  it('discovers only the root scripts suite from the scripts config', () => {
    // `mergeConfig` CONCATENATES `test.include`, so the obvious spelling of the
    // #249 fix leaves the shared `test/**/*.test.ts` here too.
    expect(loaded.get('vitest.scripts.config.ts')?.test?.include).toEqual([
      'scripts/test/**/*.test.ts',
    ])
  })

  it('has no discovery glob that cannot match anything', () => {
    const dead: string[] = []
    for (const path of configPaths) {
      const globs = loaded.get(path)?.test?.include ?? []
      expect(globs.length, path).toBeGreaterThan(0)
      for (const glob of globs) {
        const root = globRoot(glob)
        if (!existsSync(resolve(repoRoot, dirname(path), root))) dead.push(`${path}: ${glob}`)
      }
    }
    expect(dead).toEqual([])
  })
})
