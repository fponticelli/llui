import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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
 *      everywhere, which is the `registry-attrs` lesson);
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
    'workflow, never in a PR, and its histories cannot fit the 30 s PR budget. Its exact value ' +
    'is pinned separately by `lexical-loro-stress-lane.test.ts`.',
}

/** Directories a config walk has no business descending into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.test-durations'])

function findConfigs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      findConfigs(join(dir, entry.name), found)
    } else if (/^vitest(\..+)?\.config\.ts$/.test(entry.name)) {
      found.push(relative(repoRoot, join(dir, entry.name)))
    }
  }
  return found
}

const configPaths = findConfigs(repoRoot).sort()

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
          ((await import(pathToFileURL(join(repoRoot, path)).href)) as { default: ResolvedConfig })
            .default,
        ] as const,
    ),
  ),
)

/** The static directory prefix of a glob — everything before the first segment
 *  containing a wildcard. `test/stress/ ** /*.stress.ts` → `test/stress`. */
function globRoot(glob: string): string {
  const segments = glob.split('/')
  const wildcard = segments.findIndex((segment) => segment.includes('*'))
  return segments.slice(0, wildcard < 0 ? segments.length : wildcard).join('/')
}

describe('the vitest configuration set', () => {
  // Vacuity guard: a walk that silently found nothing would make every
  // assertion below pass. Name the two files whose absence would be the
  // regression, and hold a floor on the rest.
  it('sweeps every vitest config in the repo', () => {
    expect(configPaths).toContain('vitest.scripts.config.ts')
    expect(configPaths).toContain('packages/lexical-loro/vitest.stress.config.ts')
    expect(configPaths.length).toBeGreaterThan(25)
    for (const path of configPaths) expect(loaded.get(path)?.test).toBeTruthy()
  })

  it('states the timeout budgets in exactly one place', () => {
    const shard = shared.test
    expect(shard?.testTimeout).toBeTypeOf('number')
    expect(shard?.hookTimeout).toBeTypeOf('number')

    const diverged: string[] = []
    for (const path of configPaths) {
      const test = loaded.get(path)?.test
      for (const field of ['testTimeout', 'hookTimeout'] as const) {
        if (test?.[field] === shard?.[field]) continue
        if (BUDGET_ALLOWED[`${path}: ${field}`]) continue
        diverged.push(`${path}: ${field} is ${String(test?.[field])}, shared is ${shard?.[field]}`)
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
      expect(globs.length).toBeGreaterThan(0)
      for (const glob of globs) {
        const root = globRoot(glob)
        if (!existsSync(resolve(repoRoot, dirname(path), root))) dead.push(`${path}: ${glob}`)
      }
    }
    expect(dead).toEqual([])
  })
})
