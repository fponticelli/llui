import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Issue #116 — the README promises that a production app wiring
// `@llui/devmode-annotate/install` does NOT ship the HUD (and therefore
// Lexical, html-to-image, fflate) in its entry chunk. Two source properties
// carry that promise, and both fail SILENTLY: the code still works, the chunk
// just quietly grows by half a megabyte.
//
//   1. `src/install.ts` reaches `./index.js` only through an erased
//      `import type` and a dynamic `import()`.
//   2. `src/stores/index.ts` — the entry a live app names to inject a custom
//      store — never reaches `src/index.ts` at all.
//
// Measured on the built package (vite 8, production, minified): the install
// entry ships a 1.8 kB chunk and defers 506 kB of JS + 13 kB of CSS to a chunk
// fetched on activation; importing `mountAnnotateHud` from the barrel instead
// puts all 506 kB in the entry chunk, mounted or not.

declare global {
  // vite/vitest provide `import.meta.glob`; declare the narrow shape we use so the
  // type-check (raw tsc, no vite/client types) passes.
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: string; import: string; eager: true },
    ): Record<string, string>
  }
}

const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The EMITTED module: `import type` is erased before anything looks at it, so
 *  what remains is exactly what a bundler has to resolve eagerly. */
function emit(source: string, fileName: string): string {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      verbatimModuleSyntax: true,
    },
  }).outputText
}

/** Static (non-dynamic) module specifiers of an emitted module. */
function staticImports(emitted: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, emitted, ts.ScriptTarget.ES2022, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** Resolve a relative specifier against a glob key ('../src/a/b.ts'). */
function resolveFrom(fromKey: string, spec: string): string {
  const parts = fromKey.split('/').slice(0, -1)
  for (const segment of spec.split('/')) {
    if (segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/').replace(/\.js$/, '.ts')
}

/** Every module an entry statically pulls in, plus the bare specifiers it names. */
function eagerGraph(entry: string): { modules: Set<string>; bare: Set<string> } {
  const modules = new Set<string>()
  const bare = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const key = queue.pop()!
    if (modules.has(key)) continue
    modules.add(key)
    const source = SOURCES[key]
    if (source === undefined) throw new Error(`entry-boundaries: no source for ${key}`)
    for (const spec of staticImports(emit(source, key), key)) {
      if (spec.startsWith('.')) queue.push(resolveFrom(key, spec))
      else bare.add(spec)
    }
  }
  return { modules, bare }
}

describe('the ./install entry stays a lazy boundary', () => {
  const source = SOURCES['../src/install.ts']
  const emitted = emit(source ?? '', 'install.ts')

  it('emits no static import at all', () => {
    expect(source).toBeTypeOf('string')
    expect(emitted).not.toMatch(/^\s*import\s[^(]/m)
  })

  it('reaches the HUD through a dynamic import()', () => {
    expect(emitted).toMatch(/import\(['"]\.\/index\.js['"]\)/)
  })
})

describe('the ./stores entry never drags in the HUD', () => {
  const { modules, bare } = eagerGraph('../src/stores/index.ts')

  it('does not reach the HUD barrel', () => {
    expect(modules.has('../src/index.ts')).toBe(false)
  })

  it('names only zero-dependency packages', () => {
    // `@llui/notes-format` is the on-disk format contract and has no deps of
    // its own. Anything else appearing here — the editor, @llui/components,
    // html-to-image — means a store started costing what the HUD costs.
    expect([...bare].sort()).toEqual([
      '@llui/notes-format/note-format',
      '@llui/notes-format/note-serialize',
    ])
  })

  // Negative control: the two assertions above pass vacuously on an empty walk.
  it('actually walked the store sources', () => {
    expect(modules.has('../src/stores/indexed-db-store.ts')).toBe(true)
    expect(modules.has('../src/stores/http-store.ts')).toBe(true)
    expect(modules.size).toBeGreaterThan(4)
  })
})
