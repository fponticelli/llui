import { describe, expect, it } from 'vitest'
import ts from 'typescript'
// Imported as JSON rather than read through `require`/`node:fs`: both packages
// restrict their `exports` map (so the `./package.json` subpath is unresolvable),
// and this is a browser package that deliberately carries no `@types/node`.
import self from '../package.json'
import markdownEditor from '../../markdown-editor/package.json'

const isLexical = (name: string) => name === 'lexical' || name.startsWith('@lexical/')

/** The peers `@llui/markdown-editor` marks optional — needed only by the consumer
 * that imports the entry point behind them. */
const optionalPeers = (pkg: { peerDependenciesMeta?: Record<string, { optional?: boolean }> }) =>
  Object.entries(pkg.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta.optional === true)
    .map(([name]) => name)

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

/**
 * Every bare package specifier this package imports at RUNTIME, across all of `src/`.
 *
 * Each file is EMITTED first and the emit is what gets parsed, so an `import type` —
 * the form in which this package's one reference to `lexical` appears — is gone before
 * the scan sees it. Specifiers are PARSED, not grepped, so one inside a string or a
 * comment is not mistaken for an edge.
 *
 * Deliberately FLAT — every source file, not a walk from the entry points. The
 * question here is "does this package name the thing anywhere", which needs no
 * resolution, and the flat set is a superset of any entry point's transitive graph:
 * it can raise a false alarm but never give a false pass. (`@llui/markdown-editor`
 * owns the transitive version of this walk, over its own sources, in
 * `markdown-editor/test/module-graph.ts`. It stays there: importing it across the
 * package boundary would put a source file outside this package's `rootDir` and hide
 * the edge from Turbo's per-package cache inputs.)
 */
const RUNTIME_IMPORTS: ReadonlySet<string> = (() => {
  const found = new Set<string>()
  for (const [path, source] of Object.entries(
    import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  )) {
    // `src/css.d.ts` (the `?raw`/`.css` module declarations): a declaration file has
    // no emit at all — every import in it is erased — and `transpileModule` refuses
    // to produce output for one.
    if (path.endsWith('.d.ts')) continue
    const emitted = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
        verbatimModuleSyntax: true,
      },
    }).outputText
    const sourceFile = ts.createSourceFile(path, emitted, ts.ScriptTarget.ES2022, true)
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        if (!node.moduleSpecifier.text.startsWith('.')) found.add(node.moduleSpecifier.text)
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0]) &&
        !node.arguments[0].text.startsWith('.')
      ) {
        found.add(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return found
})()

/**
 * `@llui/devmode-annotate` value-imports `@llui/markdown-editor` (the HUD's note
 * editor) as a hard dependency, and `@llui/markdown-editor` declares `lexical` +
 * seven REQUIRED `@lexical/*` packages as peer dependencies — it value-imports them
 * across ~30 source files. A peer is the *consumer's* obligation, and devmode-annotate
 * is that consumer, so these entries are the peer-satisfaction layer, NOT dead weight.
 *
 * They look unused because devmode-annotate's own source references `lexical` exactly
 * once, in a type-only `import type { LexicalEditor }` that is erased at build. A sweep
 * of `src/` therefore "proves" they are droppable — and issue #63 was filed on exactly
 * that reading. Dropping them is invisible to every in-repo signal (build, check and all
 * other tests still pass) because inside the workspace `@llui/markdown-editor`
 * satisfies its own peers from its devDependencies. The breakage only reaches a
 * consumer's install, under a package manager that does not auto-install peers (Yarn's
 * default; pnpm with `auto-install-peers=false`), as unmet peers and a HUD whose
 * editor cannot resolve `lexical` at runtime. Measured against a packed tarball, the
 * removal also saves nothing: pnpm/npm auto-install the peers, so the dependency
 * closure is byte-identical either way.
 *
 * `@lexical/table` is the ONE exception, and it is a different fact rather than a
 * softening of the one above: since #75 it is an OPTIONAL peer, reachable only from
 * `@llui/markdown-editor/plugins/table`, an entry point this package never imports.
 * Nothing has to satisfy it here, so carrying it would push a package onto every
 * consumer of the HUD for nothing. The suites below pin BOTH halves — the required
 * peers are declared, the optional one is not — so neither can drift into the other.
 *
 * This test is the guard that no other in-repo signal can provide.
 */
