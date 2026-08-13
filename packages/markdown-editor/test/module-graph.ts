// The package's own module graph, as it is EMITTED — the shape both the
// per-plugin loadability gate (`commit-cost.test.ts`) and the packaging gate
// (`packaging.test.ts`) assert against.
//
// Both ask the same question — "what does this entry point drag in at RUNTIME?"
// — so the walk lives here once. `packaging.test.ts` points it at the barrel to
// prove `@lexical/table` is no longer reachable from it (#75); `commit-cost.test.ts`
// points it at each overlay plugin to prove the shared commit hub gave none of
// them a runtime edge (#74).

import ts from 'typescript'

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

// Every `src/**/*.ts` as text (vite's `?raw` glob, following `@llui/markdown`'s
// import-graph check — no `node:fs` types needed), keyed by its path under `src/`.
const SOURCES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ).map(([p, source]) => [p.replace(/^\.\.\/src\//, ''), source]),
)

/** Resolve a relative specifier against the importing file, both under `src/`.
 * The sources are NodeNext-style (`./overlay.js` means `overlay.ts`). */
function resolveRelative(from: string, specifier: string): string {
  const segments = from.split('/').slice(0, -1).concat(specifier.split('/'))
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/').replace(/\.js$/, '.ts')
}

/** Module specifiers a piece of JS imports at RUNTIME — static import/export-from
 * plus dynamic `import()`. Parsed, not grepped, so a specifier inside a string or
 * a comment is not mistaken for an edge. */
function runtimeSpecifiers(js: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    js,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  )
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

export interface ModuleGraph {
  /** Every `src/`-relative file reachable through relative imports. */
  inputs: ReadonlySet<string>
  /** Every bare package specifier the graph imports at runtime. */
  externals: ReadonlySet<string>
}

/**
 * The transitive runtime module graph of one `src/` entry point.
 *
 * Each file is EMITTED first (`ts.transpileModule`) and the emit is what gets
 * parsed, so a `import type` — or a `{ type X }` specifier — is gone before the
 * graph sees it. That is the whole point: the property #75 needs is about the
 * shipped `.js`, not about the shape of the TypeScript.
 *
 * `verbatimModuleSyntax` matches the repo tsconfig, so this emit is the one
 * `tsc -p tsconfig.build.json` produces. Were it ever to drift, it can only drift
 * the SAFE way: verbatim mode is the least-eliding mode, so this graph is a
 * superset of what actually ships, and a "must not contain" assertion over a
 * superset can raise a false alarm but never a false pass.
 */
export function moduleGraph(entry: string): ModuleGraph {
  const inputs = new Set<string>()
  const externals = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || inputs.has(file)) continue
    const source = SOURCES.get(file)
    if (source === undefined) throw new Error(`source not found under src/: ${file}`)
    inputs.add(file)
    const emitted = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
        verbatimModuleSyntax: true,
      },
    }).outputText
    for (const specifier of runtimeSpecifiers(emitted, file)) {
      if (specifier.startsWith('.')) queue.push(resolveRelative(file, specifier))
      else externals.add(specifier)
    }
  }
  return { inputs, externals }
}
