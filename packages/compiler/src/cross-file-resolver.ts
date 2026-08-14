import ts from 'typescript'
import { type MessageAnnotations } from './msg-annotations.js'
import {
  type MsgSchema,
  type MsgField,
  type TypeIndex,
  buildFieldDescriptor,
  extractMsgSchema,
  extractEffectSchema,
} from './msg-schema.js'
import { extractStateSchema } from './state-schema.js'
import { extractMsgAnnotations, parseAnnotations } from './msg-annotations.js'
import type { ModuleCache, ParsedModule } from './parse.js'
import { unwrapParenthesizedType } from './union-peel.js'

/**
 * Resolved external type sources for the file under analysis: the declaring
 * MODULE (already parsed — the extractors reuse that tree rather than re-parsing
 * the sibling, #93) + local alias name for each of the `State` / `Msg` / `Effect`
 * type arguments that the host adapter (vite-plugin) chased to their
 * declaring file via `findTypeSource`. The schema/annotation extractors
 * run against these instead of the focal file when the alias lives
 * elsewhere. All fields optional — absent ones fall back to file-local
 * extraction.
 */
export interface ExternalTypeSources {
  state?: { module: ParsedModule; typeName: string }
  msg?: { module: ParsedModule; typeName: string }
  effect?: { module: ParsedModule; typeName: string }
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
 * Everything the adapter resolved from sibling files for ONE
 * `component<State, Msg, Effect>` type-argument tuple.
 */
export interface CrossFileResolution {
  typeSources?: ExternalTypeSources
  preExtracted?: PreExtractedSchemas
}

/**
 * Per-file cross-file resolutions, keyed by {@link crossFileKey} of a
 * `component()` call's effective type-argument names.
 *
 * Keyed PER CALL, not per file (issue #91): a file may declare component A with
 * an imported `Msg` and component B with a local one, and B must not be handed
 * A's schema/annotations. A wrong schema on the agent/devtools ABI is worse than
 * a missing one — a call with no entry here simply falls back to the transform's
 * file-local extractors.
 */
export type CrossFileResolutions = ReadonlyMap<string, CrossFileResolution>

/** The `State`/`Msg`/`Effect` names the file-local extractors assume when a
 * `component()` call is untyped. */
export const CONVENTION_TYPE_NAMES = {
  state: 'State',
  msg: 'Msg',
  effect: 'Effect',
} as const

/**
 * The EFFECTIVE State/Msg/Effect type names for a `component<…>()` call: its own
 * type arguments where they are plain identifiers, else the
 * {@link CONVENTION_TYPE_NAMES} the file-local extractors fall back to.
 *
 * The adapter (pre-resolution) and the transform (metadata emission + lookup)
 * MUST both derive names through this function: they meet on the
 * {@link crossFileKey} built from the result, and any divergence would make the
 * lookup silently miss and degrade to file-local extraction.
 */
export function componentTypeNames(call: ts.CallExpression): {
  state: string
  msg: string
  effect: string
} {
  const raw = readComponentTypeArgNames(call)
  return {
    state: raw.state ?? CONVENTION_TYPE_NAMES.state,
    msg: raw.msg ?? CONVENTION_TYPE_NAMES.msg,
    effect: raw.effect ?? CONVENTION_TYPE_NAMES.effect,
  }
}

/**
 * The {@link CrossFileResolutions} key for a tuple of effective type names — both
 * the transform's metadata cache key and the adapter's lookup key.
 *
 * The key is the NAME tuple, not the resolved declaration, so two calls that name
 * the same types share one entry. That is exact for the TOP-LEVEL declarations and
 * module imports this resolver walks. Two known cases where a name is NOT a unique
 * referent — both pre-existing limits shared with the file-local extractors, which
 * key off names the same way:
 *
 *  - **Shadowing.** A `Msg` declared inside a block/function scope collides with a
 *    top-level `Msg`; the resolver only ever sees the top-level one, so a component
 *    under the shadow is keyed as if it used the outer type.
 *  - **Non-identifier type arguments.** An inline literal, a generic instantiation
 *    or a qualified name (`A.Msg`) is not a plain identifier, so
 *    {@link componentTypeNames} falls back to the convention name — and two calls
 *    with DIFFERENT qualified types collide on that one key.
 *
 * Both produce the same wrongly-shared or file-local schema they produced before
 * per-call keying; the fix is name resolution through a checker, not a wider key.
 */
export function crossFileKey(names: { state: string; msg: string; effect: string }): string {
  return `${names.state}\0${names.msg}\0${names.effect}`
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
 * Limitations of `findTypeSource` itself (all of them SILENT — nothing
 * warns, and the affected metadata is simply absent):
 *  - Composition (`type Msg = ImportedA | { type: 'b' }`): it locates the
 *    alias but does not walk INTO the union. The composition-aware
 *    extractors below (`extractMsgAnnotationsCrossFile`,
 *    `extractDiscriminatedUnionSchemaCrossFile`) do recurse, and are what
 *    the adapter calls for Msg/Effect.
 *  - Namespace imports (`import * as ns from './msg'`): not followed.
 *    (`export *` re-export barrels ARE followed — step 4.)
 *  - Generic types: not parameterized resolution; the type argument
 *    must resolve to a concrete type alias.
 *
 * NOTE for future readers: this file used to attribute these gaps to a lint
 * rule named `agent-msg-resolvable`. That rule belonged to the DELETED
 * `@llui/eslint-plugin` and was never reimplemented as a compiler rule — there
 * is no guard. Do not re-add the claim without the rule (issue #91).
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
  /**
   * Parse memo for this resolution pass. REQUIRED, and not a micro-optimization:
   * one pass looks the same sibling up once per type argument, once per composed
   * union member and again while enriching the type index — eight parses of one
   * `msg.ts` was typical, plus ten of the focal module (issue #93). Every parse
   * the resolver makes goes through it, so reuse does not depend on the caller
   * remembering anything; the caller only decides the cache's LIFETIME (the Vite
   * plugin: one per `transform`). Build one with `createModuleCache()`.
   */
  modules: ModuleCache
}

export interface ResolvedTypeSource {
  /** The parsed module declaring the type alias (from `ctx.modules`, so every
   * later consumer of the same file reuses this tree). */
  module: ParsedModule
  /** The local name of the alias *in that file* (after rename chains). */
  localName: string
  /** Absolute path of the file declaring the alias (debug aid). Always
   * `module.fileName`. */
  filePath: string
}

/**
 * Walk imports + re-exports to find where a type alias is actually
 * declared. Returns the source string and local name of the alias in
 * its declaring file. `export *` barrels ARE followed (step 4, first hit
 * in textual order wins). Returns `null` if the chain leads to an
 * unresolved module, a namespace import, or a dead-end (alias not
 * declared anywhere we can see).
 */
export async function findTypeSource(
  typeName: string,
  mod: ParsedModule,
  ctx: ResolveContext,
  visited: Set<string> = new Set(),
): Promise<ResolvedTypeSource | null> {
  const filePath = mod.fileName
  // Cycle prevention — re-export A → A is a tight loop that some
  // pathological re-export chains can produce. Bail rather than
  // infinitely recurse.
  if (visited.has(`${filePath}::${typeName}`)) return null
  visited.add(`${filePath}::${typeName}`)

  const sf = mod.sourceFile()

  // 1. Local declaration wins. `type X = ...` or `interface X { ... }`
  //    (extractors only support type aliases today, but check both so
  //    the resolver itself isn't a footgun for future extractors).
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName) {
      return { module: mod, localName: typeName, filePath }
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      return { module: mod, localName: typeName, filePath }
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
      return findTypeSource(sourceName, ctx.modules.get(resolved, subSource), ctx, visited)
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
    const found = await findTypeSource(typeName, ctx.modules.get(resolved, subSource), ctx, visited)
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
      return findTypeSource(remoteName, ctx.modules.get(resolved, subSource), ctx, visited)
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
 * the first one walked wins — silently. Nothing in the toolchain flags
 * the duplicate (see the note in this file's header about the lint rule
 * that no longer exists); a duplicate discriminant is a type error the
 * user's own `tsc` reports independently.
 */
export async function extractMsgAnnotationsCrossFile(
  mod: ParsedModule,
  typeName: string,
  ctx: ResolveContext,
): Promise<Record<string, MessageAnnotations> | null> {
  const out: Record<string, MessageAnnotations> = {}
  const ok = await collectMsgVariants(typeName, mod, ctx, out, new Set())
  if (!ok) return null
  return Object.keys(out).length === 0 ? null : out
}

async function collectMsgVariants(
  typeName: string,
  mod: ParsedModule,
  ctx: ResolveContext,
  out: Record<string, MessageAnnotations>,
  visitedAliases: Set<string>,
): Promise<boolean> {
  const located = await findTypeSource(typeName, mod, ctx, new Set())
  if (!located) return false

  const aliasKey = `${located.filePath}::${located.localName}`
  if (visitedAliases.has(aliasKey)) return true
  visitedAliases.add(aliasKey)

  const sf = located.module.sourceFile()
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const alias = aliases.find((a) => a.name.text === located.localName)
  if (!alias) return false

  // Single-variant alias: `type Foo = { type: 'a', ... }`. Treat as a
  // one-element union so a Msg variant can be its own type alias.
  // Parentheses are legal anywhere a type is and match neither shape test
  // below (#96), so `type Msg = ( … )` is unwrapped whole. Each MEMBER keeps
  // its original node here — `readLeadingJSDocForMember` works off these
  // positions, and a member's comment sits BEFORE its own `(`.
  const aliasBody = unwrapParenthesizedType(alias.type)
  const memberNodes: ts.TypeNode[] = ts.isUnionTypeNode(aliasBody)
    ? [...aliasBody.types]
    : [aliasBody]

  for (let i = 0; i < memberNodes.length; i++) {
    const member = unwrapParenthesizedType(memberNodes[i]!)

    if (ts.isTypeLiteralNode(member)) {
      const variant = readDiscriminantLiteral(member)
      if (!variant) continue
      const comment = readLeadingJSDocForMember(sf.text, aliasBody, memberNodes, i)
      if (out[variant] === undefined) {
        out[variant] = parseAnnotations(comment)
      }
      continue
    }

    if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
      // Composed: recurse through the resolver.
      await collectMsgVariants(member.typeName.text, located.module, ctx, out, visitedAliases)
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
 * element's start (or between the union body's start and the first
 * element for `i === 0`). Mirrors the logic in
 * `extractMsgAnnotations` so the cross-file path produces the same
 * output for the same input.
 *
 * `aliasBody` is the alias type with parentheses already peeled (#96), and
 * that is load-bearing for `i === 0`: in `type Msg = ( /** doc *\/ | {…} )`
 * the first member's comment sits INSIDE the `(`, so scanning from the
 * ParenthesizedTypeNode's `pos` — which is just after the `=` — finds nothing
 * and the first variant silently loses its annotations while every later one
 * keeps theirs. `extractMsgAnnotations` scans from the unwrapped node for
 * exactly this reason; the two must not disagree.
 */
function readLeadingJSDocForMember(
  source: string,
  aliasBody: ts.TypeNode,
  members: ts.TypeNode[],
  i: number,
): string {
  const prev = members[i - 1]
  // For non-union (single-variant) aliases this is the alias body itself.
  const scanPos = i === 0 || prev === undefined ? aliasBody.pos : prev.end
  const ranges = ts.getLeadingCommentRanges(source, scanPos) ?? []
  return ranges
    .filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    .map((r) => source.slice(r.pos, r.end))
    .filter((txt) => txt.startsWith('/**'))
    .join('\n')
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
  mod: ParsedModule,
  typeName: string,
  ctx: ResolveContext,
): Promise<MsgSchema | null> {
  const variants: MsgSchema['variants'] = {}
  const ok = await collectSchemaVariants(typeName, mod, ctx, variants, new Set())
  if (!ok) return null
  return Object.keys(variants).length === 0 ? null : { discriminant: 'type', variants }
}

async function collectSchemaVariants(
  typeName: string,
  mod: ParsedModule,
  ctx: ResolveContext,
  variants: MsgSchema['variants'],
  visitedAliases: Set<string>,
): Promise<boolean> {
  const located = await findTypeSource(typeName, mod, ctx, new Set())
  if (!located) return false

  const aliasKey = `${located.filePath}::${located.localName}`
  if (visitedAliases.has(aliasKey)) return true
  visitedAliases.add(aliasKey)

  const sf = located.module.sourceFile()
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  const alias = aliases.find((a) => a.name.text === located.localName)
  if (!alias) return false

  // Same parenthesis unwrap as `collectMsgVariants` above (#96).
  const aliasBody = unwrapParenthesizedType(alias.type)
  const memberNodes: ts.TypeNode[] = ts.isUnionTypeNode(aliasBody)
    ? [...aliasBody.types]
    : [aliasBody]

  // Build a typeIndex that combines this file's local types with any
  // *imported* type aliases referenced inside the variant payloads.
  // Without this enrichment, a field typed as `GridSorting` (declared
  // in `./state.ts` and imported here) would resolve to `'unknown'`
  // because the local index doesn't know about it. The synthesizer
  // would then emit `null` and the agent would have to guess at the
  // permissible literal-union values.
  const typeIndex = await buildEnrichedTypeIndex(located.module, ctx)

  for (const raw of memberNodes) {
    const member = unwrapParenthesizedType(raw)
    if (ts.isTypeLiteralNode(member)) {
      collectOneVariant(member, variants, sf.text, typeIndex)
      continue
    }
    if (ts.isTypeReferenceNode(member) && ts.isIdentifier(member.typeName)) {
      await collectSchemaVariants(
        member.typeName.text,
        located.module,
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
 *    A namespace import, or a name reachable only through an `export *`
 *    in THIS file, contributes nothing to the index (`findTypeSource`
 *    does follow `export *` once it has a name to chase). Nothing warns
 *    when one is skipped — the field type just stays `'unknown'`.
 *  - The resolved external type must itself be a type alias or
 *    interface in the target file — chained re-exports beyond the first
 *    hop fall back to `'unknown'`.
 *  - Best-effort: any failure to resolve an import is silent. The
 *    field type just stays `'unknown'` as it would have without
 *    enrichment.
 */
async function buildEnrichedTypeIndex(mod: ParsedModule, ctx: ResolveContext): Promise<TypeIndex> {
  const sf = mod.sourceFile()
  const filePath = mod.fileName
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
  const fileQueue: ParsedModule[] = [mod]
  const visitedFiles = new Set<string>([filePath])

  while (fileQueue.length > 0) {
    const cur = fileQueue.shift()
    if (!cur) break
    const curSf = cur.sourceFile()

    // Add this file's *own* local type declarations to the index so
    // sibling references inside the file's exported types resolve.
    // Without this, a Criterion in domain.ts referencing EaseMode
    // (declared right next to it) would collapse to 'unknown' even
    // though we already followed the import chain to domain.ts.
    // First-write-wins: a local declaration in the entry file
    // shadows a same-named declaration in a transitively-walked
    // file (intentional — entry-file names are canonical).
    if (cur.fileName !== filePath) {
      for (const stmt of curSf.statements) {
        if (ts.isTypeAliasDeclaration(stmt)) {
          if (!index.has(stmt.name.text)) index.set(stmt.name.text, stmt.type)
        } else if (ts.isInterfaceDeclaration(stmt)) {
          if (!index.has(stmt.name.text)) index.set(stmt.name.text, stmt)
        }
      }
    }

    for (const stmt of curSf.statements) {
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
          located = await findTypeSource(importedName, cur, ctx, new Set())
        } catch {
          located = null
        }
        if (!located) continue
        const targetSf = located.module.sourceFile()
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
          fileQueue.push(located.module)
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
