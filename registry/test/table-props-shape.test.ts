import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * #264 review item 5: `registry/llui/ui/table.ts` used to export a
 * hand-rolled `TableProps` type — a `viewport?: ElProps` option folded into
 * the same prop bag as every DOM attribute, which needed a template-literal
 * `on*` pattern index signature (two `any`s, both carrying an
 * eslint-disable) just to reject a bogus handler value the way
 * `TableRow`/plain `ElProps` do for free. It also shipped a
 * compile-time-only `_tableTypeGate` INSIDE the file `llui add table`
 * copies into a consumer app — test code with no business being there.
 *
 * `Table`/`TableContainer` are now plain `classPart(...)` results, identical
 * in shape to `TableRow`/`TableCell`/etc, so the precise typing is inherited
 * structurally rather than hand-rolled — there is nothing left to gate with
 * a `@ts-expect-error`. This test instead pins the STRUCTURE that makes that
 * true, via a real TypeScript AST walk (not a text search, so a comment
 * mentioning "TableProps" in prose cannot fool it in either direction): no
 * `TableProps` type/interface exists, and `Table`/`TableContainer` are each a
 * DIRECT `classPart(...)` call — not a custom function wrapping one, which
 * is exactly the shape that reopens the hole (a wrapper function needs its
 * own prop type, and a hand-rolled one is how the catch-all regressed once
 * already, #264 item 2).
 *
 * This lives in `registry/test/`, not `registry/llui/`, on purpose: nothing
 * compiles `registry/test/**` with `tsc` (`registry/tsconfig.json` includes
 * only `llui`), so a `@ts-expect-error` compile gate placed here would be
 * silently inert under `pnpm --filter @llui/registry check` — exactly the
 * vacuous-test trap this repo's own mutation-testing guidance warns about.
 * A real vitest assertion, run by `pnpm --filter @llui/registry test`, is
 * what actually executes.
 */
const source = readFileSync(resolve(import.meta.dirname, '../llui/ui/table.ts'), 'utf8')
const sf = ts.createSourceFile('table.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function findTopLevelTypeOrInterfaceNames(): string[] {
  const names: string[] = []
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      names.push(stmt.name.text)
    }
  }
  return names
}

function classPartExportNames(): string[] {
  const names: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer !== undefined &&
        ts.isCallExpression(decl.initializer) &&
        ts.isIdentifier(decl.initializer.expression) &&
        decl.initializer.expression.text === 'classPart'
      ) {
        names.push(decl.name.text)
      }
    }
  }
  return names
}

describe('registry table.ts prop-bag shape (#264 review item 5)', () => {
  it('declares no hand-rolled TableProps type/interface', () => {
    expect(findTopLevelTypeOrInterfaceNames()).not.toContain('TableProps')
  })

  it('Table and TableContainer are each a direct classPart(...) result, like every sibling part', () => {
    const direct = classPartExportNames()
    expect(direct).toContain('Table')
    expect(direct).toContain('TableContainer')
  })

  it('never re-introduces an `any`-typed index signature anywhere in the file', () => {
    // A structural, not textual, ban: an inline comment explaining why `any`
    // must NOT appear would itself contain the word and false-positive a
    // plain substring search — walk for a real `AnyKeyword` type node.
    let hasAny = false
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) hasAny = true
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(hasAny).toBe(false)
  })
})
