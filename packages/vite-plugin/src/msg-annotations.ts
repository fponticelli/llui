import ts from 'typescript'

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

const DEFAULT: MessageAnnotations = {
  intent: null,
  alwaysAffordable: false,
  requiresConfirm: false,
  humanOnly: false,
}

/**
 * Walk a Msg-like discriminated-union type alias and extract JSDoc
 * annotations attached to each union member. Returns null if no
 * recognizable union is found so callers can skip emission cleanly.
 *
 * Expected JSDoc grammar (order-independent):
 *   @intent("human readable")
 *   @alwaysAffordable
 *   @requiresConfirm
 *   @humanOnly
 *
 * Unknown tags are ignored; malformed @intent (no quoted string) is
 * treated as "no intent". The four flags are booleans; any occurrence
 * of the tag sets it true.
 */
export function extractMsgAnnotations(source: string): Record<string, MessageAnnotations> | null {
  const sf = ts.createSourceFile('msg.ts', source, ts.ScriptTarget.Latest, true)
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const named = aliases.find((a) => a.name.text === 'Msg')
  const alias = named ?? aliases.find((a) => ts.isUnionTypeNode(a.type))
  if (!alias || !ts.isUnionTypeNode(alias.type)) return null

  const result: Record<string, MessageAnnotations> = {}
  const types = alias.type.types
  for (let i = 0; i < types.length; i++) {
    const member = types[i]
    if (!ts.isTypeLiteralNode(member)) continue
    const variant = readDiscriminantLiteral(member)
    if (!variant) continue
    // Leading JSDoc for union member i is scanned from the end of the
    // previous element (or union.pos for the first member), because
    // TypeScript's parser places comment ranges relative to the token
    // that follows them — and the | bar is not part of the TypeLiteralNode.
    const scanPos = i === 0 ? alias.type.pos : types[i - 1].end
    const comment = readLeadingJSDoc(source, scanPos)
    result[variant] = parseAnnotations(comment)
  }
  return Object.keys(result).length === 0 ? null : result
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

function parseAnnotations(comment: string): MessageAnnotations {
  if (!comment) return { ...DEFAULT }
  const intent = readIntent(comment)
  return {
    intent,
    alwaysAffordable: /@alwaysAffordable\b/.test(comment),
    requiresConfirm: /@requiresConfirm\b/.test(comment),
    humanOnly: /@humanOnly\b/.test(comment),
  }
}

function readIntent(comment: string): string | null {
  const match = comment.match(/@intent\s*\(\s*["\u201c]([^"\u201d]*)["\u201d]\s*\)/)
  return match ? match[1] : null
}
