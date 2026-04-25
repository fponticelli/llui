import ts from 'typescript'
import {
  type MessageAnnotations,
  type DispatchMode as MessageDispatchMode,
} from './msg-annotations.js'
import { type MsgSchema, resolveFieldType } from './msg-schema.js'

/**
 * Cross-file type resolver.
 *
 * The schema/annotation extractors (`extractMsgAnnotations`,
 * `extractMsgSchema`, `extractStateSchema`, `extractEffectSchema`) only
 * see the source string for the file currently being transformed. When
 * a developer keeps the `Msg` (or `State` / `Effect`) union in a
 * separate file and imports it where `component()` is called, those
 * extractors silently return `null` — the plugin emits no annotations,
 * runtime LAP validation is disabled, and Claude can dispatch arbitrary
 * `type` strings that fall through to `assertNever`.
 *
 * This module follows imports and re-exports to find the source file
 * that declares the requested type alias, returning that file's source
 * string + the local name of the alias there. Extractors then run
 * against that source and produce the same output they would have for
 * a co-located declaration.
 *
 * Limitations:
 *  - Composition (`type Msg = ImportedA | { type: 'b' }`): only the
 *    locally-declared variants are extracted; the imported half isn't
 *    walked recursively into. The lint rule `agent-msg-resolvable`
 *    catches this case at lint time.
 *  - Namespace imports (`import * as ns from './msg'`) and `export *`:
 *    not followed. Same lint coverage.
 *  - Generic types: not parameterized resolution; the type argument
 *    must resolve to a concrete type alias.
 */

export interface ResolveContext {
  /**
   * Resolve a module specifier (e.g. `'./msg'`, `'@scope/pkg'`) against
   * the importing file's path. Returns the absolute filesystem path of
   * the resolved module, or `null` if it cannot be resolved (the type
   * stays unresolved and the extractor falls back to local-only mode).
   */
  resolveModule: (spec: string, importerPath: string) => Promise<string | null>
  /**
   * Read the source contents of an absolute module path. The contents
   * are parsed by TypeScript so they should be valid TS/TSX. The plugin
   *'s vite hook plumbs `fs/promises.readFile` here; tests provide an
   * in-memory map.
   */
  readSource: (absolutePath: string) => Promise<string>
}

export interface ResolvedTypeSource {
  /** The full source string of the file declaring the type alias. */
  source: string
  /** The local name of the alias *in that file* (after rename chains). */
  localName: string
  /** Absolute path of the file declaring the alias (debug aid). */
  filePath: string
}

/**
 * Walk imports + re-exports to find where a type alias is actually
 * declared. Returns the source string and local name of the alias in
 * its declaring file. Returns `null` if the chain leads to an unresolved
 * module, a re-export through `export *`, a namespace import, or a
 * dead-end (alias not declared anywhere we can see).
 */
export async function findTypeSource(
  typeName: string,
  source: string,
  filePath: string,
  ctx: ResolveContext,
  visited: Set<string> = new Set(),
): Promise<ResolvedTypeSource | null> {
  // Cycle prevention — re-export A → A is a tight loop that some
  // pathological re-export chains can produce. Bail rather than
  // infinitely recurse.
  if (visited.has(`${filePath}::${typeName}`)) return null
  visited.add(`${filePath}::${typeName}`)

  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)

  // 1. Local declaration wins. `type X = ...` or `interface X { ... }`
  //    (extractors only support type aliases today, but check both so
  //    the resolver itself isn't a footgun for future extractors).
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName) {
      return { source, localName: typeName, filePath }
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      return { source, localName: typeName, filePath }
    }
  }

  // 2. Re-export with name: `export { X } from './y'` or
  //    `export { X as Y } from './y'`. Walk to the source module.
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue

    for (const spec of stmt.exportClause.elements) {
      const exportedName = spec.name.text
      if (exportedName !== typeName) continue
      // The name in the source module is `propertyName` if present
      // (e.g. `export { Msg as M } from './msg'` exports as M but the
      // source module has it as Msg).
      const sourceName = spec.propertyName?.text ?? spec.name.text
      const resolved = await ctx.resolveModule(stmt.moduleSpecifier.text, filePath)
      if (!resolved) return null
      const subSource = await ctx.readSource(resolved)
      return findTypeSource(sourceName, subSource, resolved, ctx, visited)
    }
  }

  // 3. Local re-binding: `export { X } from elsewhere` shorthand was
  //    handled above. A separate case is `import { X } from ... ; export
  //    { X }` — the import already declares X locally, so step 4 picks
  //    it up.

  // 4. Imports: `import { X } from './y'` or `import { X as Y } from './y'`.
  //    Walk to the source module using the original (imported) name.
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!stmt.importClause) continue
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue

    const bindings = stmt.importClause.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const elem of bindings.elements) {
      const localName = elem.name.text
      if (localName !== typeName) continue
      // The remote name is `propertyName` when there's a rename, else
      // the local name itself.
      const remoteName = elem.propertyName?.text ?? elem.name.text
      const resolved = await ctx.resolveModule(stmt.moduleSpecifier.text, filePath)
      if (!resolved) return null
      const subSource = await ctx.readSource(resolved)
      return findTypeSource(remoteName, subSource, resolved, ctx, visited)
    }
  }

  // Not found in this file and no import/re-export to follow.
  return null
}

