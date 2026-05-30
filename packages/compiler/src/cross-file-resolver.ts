import ts from 'typescript'
import { type MessageAnnotations, type DispatchMode as MessageDispatchMode } from '@llui/compiler'
import {
  type MsgSchema,
  type MsgField,
  type TypeIndex,
  buildFieldDescriptor,
  extractMsgSchema,
  extractEffectSchema,
} from './msg-schema.js'
import { extractStateSchema } from './state-schema.js'
import { extractMsgAnnotations } from './msg-annotations.js'

/**
 * Resolved external type sources for the file under analysis: the source
 * string + local alias name for each of the `State` / `Msg` / `Effect`
 * type arguments that the host adapter (vite-plugin) chased to their
 * declaring file via `findTypeSource`. The schema/annotation extractors
 * run against these instead of the focal file when the alias lives
 * elsewhere. All fields optional — absent ones fall back to file-local
 * extraction.
 */
export interface ExternalTypeSources {
  state?: { source: string; typeName: string }
  msg?: { source: string; typeName: string }
  effect?: { source: string; typeName: string }
}

/**
 * Schemas already extracted by the adapter's async cross-file /
 * composition-aware hook before invoking the signal transform. Used when
 * the file-local sync extractors can't see the whole picture — the
 * Msg/Effect/State alias lives in another file, or the union composes
 * inline literals with imported TypeReferences. When provided, the
 * transform uses these instead of running its own file-local extractors.
 */
export interface PreExtractedSchemas {
  msgSchema?: ReturnType<typeof extractMsgSchema>
  msgAnnotations?: ReturnType<typeof extractMsgAnnotations>
  stateSchema?: ReturnType<typeof extractStateSchema>
  effectSchema?: ReturnType<typeof extractEffectSchema>
}

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
  //    { X }` — the import already declares X locally, so step 5 picks
  //    it up.

  // 4. Star re-exports: `export * from './y'`. The barrel re-exports
  //    every named member of `./y` under the same name. Walk each
  //    barrel target and return the first hit. Order: textual order
  //    in the source file (matches TypeScript's behaviour for
  //    multi-barrel name collisions, where the first declared wins).
  //
  //    Multiple `export *` declarations are common in monorepo barrel
  //    files (`export * from './msg'; export * from './effects'`).
  //    Without this step, the resolver returns `null` and the plugin
  //    silently emits empty annotations for any consumer that points
  //    at a barrel.
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue
    // `export * from './y'` has no exportClause; `export {} from './y'`
    // is a different beast (re-exports nothing). Skip the latter.
    if (stmt.exportClause) continue
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue

    const resolved = await ctx.resolveModule(stmt.moduleSpecifier.text, filePath)
    if (!resolved) continue
    let subSource: string
    try {
      subSource = await ctx.readSource(resolved)
    } catch {
      // Module path resolved but the file isn't readable (deleted,
      // dynamic-only, etc.). Continue to the next barrel.
      continue
    }
    const found = await findTypeSource(typeName, subSource, resolved, ctx, visited)
    if (found) return found
  }

  // 5. Imports: `import { X } from './y'` or `import { X as Y } from './y'`.
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

  const sf = ts.createSourceFile(located.filePath, located.source, ts.ScriptTarget.Latest, true)
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
    examples: readExamplesTag(comment),
    warning: readWarningTag(comment),
    emits: readEmitsTag(comment),
    routeGate: readRouteGateTag(comment),
  }
}

