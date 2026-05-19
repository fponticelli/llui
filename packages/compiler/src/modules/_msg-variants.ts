// Shared helper for agent-protocol rules that iterate Msg union
// variants and inspect leading JSDoc-style comments on each. The
// compiler doesn't run typed-lint, so "is this a Msg union?" detection
// uses simpler heuristics:
//
//   1. Type alias literally named `Msg`.
//   2. Any type-alias whose name appears as the SECOND generic argument
//      of a `component<S, Msg, E>()` call in the same file.
//
// File-local only. Cross-file Msg detection would need the cross-file
// resolver; for the v1 of these rules we accept the file-local scope
// (matches the original Vite-plugin diagnostic).
//
// Each variant callback receives:
//   - `variant`: the discriminant string (the `type: '...'` literal).
//   - `node`: the TypeLiteral AST node for the variant.
//   - `leadingCommentText`: the source slice between the previous
//     variant's end (or the alias start) and this variant's start.
//     Includes JSDoc blocks, `|` tokens, and whitespace; regex-match
//     against it the same way the ESLint rules did.

import ts from 'typescript'

export interface MsgVariant {
  variant: string
  node: ts.TypeLiteralNode
  leadingCommentText: string
}

function readDiscriminantLiteral(typeLit: ts.TypeLiteralNode): string | null {
  for (const m of typeLit.members) {
    if (!ts.isPropertySignature(m)) continue
    if (!m.name || !ts.isIdentifier(m.name) || m.name.text !== 'type') continue
    const ann = m.type
    if (!ann || !ts.isLiteralTypeNode(ann)) continue
    const lit = ann.literal
    if (ts.isStringLiteral(lit)) return lit.text
  }
  return null
}

/** Names of type aliases that appear as the 2nd generic arg of `component<S,M,E>()`. */
function collectComponentMsgArgNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'component' &&
      n.typeArguments &&
      n.typeArguments.length >= 2
    ) {
      const msgArg = n.typeArguments[1]!
      if (ts.isTypeReferenceNode(msgArg) && ts.isIdentifier(msgArg.typeName)) {
        out.add(msgArg.typeName.text)
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return out
}

export function forEachMsgVariant(sf: ts.SourceFile, callback: (v: MsgVariant) => void): void {
  const componentMsgNames = collectComponentMsgArgNames(sf)
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    const aliasName = stmt.name.text
    if (aliasName !== 'Msg' && !componentMsgNames.has(aliasName)) continue
    const ann = stmt.type
    if (!ts.isUnionTypeNode(ann)) continue
    let prevEnd = stmt.getStart(sf)
    for (const member of ann.types) {
      if (!ts.isTypeLiteralNode(member)) {
        prevEnd = member.getEnd()
        continue
      }
      const variant = readDiscriminantLiteral(member)
      if (!variant) {
        prevEnd = member.getEnd()
        continue
      }
      const leadingCommentText = sf.text.slice(prevEnd, member.getStart(sf))
      callback({ variant, node: member, leadingCommentText })
      prevEnd = member.getEnd()
    }
  }
}

/** Variant has at least one property beyond `type`. */
export function variantHasPayload(node: ts.TypeLiteralNode): boolean {
  for (const m of node.members) {
    if (!ts.isPropertySignature(m)) continue
    if (!m.name || !ts.isIdentifier(m.name)) continue
    if (m.name.text === 'type') continue
    return true
  }
  return false
}
