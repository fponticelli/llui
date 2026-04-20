import ts from 'typescript'
import type { LintViolation } from '../index.js'

/**
 * Rule: agent-missing-intent
 *
 * Warns when a Msg union variant has no JSDoc @intent("...") tag.
 * Falls back to a synthesized intent at runtime; the lint catches
 * authoring drift before the agent surface becomes opaque.
 */
export function checkAgentMissingIntent(
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

      // Leading JSDoc for union member i is scanned from the end of the
      // previous element (or union.pos for the first member), mirroring
      // the approach in @llui/vite-plugin/src/msg-annotations.ts.
      const prev = types[i - 1]
      const scanPos = i === 0 || prev === undefined ? stmt.type.pos : prev.end
      const comment = readLeadingJSDoc(source, scanPos)

      // @humanOnly variants are never agent-dispatched, so they don't need
      // an @intent. Skip the check.
      if (hasHumanOnlyTag(comment)) continue

      if (!hasIntentTag(comment)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(member.getStart(sf))
        violations.push({
          rule: 'agent-missing-intent',
          message: `Msg variant "${variant}" is missing @intent("...") — Claude will see a synthesized intent label.`,
          file: filename,
          line: line + 1,
          column: character + 1,
        })
      }
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

function hasIntentTag(comment: string): boolean {
  return /@intent\s*\(\s*["\u201c]([^"\u201d]*)["\u201d]\s*\)/.test(comment)
}

function hasHumanOnlyTag(comment: string): boolean {
  return /@humanOnly\b/.test(comment)
}