/**
 * Annotation extractor that walks composed Msg unions across files.
 *
 * Given a Msg type that may be a union of inline `{ type: 'literal' }`
 * objects AND TypeReferences (e.g.
 * `type Msg = ImportedFoo | { type: 'extra' }`), recursively follow
 * each TypeReference via `findTypeSource` and merge its variants into
 * the returned map.
 *
 * Composition + cross-file is the union of two failure modes the
 * file-local sync extractor silently mishandles. This function
 * produces the same map the runtime expects regardless of how the
 * developer organized the type declarations.
 *
 * Conflict policy: if two composed branches contribute the same
 * discriminant string (e.g. both halves declare `{ type: 'inc' }`),
 * the first one walked wins. The lint rule `agent-msg-resolvable`
 * fires before this point on most pathological cases; ESLint's
 * type-checker would flag the duplicate independently.
 */
export async function extractMsgAnnotationsCrossFile(
  source: string,
  typeName: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<Record<string, MessageAnnotations> | null> {
  const out: Record<string, MessageAnnotations> = {}
  const ok = await collectMsgVariants(typeName, source, filePath, ctx, out, new Set())
  if (!ok) return null
  return Object.keys(out).length === 0 ? null : out
}

async function collectMsgVariants(
  typeName: string,
  source: string,
  filePath: string,
  ctx: ResolveContext,
  out: Record<string, MessageAnnotations>,
  visitedAliases: Set<string>,
): Promise<boolean> {
  const located = await findTypeSource(typeName, source, filePath, ctx, new Set())
  if (!located) return false

  const aliasKey = `${located.filePath}::${located.localName}`
  if (visitedAliases.has(aliasKey)) return true
  visitedAliases.add(aliasKey)

  const sf = ts.createSourceFile(
    located.filePath,
    located.source,
    ts.ScriptTarget.Latest,
    true,
  )
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const alias = aliases.find((a) => a.name.text === located.localName)
  if (!alias) return false

  // Single-variant alias: `type Foo = { type: 'a', ... }`. Treat as a
  // one-element union so a Msg variant can be its own type alias.
  const memberNodes: ts.TypeNode[] = ts.isUnionTypeNode(alias.type)
    ? [...alias.type.types]
    : [alias.type]

  for (let i = 0; i < memberNodes.length; i++) {
    const member = memberNodes[i]!

    if (ts.isTypeLiteralNode(member)) {
      const variant = readDiscriminantLiteral(member)
      if (!variant) continue
      const comment = readLeadingJSDocForMember(located.source, alias, memberNodes, i)
      if (out[variant] === undefined) {
        out[variant] = parseMessageAnnotations(comment)
      }
      continue
    }

    if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
      // Composed: recurse through the resolver.
      await collectMsgVariants(
        member.typeName.text,
        located.source,
        located.filePath,
        ctx,
        out,
        visitedAliases,
      )
      continue
    }

    // Other shapes (intersections, conditional types, namespace-qualified
    // names) aren't followed. Lint catches this.
  }

  return true
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

/**
 * Read leading JSDoc for a union member at index `i` of `members`.
 * The JSDoc lives between the previous element's end and the current
 * element's start (or between the type alias start and the first
 * element for `i === 0`). Mirrors the logic in
 * `extractMsgAnnotations` so the cross-file path produces the same
 * output for the same input.
 */
function readLeadingJSDocForMember(
  source: string,
  alias: ts.TypeAliasDeclaration,
  members: ts.TypeNode[],
  i: number,
): string {
  const prev = members[i - 1]
  const member = members[i]!
  // For non-union (single-variant) aliases the union pos is the alias
  // body's pos.
  const unionPos = ts.isUnionTypeNode(alias.type) ? alias.type.pos : alias.type.pos
  const scanPos = i === 0 || prev === undefined ? unionPos : prev.end
  const ranges = ts.getLeadingCommentRanges(source, scanPos) ?? []
  const docs = ranges
    .filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    .map((r) => source.slice(r.pos, r.end))
    .filter((txt) => txt.startsWith('/**'))
  // Cut off comments that appear AFTER the member starts (rare but
  // possible with weird formatting).
  const _end = member.pos
  return docs.join('\n')
}

function parseMessageAnnotations(comment: string): MessageAnnotations {
  if (!comment) return defaultMessageAnnotations()
  const intent = readIntentTag(comment)
  const human = /@humanOnly\b/.test(comment)
  const agent = /@agentOnly\b/.test(comment)
  const dispatchMode: MessageDispatchMode =
    human && !agent ? 'human-only' : agent && !human ? 'agent-only' : 'shared'
  return {
    intent,
    alwaysAffordable: /@alwaysAffordable\b/.test(comment),
    requiresConfirm: /@requiresConfirm\b/.test(comment),
    dispatchMode,
  }
}

function defaultMessageAnnotations(): MessageAnnotations {
  return {
    intent: null,
    alwaysAffordable: false,
    requiresConfirm: false,
    dispatchMode: 'shared',
  }
}

function readIntentTag(comment: string): string | null {
  const match = comment.match(/@intent\s*\(\s*["“]([^"”]*)["”]\s*\)/)
  return match?.[1] ?? null
}

/**
 * Cross-file companion to `extractMsgSchema` / `extractEffectSchema`.
 *
 * Discriminated-union schema extractor that follows composed
 * TypeReferences through the resolver. Same recursion shape as
 * `extractMsgAnnotationsCrossFile`, just collecting field shapes
 * instead of JSDoc annotations.
 */
export async function extractDiscriminatedUnionSchemaCrossFile(
  source: string,
  typeName: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<MsgSchema | null> {
  const variants: MsgSchema['variants'] = {}
  const ok = await collectSchemaVariants(typeName, source, filePath, ctx, variants, new Set())
  if (!ok) return null
  return Object.keys(variants).length === 0 ? null : { discriminant: 'type', variants }
}

async function collectSchemaVariants(
  typeName: string,
  source: string,
  filePath: string,
  ctx: ResolveContext,
  variants: MsgSchema['variants'],
  visitedAliases: Set<string>,
): Promise<boolean> {
  const located = await findTypeSource(typeName, source, filePath, ctx, new Set())
  if (!located) return false

  const aliasKey = `${located.filePath}::${located.localName}`
  if (visitedAliases.has(aliasKey)) return true
  visitedAliases.add(aliasKey)

  const sf = ts.createSourceFile(
    located.filePath,
    located.source,
    ts.ScriptTarget.Latest,
    true,
  )
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const alias = aliases.find((a) => a.name.text === located.localName)
  if (!alias) return false

  const memberNodes: ts.TypeNode[] = ts.isUnionTypeNode(alias.type)
    ? [...alias.type.types]
    : [alias.type]

  for (const member of memberNodes) {
    if (ts.isTypeLiteralNode(member)) {
      collectOneVariant(member, variants)
      continue
    }
    if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
      await collectSchemaVariants(
        member.typeName.text,
        located.source,
        located.filePath,
        ctx,
        variants,
        visitedAliases,
      )
      continue
    }
  }
  return true
}

function collectOneVariant(lit: ts.TypeLiteralNode, variants: MsgSchema['variants']): void {
  let discriminantValue: string | null = null
  const fields: Record<string, string | { enum: string[] }> = {}
  for (const member of lit.members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue
    const name = member.name.text
    const memberType = member.type
    if (name === 'type' && memberType) {
      if (ts.isLiteralTypeNode(memberType) && ts.isStringLiteral(memberType.literal)) {
        discriminantValue = memberType.literal.text
      }
      continue
    }
    if (!memberType) {
      fields[name] = 'unknown'
      continue
    }
    fields[name] = resolveFieldType(memberType)
  }
  if (discriminantValue && variants[discriminantValue] === undefined) {
    variants[discriminantValue] = fields
  }
}

/**
 * Inspect the type arguments of a `component<...>()` call and return
 * the textual identifier for each known position. Returns `null` for
 * positions whose type argument isn't a plain identifier (e.g.
 * inline literal types, generic instantiations, namespace-qualified
 * names). Identifiers are what the resolver can chase; everything else
 * we leave to the local extractor's existing behavior.
 *
 * Order: `[State, Msg, Effect]` matching `component<State, Msg, Effect>`.
 */
export function readComponentTypeArgNames(
  call: ts.CallExpression,
): { state: string | null; msg: string | null; effect: string | null } {
  const args = call.typeArguments
  const get = (i: number): string | null => {
    const t = args?.[i]
    if (!t) return null
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) return t.typeName.text
    return null
  }
  return { state: get(0), msg: get(1), effect: get(2) }
}
