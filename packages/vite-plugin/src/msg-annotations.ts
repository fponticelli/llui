import ts from 'typescript'

export type DispatchMode = 'shared' | 'human-only' | 'agent-only'

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  dispatchMode: DispatchMode
}

const DEFAULT: MessageAnnotations = {
  intent: null,
  alwaysAffordable: false,
  requiresConfirm: false,
  dispatchMode: 'shared',
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
 *   @humanOnly       — sugar for dispatchMode: 'human-only'
 *   @agentOnly       — sugar for dispatchMode: 'agent-only'
 *
 * Unknown tags are ignored; malformed @intent (no quoted string) is
 * treated as "no intent". `@humanOnly` and `@agentOnly` are mutually
 * exclusive — if both are present (which the ESLint rule
 * `agent-exclusive-annotations` reports as an error), the parser
 * falls back to `'shared'` so a misconfigured Msg variant doesn't
 * silently lock out one audience.
 */
export function extractMsgAnnotations(
  source: string,
  /**
   * Name of the type alias to extract from. Defaults to `'Msg'` for
   * convention. Passed by the cross-file resolver when the alias has
   * been renamed through imports/re-exports — its local name in the
   * declaring file may differ from `'Msg'`.
   */
  typeName: string = 'Msg',
): Record<string, MessageAnnotations> | null {
  const sf = ts.createSourceFile('msg.ts', source, ts.ScriptTarget.Latest, true)
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const named = aliases.find((a) => a.name.text === typeName)
  // Fallback: only when looking for the conventional 'Msg' name AND the
  // file has no `type Msg = …`; pick any union type alias. With an
  // explicit `typeName` from the resolver, we don't fall back — that
  // would silently match the wrong alias.
  const alias =
    named ?? (typeName === 'Msg' ? aliases.find((a) => ts.isUnionTypeNode(a.type)) : undefined)
  if (!alias || !ts.isUnionTypeNode(alias.type)) return null

  const result: Record<string, MessageAnnotations> = {}
  const types = alias.type.types
  for (let i = 0; i < types.length; i++) {
    const member = types[i]
    if (member === undefined || !ts.isTypeLiteralNode(member)) continue
    const variant = readDiscriminantLiteral(member)
    if (!variant) continue
    // Leading JSDoc for union member i is scanned from the end of the
    // previous element (or union.pos for the first member), because
    // TypeScript's parser places comment ranges relative to the token
    // that follows them — and the | bar is not part of the TypeLiteralNode.
    const prev = types[i - 1]
    const scanPos = i === 0 || prev === undefined ? alias.type.pos : prev.end
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
  const human = /@humanOnly\b/.test(comment)
  const agent = /@agentOnly\b/.test(comment)
  // Mutual-exclusion fallback: both tags present means a config bug;
  // the ESLint rule reports it. At parse time, default to 'shared' so
  // we don't silently lock out one audience based on tag order.
  const dispatchMode: DispatchMode =
    human && !agent ? 'human-only' : agent && !human ? 'agent-only' : 'shared'
  return {
    intent,
    alwaysAffordable: /@alwaysAffordable\b/.test(comment),
    requiresConfirm: /@requiresConfirm\b/.test(comment),
    dispatchMode,
  }
}

function readIntent(comment: string): string | null {
  const match = comment.match(/@intent\s*\(\s*["\u201c]([^"\u201d]*)["\u201d]\s*\)/)
  return match?.[1] ?? null
}
