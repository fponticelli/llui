// What this package COSTS a consumer who does not use every feature (#75).
//
// The editor's plugins are opt-in at the API level, but a plugin that the BARREL
// re-exports is not opt-in at the PACKAGE level: its peers must be installed for
// the barrel to resolve at all, and a bundler that cannot prove the re-export
// unused keeps them. `tablePlugin` was the one case where that mattered —
// `@lexical/table` is imported by exactly one module in the package — so it moved
// to its own `./plugins/table` entry point and out of the barrel, and its peer
// became optional.
//
// These are drift gates: each one fails the build if a later change quietly
// re-couples the barrel to an optional peer.

import { describe, it, expect } from 'vitest'
import { moduleGraph } from './module-graph.js'

interface ConditionalExport {
  types?: string
  import?: string
}
type ExportEntry = string | ConditionalExport
interface PackageJson {
  exports: Record<string, ExportEntry>
  peerDependencies: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies: Record<string, string>
}

const PACKAGE_JSON: PackageJson = JSON.parse(
  Object.values(
    import.meta.glob('../package.json', { query: '?raw', import: 'default', eager: true }),
  )[0]!,
)

/** The `src/`-relative TypeScript an export entry's `import` target is built from. */
function entrySource(entry: ExportEntry): string | undefined {
  const target = typeof entry === 'string' ? entry : entry.import
  if (target === undefined || !target.startsWith('./dist/') || !target.endsWith('.js')) {
    return undefined
  }
  return target.slice('./dist/'.length).replace(/\.js$/, '.ts')
}

describe('package entry points', () => {
  it('exposes the table plugin as its own subpath export', () => {
    expect(PACKAGE_JSON.exports['./plugins/table']).toEqual({
      types: './dist/plugins/table.d.ts',
      import: './dist/plugins/table.js',
    })
  })

  // Every JS entry point must name a file that exists, or the export map points a
  // consumer at a 404 that no type-check or test in this package would notice.
  it('every JS entry point resolves to a source module', () => {
    for (const [subpath, entry] of Object.entries(PACKAGE_JSON.exports)) {
      const source = entrySource(entry)
      if (source === undefined) continue
      expect([subpath, moduleGraph(source).inputs.has(source)]).toEqual([subpath, true])
    }
  })
})

describe('optional peer dependencies', () => {
  it('declares @lexical/table as an optional peer', () => {
    // Still DECLARED — an optional peer is a version constraint that applies when
    // the consumer installs it, not an undeclared import.
    expect(PACKAGE_JSON.peerDependencies['@lexical/table']).toBeDefined()
    expect(PACKAGE_JSON.peerDependenciesMeta?.['@lexical/table']?.optional).toBe(true)
    // And a devDependency, because this package's own tests do use tables.
    expect(PACKAGE_JSON.devDependencies['@lexical/table']).toBeDefined()
  })

  // The property that makes the peer optional in the first place, and the one a
  // careless re-export would silently undo. Stated over ALL optional peers rather
  // than over `@lexical/table` alone: whatever becomes optional next inherits the
  // gate instead of needing a new test.
  it('keeps every optional peer out of the barrel', () => {
    const optional = Object.entries(PACKAGE_JSON.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta.optional === true)
      .map(([name]) => name)
    expect(optional).toContain('@lexical/table')

    const barrel = moduleGraph('index.ts')
    for (const peer of optional) {
      expect([peer, barrel.externals.has(peer)]).toEqual([peer, false])
    }
  })

  // The negative control: the walk above passes vacuously if nothing resolves, so
  // pin that the dependency IS visible from the entry point that owns it.
  it('reaches @lexical/table from the table entry point', () => {
    expect(moduleGraph('plugins/table.ts').externals.has('@lexical/table')).toBe(true)
  })
})