describe('packaging: Lexical peer satisfaction for @llui/markdown-editor', () => {
  it('declares every REQUIRED Lexical peer of @llui/markdown-editor as its own dependency', () => {
    const optional = new Set(optionalPeers(markdownEditor))
    const required = Object.keys(markdownEditor.peerDependencies)
      .filter(isLexical)
      .filter((name) => !optional.has(name))
      .sort()
    // Guard the guard: if markdown-editor ever stops peering Lexical this test would
    // silently stop testing anything, so assert the precondition still holds.
    expect(required.length).toBeGreaterThan(0)

    const declared = Object.keys(self.dependencies).filter(isLexical).sort()
    expect(declared).toEqual(required)
  })

  it('keeps them in dependencies, not devDependencies (they must reach consumers)', () => {
    expect(Object.keys(self.devDependencies).filter(isLexical)).toEqual([])
  })

  it('does not regress @llui/dom out of peerDependencies', () => {
    // The repo-wide packaging landmine: @llui/dom as a hard dep gives a consumer two
    // physical installs, each with its own module-scoped currentContext, and every
    // provide()/structural primitive throws. It must stay a peer.
    expect(self.peerDependencies).toHaveProperty('@llui/dom')
    expect(self.dependencies).not.toHaveProperty('@llui/dom')
  })
})

/**
 * The other half of #75: an optional peer of the editor must not become a MANDATORY
 * dependency of the HUD, because a `dependency` is exactly that for everyone who
 * installs `@llui/devmode-annotate`.
 *
 * What licenses the omission is not the manifest but the imports: this package names
 * neither the peer nor the editor entry point behind it. Both are asserted, because
 * either one coming back would make the missing dependency a runtime failure in a
 * consumer's app rather than an install warning here.
 */
describe('packaging: optional peers of the editor stay out of the HUD', () => {
  it('does not declare @lexical/table at all', () => {
    expect(self.dependencies).not.toHaveProperty('@lexical/table')
    expect(self.devDependencies).not.toHaveProperty('@lexical/table')
    // …and the precondition that makes that correct.
    expect(optionalPeers(markdownEditor)).toContain('@lexical/table')
  })

  it('never imports an optional peer of the editor', () => {
    for (const peer of optionalPeers(markdownEditor)) {
      expect([peer, RUNTIME_IMPORTS.has(peer)]).toEqual([peer, false])
    }
  })

  it('imports only editor entry points that are free of optional peers', () => {
    const used = [...RUNTIME_IMPORTS].filter((s) => s.startsWith('@llui/markdown-editor')).sort()
    // The barrel, plus the same stylesheet twice — once as a side-effect import for the
    // light DOM and once `?raw` to adopt into the shadow root. Neither CSS entry pulls a
    // module graph at all, and the barrel's freedom from optional peers is pinned by
    // `markdown-editor/test/packaging.test.ts`. A NEW entry point added to this list is
    // a deliberate decision that has to be re-justified against that gate.
    expect(used).toEqual([
      '@llui/markdown-editor',
      '@llui/markdown-editor/styles/editor.css',
      '@llui/markdown-editor/styles/editor.css?raw',
    ])
  })

  // A negative control for the scan itself: the assertions above are "must NOT
  // contain", which pass vacuously if nothing is scanned. Pin that it really did read
  // this package's sources, and really does see through the emit.
  it('the import scan actually reads this package', () => {
    expect(RUNTIME_IMPORTS.has('@llui/markdown-editor')).toBe(true)
    expect(RUNTIME_IMPORTS.has('fflate')).toBe(true)
    // The type-only `import type { LexicalEditor } from 'lexical'` in `index.ts` is the
    // whole reason a source sweep misleads. The scan must NOT see it — if it did, the
    // "never imports an optional peer" assertion above would be checking the wrong thing.
    expect(RUNTIME_IMPORTS.has('lexical')).toBe(false)
  })
})
