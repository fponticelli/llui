import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import self from '../package.json'

const isLexical = (name: string) => name === 'lexical' || name.startsWith('@lexical/')

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

describe('packaging: core stays editor-free', () => {
  it('does not regress @llui/dom out of peerDependencies', () => {
    expect(self.peerDependencies).toHaveProperty('@llui/dom')
    expect(self.dependencies).not.toHaveProperty('@llui/dom')
  })
  it('declares no editor or Lexical package in any dependency class', () => {
    const declared = [
      ...Object.keys(self.dependencies),
      ...Object.keys(self.devDependencies),
      ...Object.keys(self.peerDependencies),
    ]
    expect(declared.filter(isLexical)).toEqual([])
    expect(declared.filter((name) => name.includes('markdown-editor'))).toEqual([])
  })

  it('emits no runtime import of an editor or Lexical package', () => {
    expect([...RUNTIME_IMPORTS].filter(isLexical)).toEqual([])
    expect([...RUNTIME_IMPORTS].filter((name) => name.includes('markdown-editor'))).toEqual([])
    // Negative controls: the emitted scan really walked runtime imports and
    // still sees the non-editor packages core deliberately owns.
    expect(RUNTIME_IMPORTS.has('@llui/dom')).toBe(true)
    expect(RUNTIME_IMPORTS.has('fflate')).toBe(true)
  })
})