function readRouteGateTag(comment: string): string | null {
  const match = comment.match(/@routeGated\s*\(\s*["“]([^"”]*)["”]\s*\)/)
  return match?.[1] ?? null
}

function readEmitsTag(comment: string): string[] {
  const outer = comment.match(/@emits\s*\(([^)]*)\)/)
  if (!outer || outer[1] === undefined) return []
  const inner = outer[1]
  const seen = new Set<string>()
  const out: string[] = []
  const re = /["“]([^"”]*)["”]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    const v = m[1]
    if (v === undefined || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function readExamplesTag(comment: string): string[] {
  const out: string[] = []
  const re = /@example\s*\(\s*["“]([^"”]*)["”]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(comment)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

function readWarningTag(comment: string): string | null {
  const match = comment.match(/@warning\s*\(\s*["“]([^"”]*)["”]\s*\)/)
  return match?.[1] ?? null
}

function defaultMessageAnnotations(): MessageAnnotations {
  return {
    intent: null,
    alwaysAffordable: false,
    requiresConfirm: false,
    dispatchMode: 'shared',
    examples: [],
    warning: null,
    emits: [],
    routeGate: null,
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

  const sf = ts.createSourceFile(located.filePath, located.source, ts.ScriptTarget.Latest, true)
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const alias = aliases.find((a) => a.name.text === located.localName)
  if (!alias) return false

  const memberNodes: ts.TypeNode[] = ts.isUnionTypeNode(alias.type)
    ? [...alias.type.types]
    : [alias.type]

  // Build a typeIndex that combines this file's local types with any
  // *imported* type aliases referenced inside the variant payloads.
  // Without this enrichment, a field typed as `GridSorting` (declared
  // in `./state.ts` and imported here) would resolve to `'unknown'`
  // because the local index doesn't know about it. The synthesizer
  // would then emit `null` and the agent would have to guess at the
  // permissible literal-union values.
  const typeIndex = await buildEnrichedTypeIndex(sf, located.source, located.filePath, ctx)

  for (const member of memberNodes) {
    if (ts.isTypeLiteralNode(member)) {
      collectOneVariant(member, variants, located.source, typeIndex)
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

function collectOneVariant(
  lit: ts.TypeLiteralNode,
  variants: MsgSchema['variants'],
  source: string,
  typeIndex: TypeIndex,
): void {
  let discriminantValue: string | null = null
  const fields: Record<string, MsgField> = {}
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
    fields[name] = buildFieldDescriptor(member, source, typeIndex)
  }
  if (discriminantValue && variants[discriminantValue] === undefined) {
    variants[discriminantValue] = fields
  }
}

/**
 * Build a TypeIndex that includes the locally-declared types in `sf`
 * AND any types imported by name into `sf`. Following the imports
 * picks up sibling-file aliases like `GridSorting`, `ScoreMode`,
 * `ConfirmRequest` that an app commonly extracts to a state module.
 *
 * Limitations:
 *  - Only follows direct named imports (`import type { X } from './y'`).
 *    Namespace imports and `export *` aren't followed (the lint rule
 *    `agent-msg-resolvable` already catches the namespace case).
 *  - The resolved external type must itself be a type alias or
 *    interface in the target file — chained re-exports beyond the first
 *    hop fall back to `'unknown'`.
 *  - Best-effort: any failure to resolve an import is silent. The
 *    field type just stays `'unknown'` as it would have without
 *    enrichment.
 */
async function buildEnrichedTypeIndex(
  sf: ts.SourceFile,
  source: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<TypeIndex> {
  const index: TypeIndex = new Map()

  // 1. Locally-declared aliases / interfaces.
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) {
      index.set(stmt.name.text, stmt.type)
    } else if (ts.isInterfaceDeclaration(stmt)) {
      index.set(stmt.name.text, stmt)
    }
  }

  // 2. Walk imports transitively. Each file's named imports are
  //    resolved, the target declarations are added to the index under
  //    their local name, and the target's OWN file is then queued so
  //    its imports are followed too. This is what makes
  //    `Matrix/AddCriteria.criteria[].type.ease` resolve all the way
  //    to its discriminated-union descriptor: `Criterion` is imported
  //    from `@decisive/domain`, and `EaseFunction` is in turn imported
  //    by Criterion's home file. Without transitivity the inner types
  //    collapse to `'unknown'` and the agent has to guess the shape.
  //
  //    Type-only imports (`import type { X }`) are followed exactly
  //    the same as value imports — TypeScript's `isTypeOnly` flag
  //    doesn't change the referent.
  //
  //    Name collisions are first-write-wins: a local declaration
  //    shadows an imported one of the same name, and the first
  //    transitively-discovered import wins over later same-name
  //    imports. Intentional — root files almost always import the
  //    canonical name, and shallower-import names are more likely
  //    correct than deep-import collisions.
  const fileQueue: Array<{ source: string; filePath: string; sf: ts.SourceFile }> = [
    { source, filePath, sf },
  ]
  const visitedFiles = new Set<string>([filePath])

  while (fileQueue.length > 0) {
    const cur = fileQueue.shift()
    if (!cur) break

    // Add this file's *own* local type declarations to the index so
    // sibling references inside the file's exported types resolve.
    // Without this, a Criterion in domain.ts referencing EaseMode
    // (declared right next to it) would collapse to 'unknown' even
    // though we already followed the import chain to domain.ts.
    // First-write-wins: a local declaration in the entry file
    // shadows a same-named declaration in a transitively-walked
    // file (intentional — entry-file names are canonical).
    if (cur.filePath !== filePath) {
      for (const stmt of cur.sf.statements) {
        if (ts.isTypeAliasDeclaration(stmt)) {
          if (!index.has(stmt.name.text)) index.set(stmt.name.text, stmt.type)
        } else if (ts.isInterfaceDeclaration(stmt)) {
          if (!index.has(stmt.name.text)) index.set(stmt.name.text, stmt)
        }
      }
    }

    for (const stmt of cur.sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue
      const named = stmt.importClause?.namedBindings
      if (!named || !ts.isNamedImports(named)) continue
      for (const spec of named.elements) {
        const localName = spec.name.text
        const importedName = spec.propertyName?.text ?? localName
        if (index.has(localName)) continue
        // Best-effort: any failure to resolve / read silently bails.
        // Bare-specifier imports like `'fs'` resolve to vite's
        // `__vite-browser-external` sentinel, which then ENOENTs at
        // readSource — those imports aren't type-relevant for schema
        // extraction anyway, so the failure is benign.
        let located: ResolvedTypeSource | null
        try {
          located = await findTypeSource(importedName, cur.source, cur.filePath, ctx, new Set())
        } catch {
          located = null
        }
        if (!located) continue
        const targetSf = ts.createSourceFile(
          located.filePath,
          located.source,
          ts.ScriptTarget.Latest,
          true,
        )
        let added = false
        for (const targetStmt of targetSf.statements) {
          if (ts.isTypeAliasDeclaration(targetStmt) && targetStmt.name.text === located.localName) {
            index.set(localName, targetStmt.type)
            added = true
            break
          }
          if (ts.isInterfaceDeclaration(targetStmt) && targetStmt.name.text === located.localName) {
            index.set(localName, targetStmt)
            added = true
            break
          }
        }
        // Queue the target file so its own imports — and own local
        // declarations — flow into the index. Only queue once per file.
        if (added && !visitedFiles.has(located.filePath)) {
          visitedFiles.add(located.filePath)
          fileQueue.push({
            source: located.source,
            filePath: located.filePath,
            sf: targetSf,
          })
        }
      }
    }
  }

  return index
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
export function readComponentTypeArgNames(call: ts.CallExpression): {
  state: string | null
  msg: string | null
  effect: string | null
} {
  const args = call.typeArguments
  const get = (i: number): string | null => {
    const t = args?.[i]
    if (!t) return null
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) return t.typeName.text
    return null
  }
  return { state: get(0), msg: get(1), effect: get(2) }
}
