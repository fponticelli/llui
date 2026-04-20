import ts from 'typescript'
import type { LintViolation } from '../index.js'

/**
 * Rule: agent-exclusive-annotations
 *
 * @humanOnly is mutually exclusive with @requiresConfirm and
 * @alwaysAffordable. Warns when both appear on the same variant.
 */
export function checkAgentExclusiveTags(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
  source: string,
): void {
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== 'Msg') continue
    if (!ts.isUnionTypeNode(stmt.type)) continue

    const types = stmt.type.types
    for (let i = 0; i < types.length; i++) {
      const member = types[i]
      if (member === undefined || !ts.isTypeLiteralNode(member)) continue

      const variant = readDiscriminantLiteral(member)
      if (!variant) continue

      const prev = types[i - 1]
      const scanPos = i === 0 || prev === undefined ? stmt.type.pos : prev.end
      const comment = readLeadingJSDoc(source, scanPos)

      const humanOnly = /@humanOnly\b/.test(comment)
      if (!humanOnly) continue

      const hasRequiresConfirm = /@requiresConfirm\b/.test(comment)
      const hasAlwaysAffordable = /@alwaysAffordable\b/.test(comment)

      const conflicts: string[] = []
      if (hasRequiresConfirm) conflicts.push('@requiresConfirm')
      if (hasAlwaysAffordable) conflicts.push('@alwaysAffordable')

      if (conflicts.length === 0) continue

      const conflictList = conflicts.join(' and ')
      const { line, character } = sf.getLineAndCharacterOfPosition(member.getStart(sf))
      violations.push({
        rule: 'agent-exclusive-annotations',
        message: `Msg variant "${variant}" has @humanOnly combined with ${conflictList}; @humanOnly dominates and makes the other redundant.`,
        file: filename,
        line: line + 1,
        column: character + 1,
      })
    }
  }
}

function readDiscriminantLiteral(lit: ts.TypeLiteralNode): string | null {
  for (const m of lit.members) {
    if (!ts.isPropertySignature(m)) continue
    if (!m.name || !ts.isIdentifier(m.name) || m.name.text !== 'type') continue
    if (!m.type || !ts.isLiteralTypeNode(m.type)) continue
    const literal = m.type.literal
    if (ts.isStringLiteral(literal)) return literal.text
  }
  return null
}

function readLeadingJSDoc(source: string, scanPos: number): string {
  const ranges = ts.getLeadingCommentRanges(source, scanPos) ?? []
  const docs = ranges
    .filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    .map((r) => source.slice(r.pos, r.end))
    .filter((txt) => txt.startsWith('/**'))
  return docs.join('\n')
}
