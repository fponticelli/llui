import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_SPEC,
  parseSpec,
  pinItemDependencies,
  pinSpecs,
  workspaceVersions,
} from '../lib/registry-dependencies.mjs'

/**
 * #273: every `@llui/*` dependency of every SERVED registry item carries a
 * minimum equal to that package's workspace version. Exact over the whole built
 * registry — every item file and every index entry — never a sample, because a
 * single item shipped without a floor is exactly the silent breakage the check
 * exists to stop.
 */

const ROOT = resolve(import.meta.dirname, '../..')

type Item = {
  name: string
  dependencies?: string[]
  devDependencies?: string[]
}

function readJson<T>(rel: string): T {
  /** Parsed as unknown first, then narrowed — see CLAUDE.md on JSON casts. */
  const parsed: unknown = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))
  return parsed as T
}

function gitFiles(...pathspecs: string[]): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...pathspecs],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean)
    .sort()
}

/** Workspace versions derived INDEPENDENTLY of the build's own helper. */
function versionsFromGit(): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of gitFiles('packages/*/package.json')) {
    const pkg = readJson<{ name: string; version: string }>(file)
    out.set(pkg.name, pkg.version)
  }
  return out
}

const source = readJson<{ items: Item[] }>('registry/registry.json')
const versions = versionsFromGit()

/** What the build must have written for one source item. */
function expected(specs: readonly string[] | undefined): string[] | undefined {
  return specs?.map((spec) => {
    const { name } = parseSpec(spec)
    return name.startsWith('@llui/') ? `${name}@^${versions.get(name)}` : spec
  })
}

describe('built registry @llui/* minimums', () => {
  it('the build derives versions from the same workspace packages git knows', async () => {
    expect(new Map([...(await workspaceVersions(ROOT))].sort())).toEqual(
      new Map([...versions].sort()),
    )
  })

  it('the source never hand-writes an @llui/* version: every one is workspace:^', () => {
    const offenders = source.items.flatMap((item) =>
      [...(item.dependencies ?? []), ...(item.devDependencies ?? [])]
        .filter((spec) => spec.startsWith('@llui/'))
        .filter((spec) => parseSpec(spec).range !== WORKSPACE_SPEC)
        .map((spec) => `${item.name}: ${spec}`),
    )
    expect(offenders).toEqual([])
  })

  it('the built files are exactly the index plus one record per source item', () => {
    expect(gitFiles('site/public/r')).toEqual(
      ['registry.json', ...source.items.map((i) => `${i.name}.json`)]
        .map((f) => `site/public/r/${f}`)
        .sort(),
    )
  })

  it('every item record and every index entry pins each @llui/* dep to its workspace version', () => {
    const index = readJson<{ items: Item[] }>('site/public/r/registry.json')
    expect(index.items.map((i) => i.name)).toEqual(source.items.map((i) => i.name))

    const mismatches: string[] = []
    let pinned = 0
    for (const [i, item] of source.items.entries()) {
      const record = readJson<Item>(`site/public/r/${item.name}.json`)
      for (const [where, built] of [
        ['record', record],
        ['index', index.items[i]!],
      ] as const) {
        for (const key of ['dependencies', 'devDependencies'] as const) {
          const want = expected(item[key])
          if (JSON.stringify(built[key]) !== JSON.stringify(want)) {
            mismatches.push(`${item.name} (${where}) ${key}: ${JSON.stringify(built[key])}`)
          }
          for (const spec of built[key] ?? []) {
            const { name, range } = parseSpec(spec)
            if (!name.startsWith('@llui/')) continue
            pinned++
            if (range !== `^${versions.get(name)}`)
              mismatches.push(`${item.name} (${where}): ${spec}`)
          }
        }
      }
    }
    expect(mismatches).toEqual([])
    // Twice (record + index) the number of @llui/* specs in the source: proves
    // the loop above actually visited every one rather than passing vacuously.
    const sourceCount = source.items
      .flatMap((i) => [...(i.dependencies ?? []), ...(i.devDependencies ?? [])])
      .filter((s) => s.startsWith('@llui/')).length
    expect(sourceCount).toBeGreaterThan(0)
    expect(pinned).toBe(sourceCount * 2)
  })
})

describe('pinSpecs', () => {
  const v = new Map([
    ['@llui/components', '0.20.1'],
    ['@llui/dom', '0.14.0-rc.1'],
  ])

  it('pins workspace:^ and relays everything else untouched', () => {
    expect(
      pinSpecs(['@llui/components@workspace:^', 'clsx', 'x@^2', '@llui/dom@workspace:^'], v, 'i'),
    ).toEqual(['@llui/components@^0.20.1', 'clsx', 'x@^2', '@llui/dom@^0.14.0-rc.1'])
  })

  it.each(['@llui/components', '@llui/components@^0.20.1', '@llui/components@workspace:*'])(
    'rejects %s: an @llui/* minimum is derived, never written',
    (spec) => {
      expect(() => pinSpecs([spec], v, 'sonner')).toThrow(
        /registry item "sonner": write "@llui\/components@workspace:\^"/,
      )
    },
  )

  it('rejects an @llui/* package the workspace does not contain', () => {
    expect(() => pinSpecs(['@llui/nope@workspace:^'], v, 'x')).toThrow(/not a workspace package/)
  })

  it('pinItemDependencies leaves absent arrays absent', () => {
    expect(pinItemDependencies({ name: 'a', files: [] }, v)).toEqual({ name: 'a', files: [] })
    expect(
      pinItemDependencies({ name: 'a', devDependencies: ['@llui/dom@workspace:^'] }, v),
    ).toEqual({ name: 'a', devDependencies: ['@llui/dom@^0.14.0-rc.1'] })
  })
})
