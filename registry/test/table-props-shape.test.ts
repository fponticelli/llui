import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * #264 review item 3: `registry/llui/ui/table.ts` had drifted BACK to a
 * `TableContainer` + `Table` two-export split (twice — see the file's own
 * header). shadcn ships exactly one `Table` component, and the split makes a
 * registry consumer responsible for remembering to nest `TableContainer`
 * around `Table` correctly, which the machine's own docs and both
 * first-party demos never actually needed once the typing concern that
 * motivated the split is resolved properly (a plain intersection type, not
 * `interface X extends ElProps` or a widened `Record<string,
 * unknown>`/`any` index signature).
 *
 * This pins the restored shape via a real TypeScript AST walk (not a text
 * search, so a comment mentioning "TableContainer" in prose cannot fool it
 * in either direction):
 *   - exactly ONE exported table-root helper (`Table`), no `TableContainer`
 *   - `Table` is a real function (not a `classPart(...)` result — it needs
 *     its own `viewport` option), taking a precisely-typed `TableProps`
 *   - `TableProps` is `ElProps & { viewport?: ... }`, never an `extends`
 *     interface (which silently drops `ElProps`'s index signature) and
 *     never a bare object-literal type with its OWN index signature
 *     (which is what forces the `any`/`unknown` widening back in)
 *   - no `any` anywhere in the file, structurally (an `AnyKeyword` node),
 *     never a substring search a comment about `any` could false-positive
 */
const source = readFileSync(resolve(import.meta.dirname, '../llui/ui/table.ts'), 'utf8')
const sf = ts.createSourceFile('table.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function topLevelExportedNames(): string[] {
  const names: string[] = []
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      const isExported =
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      if (!isExported) continue
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text)
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
      const isExported =
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      if (isExported) names.push(stmt.name.text)
    }
  }
  return names
}

function findTableFunctionDeclaration(): ts.FunctionDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'Table') return stmt
  }
  return undefined
}

function findTypeAlias(name: string): ts.TypeAliasDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) return stmt
  }
  return undefined
}

function findInterface(name: string): ts.InterfaceDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt
  }
  return undefined
}

describe('registry table.ts is a single Table export (#264 review item 3)', () => {
  it('exports exactly one table-root helper, no TableContainer', () => {
    const names = topLevelExportedNames()
    expect(names).toContain('Table')
    expect(names).not.toContain('TableContainer')
  })

  it('Table is a real function declaration (not a classPart(...) result)', () => {
    expect(findTableFunctionDeclaration()).toBeDefined()
  })

  it('declares TableProps as an intersection type, never an extended interface', () => {
    expect(findInterface('TableProps')).toBeUndefined()
    const alias = findTypeAlias('TableProps')
    expect(alias).toBeDefined()
    expect(alias !== undefined && ts.isIntersectionTypeNode(alias.type)).toBe(true)
  })

  it('TableProps has a viewport field and no bare object-literal index signature of its own', () => {
    const alias = findTypeAlias('TableProps')
    expect(alias).toBeDefined()
    if (alias === undefined || !ts.isIntersectionTypeNode(alias.type)) return
    let hasViewportField = false
    let hasOwnIndexSignature = false
    for (const member of alias.type.types) {
      if (!ts.isTypeLiteralNode(member)) continue
      for (const m of member.members) {
        if (ts.isIndexSignatureDeclaration(m)) hasOwnIndexSignature = true
        if (ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'viewport') {
          hasViewportField = true
        }
      }
    }
    expect(hasViewportField).toBe(true)
    // The intersection's OWN literal must not carry an index signature — that
    // is exactly the widening (`Record<string, unknown>` / `any`) this test
    // exists to keep out. `ElProps`'s index signature lives in ITS OWN
    // declaration (a separate type this file only references), never here.
    expect(hasOwnIndexSignature).toBe(false)
  })

  it('never re-introduces an `any` type anywhere in the file', () => {
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

  it('never casts with `as` anywhere in the file', () => {
    let hasCast = false
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) hasCast = true
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(hasCast).toBe(false)
  })
})
