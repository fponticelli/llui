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
 * Every export with a statically-known name is stubbed uniformly:
 *
 *   - `export const/let NAME = …`, `export function NAME()`, `export class
 *     NAME`, `export enum NAME` — each becomes `export const NAME =
 *     __clientOnlyStub('NAME')`. (A stubbed function/class/enum is a value, not
 *     a callable/constructable — SSR must not invoke it; the client build ships
 *     the real one.)
 *   - `export { a, b }` and `export { a as b } from './other.js'` — the
 *     names are known, so each is stubbed (the `from './other.js'` source
 *     module is DROPPED, never pulled into the SSR graph).
 *   - `export default …` — stubbed as `export default __clientOnlyStub("default")`.
 *
 * NOT stubbable (dropped from the output, WITH a warning):
 *
 *   - `export * from './other.js'` — its re-exported names can't be
 *     enumerated statically, so they can't be stubbed. Any client-only
 *     value it re-exported is undefined during SSR; move the 'use client'
 *     directive to the source module.
 *
 * Left untouched: `export type …` / `interface` (erased by TS anyway).
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

  const hasModifier = (stmt: ts.Statement, kind: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt)?.some((m) => m.kind === kind) ?? false)

  for (const stmt of sourceFile.statements) {
    // The `'use client'` directive itself — skip.
    if (stmt === first) continue

    // `export default ...` — checked BEFORE the named-export branches, because a
    // `export default function NAME` / `export default class NAME` also carries the
    // `export` modifier and a name (so it would otherwise be mis-stubbed as a NAMED
    // export, leaving `hasDefaultExport` unset). Covers `export default <expr>`
    // (ExportAssignment) plus default function/class declarations, named or not.
    if (
      ts.isExportAssignment(stmt) ||
      ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
        hasModifier(stmt, ts.SyntaxKind.DefaultKeyword))
    ) {
      hasDefaultExport = true
      continue
    }

    // `export const NAME = ...` and `export let NAME = ...`
    if (ts.isVariableStatement(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
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
      hasModifier(stmt, ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export class NAME {}`
    if (
      ts.isClassDeclaration(stmt) &&
      hasModifier(stmt, ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export enum NAME {}` (incl. `export const enum`) — a runtime value like a
    // const, so its outward name is stubbed (not silently dropped).
    if (ts.isEnumDeclaration(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export { a, b }` / `export { a as b } from './x.js'` / `export * from './x.js'`
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        // Named (re-)exports have statically-known outward names — stub each,
        // dropping any `from './x.js'` (so the source module never enters the
        // SSR graph). `spec.name` is the OUTWARD name for `a as b`.
        for (const spec of stmt.exportClause.elements) namedExports.push(spec.name.text)
      } else if (stmt.moduleSpecifier) {
        // `export * from './x.js'` — names can't be enumerated, so can't be stubbed.
        warnings.push(
          "[llui/use-client] `export * from '...'` cannot be stubbed (its re-exported names aren't statically known); it is dropped from the SSR output, so any value it re-exports will be undefined during SSR. Move the 'use client' directive to the source module.",
        )
      }
      continue
    }

    // Type-only statements are erased at runtime — nothing to stub.
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue

    // Imports, `import type`, non-exported enums, plain (non-export)
    // variable statements — dropped from the stub output.
  }

  // Build the generated module source. `__clientOnlyStub` lives on
  // `@llui/dom/internal` (not the root barrel) so the vite-plugin's
  // post-bundle rename pass can't rewrite the identifier across a
  // module-external import boundary. See @llui/compiler/emit-names.ts
  // § COMPILER_DOM_INTERNAL_IMPORTS for the contract.
  const lines: string[] = ["import { __clientOnlyStub } from '@llui/dom/internal'", '']
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
