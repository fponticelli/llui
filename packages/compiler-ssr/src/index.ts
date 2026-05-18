// @llui/compiler-ssr — SSR support (opt-in).
//
// Handles the `'use client'` directive: scans for it cheaply with
// `hasUseClientDirective`, then rewrites client-only modules into
// stubs that the SSR build can ship via `transformUseClientSsr`.
//
// `@llui/vike` calls these directly from its Vite plugin's transform
// hook when `ssr: true`. The plugin gates on `hasUseClientDirective`
// to avoid the parse cost when the directive isn't present.
//
// Owned by this package since v2c/decomp-25 (moved verbatim from
// @llui/compiler's transform.ts).

import ts from 'typescript'

// ── 'use client' directive ───────────────────────────────────────

export interface UseClientTransformResult {
  output: string
  warnings: string[]
}

/**
 * If `source` begins with a `'use client'` directive, generate a stub
 * replacement for the SSR build. Every `export const X = <expr>` becomes
 * `export const X = __clientOnlyStub('X')`, every `export function X`
 * becomes a stub, and `export default <expr>` becomes a default stub.
 * Returns `null` if the directive is absent (caller should fall through
 * to the normal compiler pass).
 *
 * The client build is expected to skip this path entirely — Vite passes
 * `{ ssr: false }` there, and the plugin checks that before invoking
 * this function.
 *
 * Shapes this v1 does NOT handle (emits a warning + leaves them out of
 * the stub output):
 *
 *   - `export function foo() {}` and `export class Foo {}` — rewritten
 *     as stubs but the caller may be surprised that `foo` and `Foo` are
 *     ComponentDef-shaped objects during SSR.
 *   - `export { a, b } from './other.js'` — re-export forms are not
 *     detected; they pass through and will still pull `./other` into
 *     the SSR graph.
 *   - `export * from './other.js'` — same as above.
 *   - `export type ...` — type exports are erased by TS so nothing to
 *     stub; left untouched.
 */
export function transformUseClientSsr(
  source: string,
  _filename: string,
): UseClientTransformResult | null {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Find the first non-comment, non-directive-whitespace statement.
  // 'use client' should be the literal first statement in the file.
  const first = sourceFile.statements[0]
  if (!first) return null
  if (!ts.isExpressionStatement(first)) return null
  if (!ts.isStringLiteral(first.expression)) return null
  if (first.expression.text !== 'use client') return null

  const warnings: string[] = []
  const namedExports: string[] = []
  let hasDefaultExport = false

  for (const stmt of sourceFile.statements) {
    // The `'use client'` directive itself — skip.
    if (stmt === first) continue

    // `export const NAME = ...` and `export let NAME = ...`
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          namedExports.push(decl.name.text)
        } else {
          warnings.push(
            '[llui/use-client] destructured `export const { ... }` is not supported; each binding would have to be stubbed individually. Refactor to one `export const` per value.',
          )
        }
      }
      continue
    }

    // `export function NAME() {}`
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export class NAME {}`
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export default ...`
    if (
      ts.isExportAssignment(stmt) ||
      (ts.isFunctionDeclaration(stmt) &&
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
    ) {
      hasDefaultExport = true
      continue
    }

    // `export { a, b }` / `export { a } from './x.js'` / `export * from './x.js'`
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) {
        warnings.push(
          "[llui/use-client] `export ... from '...'` re-export forms still pull the source module into the SSR graph and bypass stubbing. Either drop the re-export or move the 'use client' directive to the source module.",
        )
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const spec of stmt.exportClause.elements) {
          namedExports.push((spec.name ?? spec.propertyName!).text)
        }
      }
      continue
    }

    // Type-only statements are erased at runtime — nothing to stub.
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue

    // Imports, `import type`, enum declarations, plain (non-export)
    // variable statements — dropped from the stub output.
  }

  // Build the generated module source.
  const lines: string[] = ["import { __clientOnlyStub } from '@llui/dom'", '']
  for (const name of namedExports) {
    lines.push(`export const ${name} = __clientOnlyStub(${JSON.stringify(name)})`)
  }
  if (hasDefaultExport) {
    lines.push('export default __clientOnlyStub("default")')
  }

  return {
    output: lines.join('\n') + '\n',
    warnings,
  }
}

/**
 * Check whether `source`'s first statement is a `'use client'` directive.
 * Cheap string scan so the caller can decide which transform to run
 * without parsing the whole file twice.
 */
export function hasUseClientDirective(source: string): boolean {
  // Skip leading whitespace and block/line comments; look for the
  // first token. A full parse is overkill here — users who write
  // `'use client'` in any other position (inside a function, after
  // imports) aren't using the directive as React/Vercel define it.
  let i = 0
  const len = source.length
  while (i < len) {
    const ch = source[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i)
      if (nl === -1) return false
      i = nl + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return false
      i = end + 2
      continue
    }
    break
  }
  return source.startsWith("'use client'", i) || source.startsWith('"use client"', i)
}
