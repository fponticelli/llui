// Issue #64 — `typescript` is a PEER of the compiler family, never a hard dep.
//
// This is the same landmine documented for `@llui/dom`: a package that owns a
// context the consumer also owns must not pin its own copy. As a hard
// `dependency`, `pnpm publish` freezes the resolved version, and a consumer with
// its own TypeScript gets a SECOND physical install — so the compiler analyses
// the project's sources with a different `ts` than the project itself compiles
// with. Two parsers, two `SyntaxKind` tables, one silently wrong dep mask.
//
// The three packages must also agree on the RANGE. They are installed together
// (`@llui/vite-plugin` → `@llui/compiler-ssr` → `@llui/compiler`), so a drifting
// floor in one of them narrows the intersection for every consumer without
// anyone editing the package that actually constrains it.
//
// This test lives in `@llui/compiler` because that is the package that
// introduces the TypeScript dependency; the other two only inherit it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The compiler-family packages, relative to `packages/compiler/test/`. */
const PACKAGES = ['.', '../compiler-ssr', '../vite-plugin'] as const

/** Only the fields this invariant is about — the rest of the manifest is free. */
type Manifest = {
  readonly name: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

function manifest(pkgDir: string): Manifest {
  const url = new URL(`../${pkgDir}/package.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Manifest
}

const MANIFESTS = PACKAGES.map(manifest)

describe('typescript dependency shape (issue #64)', () => {
  it.each(MANIFESTS.map((m) => [m.name, m] as const))(
    '%s declares typescript as a peer, not a dependency',
    (_name, m) => {
      expect(m.dependencies?.typescript).toBeUndefined()
      expect(m.peerDependencies?.typescript).toBeTypeOf('string')
      // The workspace still has to build and test itself, so the peer is backed
      // by a devDependency — the pattern already used for `@llui/dom`.
      expect(m.devDependencies?.typescript).toBeTypeOf('string')
    },
  )

  it.each(MANIFESTS.map((m) => [m.name, m] as const))(
    '%s keeps typescript a REQUIRED peer',
    (_name, m) => {
      // `import ts from 'typescript'` runs at module load in all three packages
      // (e.g. `vite-plugin/src/index.ts`), so an absent TypeScript is not a
      // degraded mode — it is MODULE_NOT_FOUND while Vite loads the config.
      // Marking it optional would trade an install-time warning for a crash.
      expect(m.peerDependenciesMeta?.typescript?.optional).toBeUndefined()
    },
  )

  it('all three agree on the peer range', () => {
    const ranges = new Set(MANIFESTS.map((m) => m.peerDependencies?.typescript))
    expect([...ranges]).toHaveLength(1)
  })
})
