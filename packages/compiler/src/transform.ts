import ts from 'typescript'
import { collectDeps } from './collect-deps.js'
import { resolveAccessorBody } from './accessor-resolver.js'
import { extractMsgSchema, extractEffectSchema } from './msg-schema.js'
import { extractMsgAnnotations } from './msg-annotations.js'
import { extractStateSchema } from './state-schema.js'
// `computeSchemaHash` no longer imported here — `schemaHashModule` owns
// the __schemaHash emission. See modules/schema-hash.ts.
// `tagDispatchHandlers` + `injectScopeVariantRegistrations` are now
// consumed by `bindingDescriptorsModule` via the registry's preTransform
// hook — no longer imported here. See modules/binding-descriptors.ts.
import { compilerCache } from './compiler-cache.js'
import type { Diagnostic } from './diagnostic.js'
import { ModuleRegistry, type CompilerModule, type EmissionContribution } from './module.js'
// Introspection modules (v2c/decomp-26) and devtools modules
// (v2c/decomp-27) moved to their sibling packages. Hosts register
// factories via `registerIntrospectionFactory` / `registerDevtoolsFactory`;
// transformLlui invokes them via the getters when their respective
// modes are active. BINDING_DESCRIPTORS_SLOT is re-exported from
// introspection-factory.ts as a string constant so the orchestrator
// can read the slot without importing the sibling package.
import {
  getIntrospectionFactory,
  getDevtoolsFactory,
  BINDING_DESCRIPTORS_SLOT,
} from './introspection-factory.js'
import { maskLegendModule } from './modules/mask-legend.js'
import { compilerStampModule } from './modules/compiler-stamp.js'
import { eachMemoModule, EACH_MEMO_SLOT, type EachMemoSlot } from './modules/each-memo.js'
import { structuralMaskModule } from './modules/structural-mask.js'
import { textMaskModule } from './modules/text-mask.js'
import { itemDedupModule } from './modules/item-dedup.js'
import {
  elementRewriteModule,
  ELEMENT_REWRITE_SLOT,
  type ElementRewriteSlot,
} from './modules/element-rewrite.js'
import { rowFactoryModule } from './modules/row-factory.js'
import {
  coreSynthesisModule,
  CORE_SYNTHESIS_SLOT,
  type CoreSynthesisSlot,
} from './modules/core-synthesis.js'
import { createLintModules } from './lint-modules.js'

export function createMaskLiteral(f: ts.NodeFactory, mask: number): ts.Expression {
  if (mask >= 0) return f.createNumericLiteral(mask)
  // -1 (0xFFFFFFFF | 0) — emit as bitwise OR: 0xFFFFFFFF | 0
  return f.createBinaryExpression(
    f.createNumericLiteral(0xffffffff),
    ts.SyntaxKind.BarToken,
    f.createNumericLiteral(0),
  )
}

// HTML element helper names that the compiler can transform
const ELEMENT_HELPERS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
  'video',
])

/**
 * Transform a source file containing @llui/dom imports.
 * Returns the transformed source or null if no transformation needed.
 */
export interface TransformEdit {
  start: number
  end: number
  replacement: string
}

/**
 * Pre-resolved external type sources from the cross-file resolver.
 * When the plugin's vite hook detects that `State` / `Msg` / `Effect`
 * for a `component<...>()` call are imported (not declared in the
 * current file), it walks the imports and re-exports to find the
 * declaring file, then passes the source + local name here. Each
 * extractor below uses the resolved source instead of falling back to
 * the file-local search (which would miss the type entirely).
 */
export interface ExternalTypeSources {
  state?: { source: string; typeName: string }
  msg?: { source: string; typeName: string }
  effect?: { source: string; typeName: string }
}

/**
 * Schemas already extracted by the plugin's async hook before invoking
 * the sync transform. Used for cases the file-local sync extractors
 * can't handle on their own:
 *   - The Msg/Effect/State alias lives in another file (cross-file
 *     resolution, see `cross-file-resolver.ts`).
 *   - The Msg/Effect alias is a *composition* — a union mixing inline
 *     `{ type: 'literal' }` members with TypeReferences pointing at
 *     other (often imported) Msg unions.
 *
 * When provided, transformLlui uses these instead of running its own
 * file-local extractors. When omitted (the test path that constructs
 * a single-source string), the file-local extractors run as before.
 */
export interface PreExtractedSchemas {
  msgSchema?: ReturnType<typeof extractMsgSchema>
  msgAnnotations?: ReturnType<typeof extractMsgAnnotations>
  stateSchema?: ReturnType<typeof extractStateSchema>
  effectSchema?: ReturnType<typeof extractEffectSchema>
}

export function transformLlui(
  source: string,
  _filename: string,
  devMode = false,
  emitAgentMetadata = false,
  mcpPort: number | null = 5200,
  verbose = false,
  typeSources?: ExternalTypeSources,
  preExtracted?: PreExtractedSchemas,
  crossFilePaths?: ReadonlySet<string>,
): { output: string; edits: TransformEdit[]; diagnostics: Diagnostic[] } | null {
  // Use the caller-provided filename so any module reading `sf.fileName`
  // (e.g. `componentMetaModule` emitting `__componentMeta: { file }`)
  // sees the real path instead of a placeholder. The monolith's inline
  // `injectComponentMeta` used the `_filename` parameter directly; the
  // bridge needs the same source via the AST node.
  let sourceFile = ts.createSourceFile(_filename, source, ts.ScriptTarget.Latest, true)

  // Find the @llui/dom import
  const imp = findLluiImport(sourceFile)
  if (!imp) return null
  const lluiImport = imp

  // Collect imported element helper names (local → original)
  const importedHelpers = getImportedHelpers(lluiImport)
  // Previously: `if (importedHelpers.size === 0 && !hasReactiveAccessors(sourceFile)) return null`.
  // Removed in lint-migration-8: lint-rule modules (namespace-import,
  // form-boilerplate, etc.) need to fire on files whose only @llui/dom
  // usage is a namespace import, a type-only import, or a Msg-union
  // declaration — none of which produce element-helper or text/component
  // call sites. The registry's per-file cost is small enough that running
  // it on these files is fine; the late return-null still bails when
  // there's no work to emit (no edits AND no diagnostics).

  // Connect-pattern pass: detects `*.connect(get, sendFn, …)` call
  // sites and inserts a runtime `__registerScopeVariants([...])`
  // adjacent to each, with the variants statically extracted from the
  // sendFn's body. Handles the dispatch-translation case at the
  // syntactic level — handler propagation via `tagSend` covers the
  // rest. Runs FIRST so its `collectLocalFns` resolver still sees raw
  // arrow initializers in const declarations (the universal tagger
  // below replaces those initializers with `Object.assign(...)`
  // wrappers).
  //
  // Universal handler-tagger pass: walks every arrow/function
  // expression and wraps any whose body contains literal
  // `send({type:'X'})` / `dispatch({type:'X'})` calls with
  // `Object.assign(arrow, {__lluiVariants: ['X']})`. The runtime
  // (`@llui/dom` `elements.ts` / `el-split.ts`) reads the tag from
  // event-handler bindings only — so tags placed on functions in
  // non-handler positions are runtime-inert. This deliberately covers
  // three patterns at once:
  //   • Inline event handlers (`onClick: () => send(...)`)
  //   • Const-bound translators (`const sendMenu = (m) => dispatch(...)`)
  //   • Positional-arg helpers (`navButton(label, () => dispatch(...))`)
  //
  // Both passes gated on dev/agent-metadata so production bundles
  // without agent integration don't pay the per-handler `Object.assign`
  // cost.
  // Binding-descriptors pre-pass migrated to `bindingDescriptorsModule`
  // via the registry's `preTransform` hook (v2c/decomp-7). The module
  // wraps `injectScopeVariantRegistrations` + `tagDispatchHandlers` and
  // runs inside `registry.run()` below — the resulting (post-transform)
  // sourceFile is re-assigned from `registryResult.analysis.sourceFile`.
  // `scopeRegistrationsInjected` reads from the module's slot after
  // the registry run.
  let scopeRegistrationsInjected = false

  // Pass 2 pre-scan: collect all state access paths
  // Only use precise masks in files that define a component() — the __dirty
  // function is generated per-component, so bit assignments in other files
  // won't match. Files without component() get FULL_MASK on all bindings.
  const fileHasComponent = hasComponentDef(sourceFile, lluiImport)
  const { lo: fieldBits, hi: fieldBitsHi } = fileHasComponent
    ? collectDeps(source, crossFilePaths)
    : { lo: new Map<string, number>(), hi: new Map<string, number>() }

  if (verbose && fileHasComponent) {
    const pairs = [...fieldBits.entries()]
      .map(([path, bit]) => `${path}=${bit === -1 ? 'FULL' : bit}`)
      .join(', ')
    console.info(
      `[llui] ${_filename}: ${fieldBits.size} reactive path${fieldBits.size === 1 ? '' : 's'}` +
        (pairs.length > 0 ? ` — ${pairs}` : ''),
    )
  }

  // Identifier names bound to the View<S,M> helpers parameter of a `view` callback.
  // When the user writes `h.text(...)` / `h.show(...)` / `h.each(...)`, the
  // compiler treats the call as if it were a bare import call.
  const viewHelperNames = collectViewHelperNames(sourceFile, lluiImport)
  // Destructured aliases: `view: (_, { show, text: t }) => [...]` → { show→show, t→text }.
  const viewHelperAliases = collectViewHelperAliases(sourceFile, lluiImport, viewHelperNames)

  // Track which helpers were compiled vs bailed out
  const compiledHelpers = new Set<string>()
  const bailedHelpers = new Set<string>()
  let usesElTemplate = false
  let usesElSplit = false
  let usesMemo = false
  let usesApplyBinding = false
  // v0.4 size-cut: element-rewrite emits `__bindUncertain` for prop values
  // it can't statically classify (e.g. function-parameter identifiers).
  // The flag drives the cleanupImports pass to add the runtime import.
  let usesBindUncertain = false
  // v0.4 size-cut (Tier 1.2): per-file set of primitive imports needed by
  // the `__view` factories we synthesize alongside each `component()` call.
  // The runtime calls `def.__view(send)` instead of `createView(send)`, so
  // each component only pulls in the primitives it actually destructures —
  // killing the view-bag tree-shaking leak that pulled all primitives.
  const viewBagPrimitivesNeeded = new Set<string>()
  let usesCloneStaticTemplate = false

  const f = ts.factory
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

  // Collect source positions of transformed nodes for source mapping
  const edits: TransformEdit[] = []

  // ── Module registry (v2c §2) ────────────────────────────────────
  //
  // Active CompilerModules run as a single AST pass over the source
  // before the main visitor; their emissions are spliced into the
  // matching `component()` call's config-arg by `applyRegistryEmissions`
  // alongside the monolith's inline `inject*` helpers. As modules
  // incrementally absorb inline-injector concerns (`__componentMeta`,
  // `__stateSchema` today, `__msgSchema` / `__msgAnnotations` /
  // `__schemaHash` / `__prefixes` next), the matching inline call
  // sites delete and the registry becomes the sole emission path.
  //
  // Module activation rules:
  //   - `componentMetaModule` registers only in `devMode` (matches the
  //     monolith's `if (devMode) injectComponentMeta(...)` gate).
  //   - `stateSchemaModule` registers when `shouldEmitAgentMetadata`
  //     (devMode OR emitAgentMetadata flag) — matches the monolith's
  //     gating block at the inline-inject sites.
  //   - All other agent modules are dormant in this push.
  //
  // When the registry is empty the bridge collapses to a no-op — the
  // monolith's existing emissions continue to dominate.
  const shouldEmitAgentMetadataAtToplevel = devMode || emitAgentMetadata
  // Pre-compute the state schema once per file. The monolith previously
  // computed this inside the visitor's component() block (re-running
  // per call site); since the inputs are file-level (typeSources,
  // preExtracted, source) the result is identical across calls, so we
  // hoist for the module-registration. The inline computation below
  // (in the visitor's `if (shouldEmitAgentMetadata)` block) gets its
  // value from this same variable.
  const hoistedStateSchema = shouldEmitAgentMetadataAtToplevel
    ? preExtracted?.stateSchema !== undefined
      ? preExtracted.stateSchema
      : extractStateSchema(
          typeSources?.state?.source ?? source,
          typeSources?.state?.typeName ?? 'State',
        )
    : null
  const hoistedMsgAnnotations = shouldEmitAgentMetadataAtToplevel
    ? preExtracted?.msgAnnotations !== undefined
      ? preExtracted.msgAnnotations
      : extractMsgAnnotations(
          typeSources?.msg?.source ?? source,
          typeSources?.msg?.typeName ?? 'Msg',
        )
    : null
  const hoistedMsgSchema = shouldEmitAgentMetadataAtToplevel
    ? preExtracted?.msgSchema !== undefined
      ? preExtracted.msgSchema
      : extractMsgSchema(typeSources?.msg?.source ?? source, typeSources?.msg?.typeName ?? 'Msg')
    : null
  const hoistedEffectSchema = shouldEmitAgentMetadataAtToplevel
    ? preExtracted?.effectSchema !== undefined
      ? preExtracted.effectSchema
      : extractEffectSchema(
          typeSources?.effect?.source ?? source,
          typeSources?.effect?.typeName ?? 'Effect',
        )
    : null
  const activeModules: CompilerModule[] = []
  // Devtools modules (componentMeta + future trace instrumentation)
  // live in @llui/compiler-devtools. The host registers the factory
  // once via `registerDevtoolsFactory`; the factory gates on devMode
  // and any future per-module flags.
  const devtools = getDevtoolsFactory()
  if (devtools) {
    activeModules.push(...devtools({ sourceFile, devMode }))
  }
  // Introspection modules (binding-descriptors, msg-schema,
  // state-schema, msg-annotations, schema-hash) live in
  // @llui/compiler-introspection. The host registers the factory
  // once via `registerIntrospectionFactory`. The factory itself
  // decides which modules to activate based on
  // `shouldEmitAgentMetadata`: producer modules + binding-descriptors
  // run only in agent mode, but schemaHashModule runs always (HMR
  // re-send gating uses it even in prod builds — spec §7.4).
  const introspection = getIntrospectionFactory()
  if (introspection) {
    activeModules.push(
      ...introspection({
        sourceFile,
        msgSchema: hoistedMsgSchema,
        effectSchema: hoistedEffectSchema,
        stateSchema: hoistedStateSchema,
        msgAnnotations: hoistedMsgAnnotations,
        shouldEmitAgentMetadata: shouldEmitAgentMetadataAtToplevel,
      }),
    )
  }
  // maskLegendModule registers whenever the file has any reactive paths.
  // The module's own emit() gates on empty bit maps so registering
  // here when fieldBits/fieldBitsHi are non-empty is sufficient.
  if (fieldBits.size > 0 || fieldBitsHi.size > 0) {
    activeModules.push(maskLegendModule({ fieldBits, fieldBitsHi }))
  }
  // compilerStampModule is unconditional — the integrity marker fires
  // on every compiled `component()` call regardless of mode. Replaces
  // the umbrella's last remaining inline injector
  // (`injectCompilerEmittedMarker`, deleted below).
  activeModules.push(compilerStampModule)
  // Always-on lint rules. Single source of truth lives in
  // `./lint-modules.ts` so adding/removing a rule propagates to both
  // the transform pipeline and the rule-docs generator
  // (`scripts/generate-rule-docs.ts`). LLM-first authoring requires
  // non-bypassable correctness signals: every rule emits at
  // `severity: error`.
  activeModules.push(...createLintModules())
  // eachMemoModule wraps allocating each() items accessors in
  // `memo(...)` via `transformCallEnter`. Activated when the file
  // has any reactive paths (mirrors the inline call's gating).
  // The module sets a per-file slot when at least one wrap fired;
  // the umbrella reads it to decide whether `memo` needs to enter
  // the @llui/dom imports via `cleanupImports`.
  if (fieldBits.size > 0 || fieldBitsHi.size > 0) {
    activeModules.push(
      eachMemoModule({
        fieldBits,
        viewHelperNames,
        viewHelperAliases,
      }),
    )
  }
  // itemDedupModule lifts repeated `item(selector)` / `item.field`
  // accesses into hoisted `__sN` selectors + `__aN` accessors.
  // Registered unconditionally — the original inline call ran on every
  // each() regardless of reactive paths, since the optimization is a
  // pure rewrite of the render body. Module fires top-down
  // (`transformCallEnter`) so subsequent structural-mask + element
  // rewrites see the hoisted form.
  activeModules.push(
    itemDedupModule({
      viewHelperNames,
      viewHelperAliases,
    }),
  )
  // elementRewriteModule transforms `div(...)` / `button(...)` /
  // etc. into `elSplit(...)` / `elTemplate(...)` / `__cloneStaticTemplate(...)`.
  // Activated unconditionally — the underlying `tryTransformElementCall`
  // gates on the `importedHelpers` map (only rewrites helpers that
  // were actually imported from @llui/dom). The module signals which
  // helpers compiled / bailed and which runtime functions need
  // imports via `ELEMENT_REWRITE_SLOT`; the umbrella reads the slot
  // before `cleanupImports`.
  activeModules.push(
    elementRewriteModule({
      importedHelpers,
      fieldBits,
      fieldBitsHi,
    }),
  )
  // rowFactoryModule fires bottom-up (`transformCall` not
  // `transformCallEnter`) so it observes the each() call AFTER the
  // render body's element children have been rewritten by
  // `elementRewriteModule` into `elTemplate(...)` calls. Without that
  // ordering it would always bail (`if (!templateCall) return null`).
  activeModules.push(
    rowFactoryModule({
      viewHelperNames,
      viewHelperAliases,
      filename: _filename,
      source,
    }),
  )
  // coreSynthesisModule injects `__update` / `__handlers` / `__prefixes`
  // onto every `component()` call's config-arg literal. These three
  // share `topLevelBits` / `structuralMask` intermediates and are
  // co-emitted by `tryInjectDirty` (still inline in transform.ts;
  // the module is a thin wrapper per v2c §7.9.2 decision (b)). Fires
  // top-down so subsequent per-target emissions (componentMeta,
  // compilerStamp, schemaHash, stateSchema, msgSchema, msgAnnotations)
  // observe the synthesized config-arg via `findComponentCalls`.
  activeModules.push(
    coreSynthesisModule({
      fieldBits,
      fieldBitsHi,
      lluiImport,
    }),
  )
  // structuralMaskModule injects `__mask` into each()/branch()/scope()/show()
  // options. Activated when the file has any low-word reactive paths
  // (matches the inline `fieldBits.size === 0` early-return). Module
  // fires top-down (transformCallEnter) so subsequent passes — and
  // the visitor-level inline `tryInjectDirty`'s structuralMask read —
  // see the injected `__mask` prop on the options literal.
  if (fieldBits.size > 0) {
    activeModules.push(
      structuralMaskModule({
        fieldBits,
        viewHelperNames,
        viewHelperAliases,
      }),
    )
  }
  // textMaskModule injects a `__mask` (precise or FULL_MASK) as
  // text()'s second argument on every eligible text() call. Activated
  // unconditionally — the inline `tryInjectTextMask` had no early
  // return on empty fieldBits and always emitted FULL_MASK in the
  // zero-path case so the runtime sees a uniform 2-arg shape.
  activeModules.push(
    textMaskModule({
      fieldBits,
      viewHelperNames,
      viewHelperAliases,
      lluiImport,
    }),
  )
  const registry = new ModuleRegistry(activeModules)
  // `typeSources` flows through to lint modules that need cross-file
  // visibility (e.g. agent-emits-drift's imported-Msg case). Same
  // shape as `ModuleExternalTypes`.
  const registryResult = registry.run(sourceFile, undefined, typeSources)
  // The registry phases (preTransform v2c/decomp-7, transformCall
  // v2c/decomp-11/12) may have mutated the source file — replace our
  // local reference so all subsequent code (fieldBits, visitor,
  // cleanupImports) sees the post-registry AST. When no rewriting
  // module is active this is a no-op assignment.
  sourceFile = registryResult.analysis.sourceFile
  // Read the binding-descriptors module's slot for the
  // cleanupImports decision about the `__registerScopeVariants`
  // runtime helper import. When the module didn't run (no agent
  // metadata mode) the slot is absent and scopeRegistrationsInjected
  // stays false.
  const bdState = registryResult.analysis.perModule.get(BINDING_DESCRIPTORS_SLOT) as
    | { scopeRegistrationsInjected: boolean }
    | undefined
  if (bdState) scopeRegistrationsInjected = bdState.scopeRegistrationsInjected
  // each-memo module signals memo-usage via its slot — surfaces here
  // so `cleanupImports` adds the `memo` runtime import. Mirrors the
  // monolith's `usesMemo` flag that the inline `tryWrapEachItemsWithMemo`
  // used to set.
  const emState = registryResult.analysis.perModule.get(EACH_MEMO_SLOT) as EachMemoSlot | undefined
  if (emState?.usesMemo) usesMemo = true
  // element-rewrite module signals compiled/bailed helpers and which
  // runtime imports it referenced. Surfaces here so the umbrella's
  // `cleanupImports` decision matches the inline path's behavior.
  // Also pushes a sentinel edit when the module rewrote — the
  // `edits.length === 0` short-circuit downstream would otherwise
  // skip the per-statement diff that surfaces Phase 2b rewrites to
  // the output.
  const erState = registryResult.analysis.perModule.get(ELEMENT_REWRITE_SLOT) as
    | ElementRewriteSlot
    | undefined
  if (erState) {
    for (const h of erState.compiled) compiledHelpers.add(h)
    for (const h of erState.bailed) bailedHelpers.add(h)
    if (erState.usesElSplit) usesElSplit = true
    if (erState.usesElTemplate) usesElTemplate = true
    if (erState.usesCloneStaticTemplate) usesCloneStaticTemplate = true
    if (erState.usesBindUncertain) usesBindUncertain = true
    if (
      erState.compiled.size > 0 ||
      erState.usesElSplit ||
      erState.usesElTemplate ||
      erState.usesCloneStaticTemplate
    ) {
      edits.push({ start: 0, end: 0, replacement: '' })
    }
  }
  // core-synthesis module signals __update/__handlers/__prefixes
  // emission. Drives `__runPhase2` + `__handleMsg` runtime imports
  // via `cleanupImports`. Also pushes a sentinel edit so the
  // per-statement diff catches the synthesized config-arg.
  const csState = registryResult.analysis.perModule.get(CORE_SYNTHESIS_SLOT) as
    | CoreSynthesisSlot
    | undefined
  if (csState?.usesApplyBinding) {
    usesApplyBinding = true
    edits.push({ start: 0, end: 0, replacement: '' })
  }
  const emissionsByTarget = new Map<ts.CallExpression, EmissionContribution[]>()
  const globalEmissions: EmissionContribution[] = []
  for (const emission of registryResult.emissions) {
    if (emission.target) {
      const list = emissionsByTarget.get(emission.target)
      if (list) list.push(emission)
      else emissionsByTarget.set(emission.target, [emission])
    } else {
      globalEmissions.push(emission)
    }
  }

  /**
   * Splice registry-collected emissions into a `component()` call's
   * config-arg object literal. Idempotent: emissions whose `field`
   * already exists on the config arg are skipped (matches the
   * monolith's inline `inject*` helpers' "if-already-present-return"
   * behaviour). The caller passes both the *original* call (the one
   * the registry walked) and the current *transformed* call (the
   * accumulator that previous `inject*` helpers built up).
   */
  function applyRegistryEmissions(
    transformedCall: ts.CallExpression,
    originalCall: ts.CallExpression,
  ): ts.CallExpression {
    const targeted = emissionsByTarget.get(originalCall) ?? []
    const all = [...globalEmissions, ...targeted]
    if (all.length === 0) return transformedCall
    const configArg = transformedCall.arguments[0]
    if (!configArg || !ts.isObjectLiteralExpression(configArg)) return transformedCall
    const existing = new Set<string>()
    for (const prop of configArg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        existing.add(prop.name.text)
      }
    }
    const adds: ts.ObjectLiteralElementLike[] = []
    for (const emission of all) {
      if (existing.has(emission.field)) continue
      adds.push(f.createPropertyAssignment(emission.field, emission.value))
    }
    if (adds.length === 0) return transformedCall
    const newConfig = f.createObjectLiteralExpression([...configArg.properties, ...adds], true)
    return f.createCallExpression(transformedCall.expression, transformedCall.typeArguments, [
      newConfig,
      ...transformedCall.arguments.slice(1),
    ])
  }

  // ── track() strip pass (v2b §3) ─────────────────────────────────
  // `track({ deps: (s) => [...] })` is a compile-time declaration only.
  // collectDeps already merged its paths into `fieldBits` because 'track'
  // is in REACTIVE_API_NAMES. Now emit an edit deleting the statement
  // and mark 'track' as compiled so cleanupImports strips the import.
  //
  // A track() call is stripped only when it's the entire ExpressionStatement
  // (the documented form). track() inside a larger expression is left as a
  // call to the runtime stub — which throws — so the developer notices
  // they wrote an unsupported form. The llui/prefer-static-deps lint
  // rule catches the unusual usages.
  // `track` is imported from @llui/dom but is not an element helper, so
  // `importedHelpers.has('track')` is always false. Check the named
  // imports directly to gate the strip pass.
  const lluiImportNames = new Set<string>()
  if (
    lluiImport.importClause?.namedBindings &&
    ts.isNamedImports(lluiImport.importClause.namedBindings)
  ) {
    for (const spec of lluiImport.importClause.namedBindings.elements) {
      lluiImportNames.add(spec.name.text)
    }
  }
  // Track-strip recognition. The main visitor returns an EmptyStatement
  // for any `track({ deps: ... })` ExpressionStatement — the per-statement
  // diff then surfaces the deletion. Paths are already in fieldBits
  // because 'track' is in REACTIVE_API_NAMES.
  if (lluiImportNames.has('track')) {
    // Pre-scan to detect track() use so cleanupImports strips the import.
    let foundTrackCall = false
    const visitForTrackDetect = (node: ts.Node): void => {
      if (foundTrackCall) return
      if (
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'track'
      ) {
        foundTrackCall = true
        return
      }
      ts.forEachChild(node, visitForTrackDetect)
    }
    visitForTrackDetect(sourceFile)
    if (foundTrackCall) compiledHelpers.add('track')
  }

  function visitor(node: ts.Node): ts.Node {
    // Synthetic nodes (created by ts.factory) don't have real positions
    const hasPos = node.pos >= 0 && node.end >= 0
    const origStart = hasPos ? node.getStart(sourceFile) : -1
    const origEnd = hasPos ? node.getEnd() : -1

    // track({ deps: (s) => [...] }) is a compile-time declaration — paths
    // already in fieldBits, call expression is dead weight. Return an
    // EmptyStatement so the per-statement diff strips it from the output
    // (cleanupImports separately removes the `track` import via the
    // compiledHelpers set populated above).
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'track' &&
      lluiImportNames.has('track')
    ) {
      return f.createEmptyStatement()
    }

    // each() optimizations + row-factory all migrated to modules:
    //   - memo-wrap        → eachMemoModule (v2c/decomp-13)
    //   - item-dedup       → itemDedupModule (v2c/decomp-16)
    //   - structural-mask  → structuralMaskModule (v2c/decomp-14)
    //   - row-factory      → rowFactoryModule (v2c/decomp-18)
    // Phase 2b chains the top-down hooks (memo, dedup, mask, element)
    // then recurses, then fires the bottom-up exit hook (row-factory).
    // The visitor's inline each() block is gone.

    if (ts.isCallExpression(node)) {
      // Pass 1: element rewrite (`div` → `elSplit`/`elTemplate`/
      // `__cloneStaticTemplate`) moved to `elementRewriteModule`
      // (v2c/decomp-17). Phase 2b ran before this visitor; the call
      // is already rewritten on `node` when it was eligible.
      // text() mask injection moved to `textMaskModule` (v2c/decomp-15).
      // Structural-mask injection (each/branch/scope/show) moved to
      // `structuralMaskModule` (v2c/decomp-14). Both ran in Phase 2b
      // before this visitor; nothing to do here.
    }

    // Pass 2: component() metadata splicing. Core synthesis
    // (__update/__handlers/__prefixes) moved to `coreSynthesisModule`
    // (v2c/decomp-19) — fires top-down in Phase 2b before this
    // visitor sees the call. The remaining work here is just the
    // registry-emission splice (per-target __componentMeta,
    // __compilerVersion, __lluiCompilerEmitted, __schemaHash,
    // __stateSchema, __msgSchema, __effectSchema, __msgAnnotations).
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      let result: ts.CallExpression | null = null

      // Extract schema data once — used both for devMode injections and the
      // unconditional __schemaHash (spec §7.4: hash ships in prod too).
      //
      // Resolution priority for each schema:
      //  1. preExtracted.* — used when the plugin's async hook has already
      //     done cross-file + composition extraction (the production path).
      //  2. typeSources.* — file-local extraction against an alternate
      //     source file (legacy path; covers cross-file but not composition).
      //  3. file-local — the test path: extract from `source` itself.
      //
      // When `preExtracted` is provided, treat it as authoritative even
      // when the value is `null` (the resolver was run and found
      // nothing) — falling back to local extraction would mask the
      // resolver's "not extractable" verdict.
      // `msgSchema` previously computed here; uses the pre-hoisted value.
      const msgSchema = hoistedMsgSchema
      // `msgAnnotations` previously computed here; uses the pre-hoisted
      // value so the module + the inline `computeSchemaHash` call see
      // the same input.
      const msgAnnotations = hoistedMsgAnnotations
      // `stateSchema` was previously computed here; it now uses the
      // pre-hoisted value (file-level inputs only). The `__stateSchema`
      // emission migrated to `stateSchemaModule` via the registry
      // bridge — the inline `injectStateSchema` call below deletes.
      const stateSchema = hoistedStateSchema

      const shouldEmitAgentMetadata = devMode || emitAgentMetadata
      if (shouldEmitAgentMetadata) {
        // __msgSchema: migrated to msgSchemaModule (v2c/decomp-5).
        // __msgAnnotations: migrated to msgAnnotationsModule (v2c/decomp-4).
        // __stateSchema: migrated to stateSchemaModule (v2c/decomp-3).
        // __effectSchema: migrated to msgSchemaModule (handles both
        //   the Msg and Effect discriminated-union shapes since they
        //   share the same wire format).
        const effectSchema = hoistedEffectSchema
        void effectSchema // referenced by hoistedEffectSchema's narrow scope; the
        //                  cache snapshot below reads msgSchema directly.
        // Note: binding descriptors are no longer emitted on the
        // component def. They're now collected at runtime by walking
        // event-handler arrows that the `tagEventHandlerSends` pass
        // wrapped with `__lluiVariants` metadata. See
        // `binding-descriptors.ts` (compiler) and the matching
        // `@llui/dom binding-descriptors.ts` (runtime registry).

        // Populate compiler cache — preSource and msgMaskMap are known now;
        // postSource is filled in after the full output is assembled.
        const cachedComponentName = extractComponentNameFromConfig(node)
        if (cachedComponentName) {
          const preSource = extractViewBody(source) ?? ''
          const msgMaskMap: Record<string, number> = {}
          for (const [path, bit] of fieldBits) {
            msgMaskMap[path] = bit
          }
          compilerCache.set(cachedComponentName, {
            preSource,
            postSource: '',
            msgMaskMap,
            bindingSources: [],
          })
        }
      }
      // v2c §2 bridge: registry-emission splicing replaces the inline
      // `injectComponentMeta` here. `componentMetaModule` is registered
      // when `devMode` is true, so the dev-mode gating semantics match
      // the prior `if (devMode)` guard. When `devMode` is false the
      // registry is empty and this call is a no-op.
      result = applyRegistryEmissions(result ?? node, node)

      // v0.4 size-cut (Tier 1.2): synthesize __view = (send) => ({ send, ... })
      // containing ONLY the primitives this component's view callback
      // destructures. The runtime prefers __view over createView for compiled
      // components, eliminating the all-primitives reference chain through
      // view-helpers.ts. Each primitive becomes its own top-level import,
      // tree-shaken by Rollup when no component destructures it.
      result = injectViewBag(result ?? node, viewBagPrimitivesNeeded, f)

      // __schemaHash: migrated to schemaHashModule (v2c/decomp-5).
      // When shouldEmitAgentMetadata is true, schemaHashModule is in
      // the active module list and produces the emission via the
      // bridge. Out-of-agent-mode files don't emit __schemaHash today
      // either (the monolith's inline path was always-on, but the
      // hash only matters when the runtime is in agent mode — see
      // agent spec §12.3). Aligned during the migration.
      //
      // The `msgSchema` / `stateSchema` / `msgAnnotations` variables
      // remain in scope so they can feed the cache snapshot below.
      void msgSchema
      void stateSchema
      void msgAnnotations

      // `__lluiCompilerEmitted` + `__compilerVersion` migrated to
      // `compilerStampModule` (v2c/decomp-10). They flow through the
      // same `applyRegistryEmissions` splice as every other registry
      // contribution; the umbrella now contains zero inline injectors.
      if (result) {
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        return ts.visitEachChild(result, visitor, undefined!)
      }
    }

    return ts.visitEachChild(node, visitor, undefined!)
  }

  let transformed = ts.visitNode(sourceFile, visitor) as ts.SourceFile

  // Pass 3: Clean up imports — use the old cleanupImports approach
  // which operates on the transformed SourceFile safely
  const safeToRemove = new Set([...compiledHelpers].filter((h) => !bailedHelpers.has(h)))
  transformed = cleanupImports(
    transformed,
    lluiImport,
    importedHelpers,
    safeToRemove,
    usesElSplit,
    usesElTemplate,
    usesMemo,
    usesApplyBinding,
    usesCloneStaticTemplate,
    scopeRegistrationsInjected,
    viewBagPrimitivesNeeded,
    usesBindUncertain,
    f,
  )

  if (edits.length === 0) {
    // No element-helper rewrites — but registry may still have
    // collected diagnostics (e.g. agent-rule errors on Msg variants
    // in a Msg-declaration-only file). Surface them so the adapter
    // can fail the build.
    if (registryResult.analysis.diagnostics.length > 0) {
      return { output: source, edits: [], diagnostics: registryResult.analysis.diagnostics }
    }
    return null
  }

  // Find component declarations for HMR and agent metadata
  const componentDecls =
    devMode || emitAgentMetadata ? findComponentDeclarations(sourceFile, lluiImport) : []

  // Build per-statement edits by comparing original vs transformed.
  // Only emit edits for statements that actually changed.
  // Untouched code keeps its original positions → accurate source maps.
  const finalEdits: TransformEdit[] = []
  const origStmts = sourceFile.statements
  const xfStmts = transformed.statements

  for (let i = 0; i < origStmts.length && i < xfStmts.length; i++) {
    const origStart = origStmts[i]!.getStart(sourceFile)
    const origEnd = origStmts[i]!.getEnd()
    const origText = source.slice(origStart, origEnd)

    let xfText: string
    try {
      xfText = printer.printNode(ts.EmitHint.Unspecified, xfStmts[i]!, transformed)
    } catch {
      // Synthetic nodes may fail to print individually — fall back to full reprint
      const { top: _top, bottom: _bottom } = devMode
        ? generateDevCode(componentDecls, mcpPort)
        : { top: '', bottom: '' }
      let output =
        (_top ? _top + '\n' : '') + printer.printFile(transformed) + (_bottom ? '\n' + _bottom : '')
      // Inject the `@llui/dom/internal` import on the fallback path too.
      // The per-statement edit loop (where the normal injection lives)
      // never ran to completion in this branch, so do it inline.
      const internalEditFb = buildInternalImportEdit(
        lluiImport,
        usesBindUncertain,
        usesCloneStaticTemplate,
        usesApplyBinding,
        scopeRegistrationsInjected,
      )
      if (internalEditFb) {
        // Place right after the public `@llui/dom` import in the
        // printed output. The printer normalizes the import to a
        // single line; locate it by string match.
        const m = output.match(/import\s*\{[^}]*\}\s*from\s*['"]@llui\/dom['"];?\n/)
        if (m && m.index !== undefined) {
          const insertAt = m.index + m[0].length
          output = output.slice(0, insertAt) + internalEditFb.replacement + output.slice(insertAt)
        }
      }
      if (devMode || emitAgentMetadata) {
        output = appendCompilerCacheProps(output, componentDecls)
      }
      return {
        output,
        edits: [{ start: 0, end: source.length, replacement: output }],
        diagnostics: registryResult.analysis.diagnostics,
      }
    }

    // Compare ignoring trailing semicolons and whitespace (printer adds them)
    const origNorm = origText.trim().replace(/;$/, '')
    const xfNorm = xfText.trim().replace(/;$/, '')
    if (origNorm !== xfNorm) {
      // Match the original style: if the original didn't end with a semicolon,
      // strip the one the printer added
      const origHasSemi = origText.trimEnd().endsWith(';')
      const replacement = origHasSemi ? xfText : xfText.replace(/;(\s*)$/, '$1')
      finalEdits.push({ start: origStart, end: origEnd, replacement })
    }
  }

  // Compiler-emitted internal helpers ride on `@llui/dom/internal`,
  // not on the public `@llui/dom` barrel. Insert the import as a
  // text-level edit (not an AST statement) so it doesn't disturb the
  // origin↔transformed index pairing the per-statement diff relies on.
  // See cleanupImports' NOTE and buildInternalImportEdit's docstring.
  const internalEdit = buildInternalImportEdit(
    lluiImport,
    usesBindUncertain,
    usesCloneStaticTemplate,
    usesApplyBinding,
    scopeRegistrationsInjected,
  )
  if (internalEdit) finalEdits.push(internalEdit)

  // Dev setup: enable* must run BEFORE user's mountApp (top of file),
  // but import.meta.hot.accept needs to reference user's component vars
  // (bottom of file). So split the injection.
  if (devMode) {
    const { top, bottom } = generateDevCode(componentDecls, mcpPort)
    if (top) finalEdits.push({ start: 0, end: 0, replacement: top + '\n' })
    if (bottom)
      finalEdits.push({ start: source.length, end: source.length, replacement: '\n' + bottom })
  }

  if (finalEdits.length === 0) {
    // No rewrites — but registry may still have collected diagnostics
    // (e.g. bitmask-overflow on an otherwise-clean file). Surface them
    // so the adapter can fail the build.
    if (registryResult.analysis.diagnostics.length > 0) {
      return { output: source, edits: [], diagnostics: registryResult.analysis.diagnostics }
    }
    return null
  }

  // Build the full output by applying edits (for backward compat)
  const sorted = [...finalEdits].sort((a, b) => b.start - a.start)
  let output = source
  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }

  // After output is assembled, update postSource in cache and emit non-enumerable props
  if ((devMode || emitAgentMetadata) && componentDecls.length > 0) {
    const cacheProps = appendCompilerCacheProps(output, componentDecls)
    if (cacheProps !== output) {
      output = cacheProps
    }
  }

  return { output, edits: finalEdits, diagnostics: registryResult.analysis.diagnostics }
}

// ── HMR ──────────────────────────────────────────────────────────

function generateDevCode(
  components: Array<{ varName: string; componentName: string }>,
  mcpPort: number | null,
): { top: string; bottom: string } {
  if (components.length === 0) {
    return {
      top: '',
      bottom: `if (import.meta.hot) {\n  import.meta.hot.accept()\n}`,
    }
  }

  const relayImport = mcpPort !== null ? ', startRelay as __startRelay' : ''
  const relayCall = mcpPort !== null ? `\n__startRelay(${mcpPort})` : ''

  const top = `
import { enableHmr as __enableHmr, replaceComponent as __replaceComponent } from '@llui/dom/hmr'
import { enableDevTools as __enableDevTools${relayImport} } from '@llui/dom/devtools'
__enableHmr()
__enableDevTools()${relayCall}
`.trim()

  const replaceCalls = components
    .map(({ varName, componentName }) => `      __replaceComponent("${componentName}", ${varName})`)
    .join('\n')

  // HMR auto-connect: when the Vite plugin detects that @llui/mcp's
  // active marker file exists or appears, it sends `llui:mcp-ready`
  // with the MCP bridge port. We forward that to __lluiConnect so the
  // browser connects automatically — no console gymnastics, no retry
  // spam, regardless of whether MCP or Vite started first.
  const mcpHmrHandler =
    mcpPort !== null
      ? `
  import.meta.hot.on('llui:mcp-ready', (data) => {
    if (typeof globalThis.__lluiConnect === 'function') {
      globalThis.__lluiConnect(data?.port)
    }
  })`
      : ''

  const bottom = `
if (import.meta.hot) {
  import.meta.hot.accept(() => {
${replaceCalls}
  })${mcpHmrHandler}
}
`.trim()

  return { top, bottom }
}

/** Find all component() calls and extract the variable name and component name */
function findComponentDeclarations(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
): Array<{ varName: string; componentName: string }> {
  const result: Array<{ varName: string; componentName: string }> = []

  function visit(node: ts.Node): void {
    // Match: const Foo = component({ name: 'Foo', ... })
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isComponentCall(node.initializer, lluiImport)
    ) {
      const varName = node.name.text
      const config = node.initializer.arguments[0]
      if (config && ts.isObjectLiteralExpression(config)) {
        for (const prop of config.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'name' &&
            ts.isStringLiteral(prop.initializer)
          ) {
            result.push({ varName, componentName: prop.initializer.text })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return result
}

// ── Helpers ──────────────────────────────────────────────────────

function findLluiImport(sf: ts.SourceFile): ts.ImportDeclaration | null {
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom'
    ) {
      return stmt
    }
  }
  return null
}

function getImportedHelpers(imp: ts.ImportDeclaration): Map<string, string> {
  const map = new Map<string, string>()
  const clause = imp.importClause
  if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return map

  for (const spec of clause.namedBindings.elements) {
    const original = (spec.propertyName ?? spec.name).text
    const local = spec.name.text
    if (ELEMENT_HELPERS.has(original)) {
      map.set(local, original)
    }
  }
  return map
}

function hasComponentDef(sf: ts.SourceFile, lluiImport: ts.ImportDeclaration): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/**
 * Scan for `component({ view: (h) => ... })` arrow functions and collect
 * the identifier name used as the View-bundle parameter. When the user
 * writes `h.show(...)` / `h.text(...)` inside the view, the compiler treats
 * it the same as bare `show(...)` / `text(...)` for mask injection.
 */
function collectViewHelperNames(sf: ts.SourceFile, lluiImport: ts.ImportDeclaration): Set<string> {
  const names = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'view' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            const params = prop.initializer.parameters
            if (params.length >= 1) {
              const first = params[0]!
              if (ts.isIdentifier(first.name)) {
                names.add(first.name.text)
              }
            }
          }
        }
      }
    }
    // Also: any function parameter annotated as `View<...>` — covers extracted
    // view-functions like `function repoPage(h: View<State, Msg>, ...)`.
    if (
      ts.isParameter(node) &&
      node.type &&
      isViewTypeReference(node.type) &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function isViewTypeReference(t: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === 'View'
}

/**
 * Scan for `component({ view: ({ show, each, text, ... }) => ... })`
 * destructured parameters and return a map from the locally-bound name to
 * the primitive name it aliases. This lets users write the bare `show(...)` /
 * `text(...)` forms without importing them, while the compiler still
 * applies mask injection etc.
 *
 *     view: ({ show, text: t }) => [...]
 *     // returns { show → "show", t → "text" }
 */
const VIEW_HELPER_PRIMITIVES = new Set([
  'show',
  'branch',
  'scope',
  'each',
  'text',
  'memo',
  'sample',
  'selector',
  'ctx',
  'slice',
  'send',
])

// v0.4 size-cut (Tier 1.2): bag-field → runtime-primitive map. `ctx` is
// the only rename — every other destructured name maps 1:1 to its
// primitive's exported identifier from `@llui/dom`. Fields not in this
// map (e.g. `send`) are handled separately or omitted.
const VIEW_BAG_FIELD_TO_PRIMITIVE: Record<string, string> = {
  show: 'show',
  branch: 'branch',
  scope: 'scope',
  each: 'each',
  text: 'text',
  unsafeHtml: 'unsafeHtml',
  memo: 'memo',
  selector: 'selector',
  sample: 'sample',
  clientOnly: 'clientOnly',
  ctx: 'useContext',
}

/**
 * Splice a `__view: (send) => ({ send, name1, name2, ... })` property into
 * a `component({...})` call's config-arg literal. The synthesized factory
 * lets the runtime build a minimal view bag that references only the
 * primitives this component's view destructures — replacing the static
 * `createView` call in mount.ts and eliminating its all-primitives import
 * chain. Bag-field names other than `send` are added to `needed` so
 * `cleanupImports` injects matching `@llui/dom` imports at the file level.
 *
 * Idempotent — returns `call` unchanged when:
 *   • the config arg is not an object literal
 *   • no `view:` property exists, or its value is not an arrow/function
 *   • the config arg already has a `__view` property (re-run safety)
 *
 * Bag fields that aren't in `VIEW_BAG_FIELD_TO_PRIMITIVE` (e.g. unknown
 * names from a user-typed View extension) are skipped — the runtime
 * cannot fabricate them, so accessing them at runtime is the user's
 * problem (matches dev-mode behavior).
 *
 * Identifier-style view params (`view: (h) => ...` or `view: (send) => ...`)
 * can't be statically narrowed to a known subset of primitives — `h` may
 * be passed to helpers, destructured later, or read dynamically. For
 * those we emit `__view: ($send) => createView($send)` so the runtime
 * gets the full bag. The instance-level `_viewBag` cache on
 * `getInstanceViewBag` means this is still one allocation per mount.
 */
function injectViewBag(
  call: ts.CallExpression,
  needed: Set<string>,
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = call.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return call

  // Skip if a `__view` is already present (idempotency for re-runs).
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__view'
    ) {
      return call
    }
  }

  // Find view: arrow/function.
  let viewFn: ts.ArrowFunction | ts.FunctionExpression | null = null
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'view' &&
      (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
    ) {
      viewFn = prop.initializer
      break
    }
  }
  if (!viewFn) return call

  const sendParamName = f.createIdentifier('$send')

  // Build the __view factory body. Two shapes:
  //
  //   Destructured param — `view: ({ send, text, each }) => ...`
  //     emit `__view: ($send) => ({ send: $send, text, each })`
  //     (tree-shakes unused primitives — the Tier 1.2 size cut).
  //
  //   Identifier / no param — `view: (h) => ...`, `view: () => ...`,
  //   `view: (send) => ...`, etc.
  //     emit `__view: ($send) => createView($send)`
  //     The compiler can't see which fields `h` is accessed on (it
  //     may be passed to a helper, destructured later, read by
  //     name dynamically). Full bag, instance-cached.
  const firstParam = viewFn.parameters[0]
  const isDestructured = !!firstParam && ts.isObjectBindingPattern(firstParam.name)

  let factoryBody: ts.Expression
  if (isDestructured) {
    // Collect { localName, sourceName } per destructured element.
    interface Entry {
      localName: string
      primitive: string | null // null for `send` — handled separately
    }
    const entries: Entry[] = []
    for (const elem of (firstParam.name as ts.ObjectBindingPattern).elements) {
      const localName = ts.isIdentifier(elem.name) ? elem.name.text : null
      const sourceName =
        elem.propertyName && ts.isIdentifier(elem.propertyName) ? elem.propertyName.text : localName
      if (!localName || !sourceName) continue
      if (sourceName === 'send') {
        entries.push({ localName, primitive: null })
        continue
      }
      const primitive = VIEW_BAG_FIELD_TO_PRIMITIVE[sourceName]
      if (!primitive) continue // unknown name — accessing it at runtime is the user's problem
      entries.push({ localName, primitive })
    }

    const bagProps: ts.ObjectLiteralElementLike[] = []
    for (const e of entries) {
      if (e.primitive === null) {
        bagProps.push(
          e.localName === '$send'
            ? f.createShorthandPropertyAssignment(sendParamName)
            : f.createPropertyAssignment(f.createIdentifier(e.localName), sendParamName),
        )
      } else if (e.localName === e.primitive) {
        bagProps.push(f.createShorthandPropertyAssignment(f.createIdentifier(e.localName)))
        needed.add(e.primitive)
      } else {
        bagProps.push(
          f.createPropertyAssignment(
            f.createIdentifier(e.localName),
            f.createIdentifier(e.primitive),
          ),
        )
        needed.add(e.primitive)
      }
    }
    factoryBody = f.createParenthesizedExpression(f.createObjectLiteralExpression(bagProps, false))
  } else {
    // Identifier-style or zero-arg view: emit `createView($send)` and
    // pull `createView` into the file imports via cleanupImports.
    needed.add('createView')
    factoryBody = f.createCallExpression(f.createIdentifier('createView'), undefined, [
      sendParamName,
    ])
  }

  const viewBagFactory = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(
        undefined,
        undefined,
        sendParamName,
        undefined,
        undefined,
        undefined,
      ),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factoryBody,
  )

  const newConfig = f.createObjectLiteralExpression(
    [...configArg.properties, f.createPropertyAssignment('__view', viewBagFactory)],
    true,
  )
  return f.createCallExpression(call.expression, call.typeArguments, [
    newConfig,
    ...call.arguments.slice(1),
  ])
}

function collectViewHelperAliases(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
  helperNames: Set<string>,
): Map<string, string> {
  const aliases = new Map<string, string>()
  function addFromBindingPattern(pattern: ts.ObjectBindingPattern): void {
    for (const elem of pattern.elements) {
      // { show } → propertyName=undefined, name=show
      // { show: mySh } → propertyName=show, name=mySh
      const sourceName =
        elem.propertyName && ts.isIdentifier(elem.propertyName)
          ? elem.propertyName.text
          : ts.isIdentifier(elem.name)
            ? elem.name.text
            : null
      const localName = ts.isIdentifier(elem.name) ? elem.name.text : null
      if (sourceName && localName && VIEW_HELPER_PRIMITIVES.has(sourceName)) {
        aliases.set(localName, sourceName)
      }
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'view' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            const params = prop.initializer.parameters
            if (params.length >= 1) {
              const first = params[0]!
              if (ts.isObjectBindingPattern(first.name)) {
                addFromBindingPattern(first.name)
              }
            }
          }
        }
      }
    }
    // Also: function parameters like `(…, { show, text }: View<State, Msg>) => …`
    // on extracted helpers — allow the same destructuring ergonomics.
    if (
      ts.isParameter(node) &&
      node.type &&
      isViewTypeReference(node.type) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      addFromBindingPattern(node.name)
    }
    // Also: `const { show, text } = h` assignments where `h` is a known
    // helper binding — lets helpers destructure once at the top of the
    // function body.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      helperNames.has(node.initializer.text)
    ) {
      addFromBindingPattern(node.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return aliases
}

export function isComponentCall(
  node: ts.CallExpression,
  lluiImport: ts.ImportDeclaration,
): boolean {
  if (!ts.isIdentifier(node.expression)) return false
  const name = node.expression.text
  if (name !== 'component') return false
  // Verify it's from the llui import
  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false
  return clause.namedBindings.elements.some(
    (s) => s.name.text === 'component' || (s.propertyName && s.propertyName.text === 'component'),
  )
}

// ── Pass 2: Mask injection ───────────────────────────────────────

/**
 * Match a call expression against a primitive name across all three binding
 * forms:
 *   - bare imported identifier: `name(...)` where `name` was imported from @llui/dom
 *   - destructured alias: `name(...)` where `name` is bound via
 *     `view: (_, { name }) => ...` (or `{ name: alias }`)
 *   - member call: `<h>.name(...)` where `<h>` is the 2nd view parameter
 *
 * The compiler treats all three identically for mask injection / each()
 * optimization purposes.
 */
export function isHelperCall(
  expr: ts.Expression,
  name: string,
  helperNames: Set<string>,
  aliases?: Map<string, string>,
): boolean {
  if (ts.isIdentifier(expr)) {
    if (expr.text === name) return true
    if (aliases && aliases.get(expr.text) === name) return true
    return false
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    helperNames.has(expr.expression.text) &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === name
  ) {
    return true
  }
  return false
}

// text() `__mask` injection — migrated to `textMaskModule`
// (v2c/decomp-15). Module fires top-down (transformCallEnter); the
// visitor sees the masked form.

// `__mask` injection on each()/branch()/scope()/show() — migrated to
// `structuralMaskModule` (v2c/decomp-14). Module fires top-down
// (transformCallEnter) so the visitor sees the masked options literal.

// ── Pass 3: Import cleanup ───────────────────────────────────────

function cleanupImports(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
  _helpers: Map<string, string>,
  compiled: Set<string>,
  usesElSplit: boolean,
  usesElTemplate: boolean,
  usesMemo: boolean,
  usesApplyBinding: boolean,
  usesCloneStaticTemplate: boolean,
  usesRegisterScopeVariants: boolean,
  viewBagPrimitivesNeeded: Set<string>,
  usesBindUncertain: boolean,
  f: ts.NodeFactory,
): ts.SourceFile {
  if (
    compiled.size === 0 &&
    !usesElTemplate &&
    !usesElSplit &&
    !usesMemo &&
    !usesApplyBinding &&
    !usesCloneStaticTemplate &&
    !usesRegisterScopeVariants &&
    viewBagPrimitivesNeeded.size === 0 &&
    !usesBindUncertain
  )
    return sf

  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return sf

  // Public-surface imports stay on `from '@llui/dom'`. Compiler-emitted
  // runtime helpers go on a separate `from '@llui/dom/internal'`
  // declaration so the vite-plugin's post-bundle property-rename pass
  // never rewrites an import specifier against a public export name.
  // See emit-names.ts § COMPILER_DOM_INTERNAL_IMPORTS for the contract.
  const namedBindings = clause.namedBindings
  const remaining = namedBindings.elements.filter((spec) => !compiled.has(spec.name.text))
  const publicHas = (name: string): boolean =>
    remaining.some((s) => s.name.text === name) ||
    namedBindings.elements.some((s) => s.name.text === name)
  const addPublic = (name: string): void => {
    if (!publicHas(name)) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier(name)))
    }
  }

  if (usesElSplit) addPublic('elSplit')
  if (usesElTemplate) addPublic('elTemplate')
  if (usesMemo) addPublic('memo')
  for (const prim of viewBagPrimitivesNeeded) addPublic(prim)

  // NOTE: the compiler-emitted internal helpers (`__bindUncertain`,
  // `__cloneStaticTemplate`, `__runPhase2`, `__handleMsg`,
  // `__registerScopeVariants`) are NOT added here. They live on
  // `@llui/dom/internal`, and the outer transform pipeline inserts a
  // separate `from '@llui/dom/internal'` import via a text-level edit
  // (see `buildInternalImportEdit`). Inserting a new ImportDeclaration
  // here would break the caller's per-statement origin↔transformed
  // index pairing — the statement count would change and trailing
  // statements would silently drop out of the edit list.

  const newBindings = f.createNamedImports(remaining)
  // New TS 6 signature: first arg is `phaseModifier` (undefined =
  // regular import; `ts.SyntaxKind.TypeKeyword` = `import type`).
  // The legacy boolean overload is deprecated.
  const newClause = f.createImportClause(undefined, undefined, newBindings)
  const newImportDecl = f.createImportDeclaration(undefined, newClause, lluiImport.moduleSpecifier)

  let replaced = false
  const statements = sf.statements.map((stmt) => {
    if (
      !replaced &&
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom' &&
      // `phaseModifier === ts.SyntaxKind.TypeKeyword` is `import type
      // …`; we only want to rewrite value imports.
      stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
    ) {
      replaced = true
      return newImportDecl
    }
    return stmt
  })

  return f.updateSourceFile(sf, statements as unknown as ts.Statement[])
}

/**
 * Build a single text-insert edit that places
 * `import { ... } from '@llui/dom/internal'` immediately after the
 * existing `import { ... } from '@llui/dom'` statement (or appends it
 * at the start of the file if no @llui/dom import is found, though
 * the caller has already short-circuited in that case).
 *
 * Returns null when no internal helpers are needed. The edit is text-
 * level (not AST) so it does NOT alter `transformed.statements.length`,
 * keeping the per-statement origin↔transformed pairing intact.
 */
function buildInternalImportEdit(
  lluiImport: ts.ImportDeclaration,
  usesBindUncertain: boolean,
  usesCloneStaticTemplate: boolean,
  usesApplyBinding: boolean,
  usesRegisterScopeVariants: boolean,
): TransformEdit | null {
  const names = new Set<string>()
  if (usesBindUncertain) names.add('__bindUncertain')
  if (usesCloneStaticTemplate) names.add('__cloneStaticTemplate')
  if (usesApplyBinding) {
    names.add('__runPhase2')
    names.add('__handleMsg')
  }
  if (usesRegisterScopeVariants) names.add('__registerScopeVariants')
  if (names.size === 0) return null

  const sortedNames = [...names].sort()
  const importLine = `import { ${sortedNames.join(', ')} } from '@llui/dom/internal'\n`

  const insertAt = lluiImport.getEnd()
  // The lluiImport's getEnd() points to the position right after the
  // statement's trailing `;` or `'\n'`. Emit the new import on a fresh
  // line — `\n` prefix guarantees that even if the original import had
  // no trailing newline.
  return { start: insertAt, end: insertAt, replacement: '\n' + importLine }
}

// ── __msgSchema injection ────────────────────────────────────────

// `injectStateSchema` was the inline emitter for `__stateSchema`.
// Migrated to `stateSchemaModule` + the registry bridge (v2c/decomp-3).
// Behavior preserves end-to-end via the existing transform/HMR tests.

// `stateTypeToLiteral` lives in `state-schema.ts` alongside `StateType`.

// `injectComponentMeta` was the inline emitter for `__componentMeta`.
// Migrated to `componentMetaModule` + the registry bridge in this
// commit. Behavior preserves end-to-end via `registry-bridge.test.ts`.

// `injectMsgSchema`, `injectEffectSchema`, `injectSchemaHash`,
// `buildFieldDescriptorExpr`, `emitEnumValue` all migrated to
// `msgSchemaModule` / `schemaHashModule` (v2c/decomp-5). The
// literal builders live in `msg-schema.ts` alongside the schema
// extraction logic.

// `__lluiCompilerEmitted` + `__compilerVersion` integrity marker
// migrated to `compilerStampModule` (v2c/decomp-10). Always-on through
// the registry bridge — fires regardless of agent/dev mode.

// ── Per-item accessor detection ──────────────────────────────────

// Item selector deduplication — migrated to `itemDedupModule`
// (v2c/decomp-16). Module fires top-down (transformCallEnter); the
// visitor sees the post-dedup form.

// Auto-memoize each() items accessor — migrated to `eachMemoModule`
// (v2c/decomp-13). `tryWrapEachItemsWithMemo`, `accessorAllocatesArray`
// + `ALLOCATING_METHODS` now live in `modules/each-memo.ts`.

// ── Subtree collapse: nested elements → elTemplate ──────────────

const NON_DELEGATION_HELPERS = new Set(['sample', 'item', 'memo', 'text', 'unsafeHtml'])

export function computeAccessorMask(
  accessor: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  fieldBits: Map<string, number>,
  visited: Set<ts.Node> = new Set(),
  fieldBitsHi?: Map<string, number>,
): { mask: number; maskHi: number; readsState: boolean } {
  if (visited.has(accessor)) return { mask: 0, maskHi: 0, readsState: false }
  visited.add(accessor)

  if (accessor.parameters.length === 0)
    return { mask: 0xffffffff | 0, maskHi: 0, readsState: false }

  const paramName = accessor.parameters[0]!.name
  if (!ts.isIdentifier(paramName)) return { mask: 0xffffffff | 0, maskHi: 0, readsState: false }

  // FunctionDeclaration always has a body (we never resolve overloads here);
  // ArrowFunction's body may be a single expression. Both shapes are walked
  // identically by ts.forEachChild, so no special-casing is needed below.
  if (!accessor.body) return { mask: 0xffffffff | 0, maskHi: 0, readsState: false }

  const stateParam = paramName.text
  let mask = 0
  let maskHi = 0
  let readsState = false

  // `inNestedFn` gates only the delegation-recursion. Property-access
  // path extraction happens everywhere — inner-arrow callbacks like
  // `s.items.filter((i) => i.includes(s.filter))` close over our
  // state, and their `s.filter` reads contribute to the mask.
  function walk(node: ts.Node, inNestedFn: boolean): void {
    // `node.parent` can be undefined for synthetic nodes produced by
    // earlier AST-transform passes (the row-factory rewrite and the
    // per-item heuristic both build new sub-trees whose inner nodes
    // have no parent pointers). Guard every parent access below —
    // crashing the whole build on a perfectly valid reactive accessor
    // like `text((_s) => \`$${item.x.toLocaleString()}\`)` was how
    // this bug first surfaced in the persistent-layout example work.
    const parent = node.parent
    if (ts.isIdentifier(node) && node.text === stateParam && (!parent || !ts.isParameter(parent))) {
      readsState = true
    }
    if (ts.isPropertyAccessExpression(node)) {
      // When there's no parent we can't tell if this is the top of a
      // chain, so we resolve from here. That's still correct for mask
      // accounting: `resolveChain` on an inner PAE produces a prefix
      // of the outer chain, which maps to the same `fieldBits` bit
      // via the prefix-match loop below. Worst case we resolve the
      // same chain twice (`|=` is idempotent); best case we'd have
      // resolved once from the real top. Correctness unchanged.
      if (!parent || !ts.isPropertyAccessExpression(parent)) {
        const chain = resolveChain(node, stateParam)
        if (chain) {
          const bit = fieldBits.get(chain)
          const bitHi = fieldBitsHi?.get(chain)
          if (bit !== undefined) {
            mask |= bit
          } else if (bitHi !== undefined) {
            maskHi |= bitHi
          } else {
            // Match paths that overlap our chain in either direction:
            //   - `path` extends `chain` — fieldBits has finer-grained paths
            //     than we're reading (e.g. chain='user', fieldBits has
            //     'user.email').
            //   - `chain` extends `path` — we're reading deeper than what
            //     fieldBits tracks (e.g. chain='items.filter' from
            //     `s.items.filter(...)`, fieldBits has 'items'). Both ends
            //     must mask in: a change to `items` invalidates anything
            //     downstream of it.
            for (const [path, b] of fieldBits) {
              if (path === chain || path.startsWith(chain + '.') || chain.startsWith(path + '.')) {
                mask |= b
              }
            }
            if (fieldBitsHi) {
              for (const [path, b] of fieldBitsHi) {
                if (
                  path === chain ||
                  path.startsWith(chain + '.') ||
                  chain.startsWith(path + '.')
                ) {
                  maskHi |= b
                }
              }
            }
          }
        }
      }
    }
    // Delegation: `helper(s)` where `s` matches our state param.
    // Recurse into the helper's body so its state-path reads
    // contribute to our mask. Only at top level — inside a nested
    // function body, `s` may be shadowed and the call isn't
    // unambiguously handing our state in.
    if (!inNestedFn && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = node.expression.text
      if (!NON_DELEGATION_HELPERS.has(calleeName)) {
        const arg0 = node.arguments[0]
        if (arg0 && ts.isIdentifier(arg0) && arg0.text === stateParam) {
          const resolved = resolveAccessorBody(node.expression)
          if (resolved) {
            const inner = computeAccessorMask(resolved, fieldBits, visited, fieldBitsHi)
            mask |= inner.mask
            maskHi |= inner.maskHi
            if (inner.readsState) readsState = true
          }
        }
      }
    }
    const enteringNested =
      ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
    ts.forEachChild(node, (child) => walk(child, inNestedFn || enteringNested))
  }

  walk(accessor.body, false)

  if (mask === 0 && maskHi === 0 && readsState) {
    return { mask: 0xffffffff | 0, maskHi: 0, readsState: true }
  }
  return { mask, maskHi, readsState }
}

function resolveChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  if (!ts.isIdentifier(current) || current.text !== paramName) return null
  if (parts.length > 2) return parts.slice(0, 2).join('.')
  return parts.join('.')
}

// ── Compiler cache helpers ────────────────────────────────────────

/**
 * Extract the view function body (the value of the `view:` property) from
 * a component() config object literal.  Uses a regex heuristic — good enough
 * for round-tripping source for dev/agent tools.
 */
export function extractViewBody(code: string): string | null {
  const match =
    /\bview\s*:\s*([\s\S]*?)(?=,\s*(?:onEffect|update|init|name|onMsg)\s*:|}\s*\))/m.exec(code)
  return match?.[1]?.trim() ?? null
}

/**
 * Extract the component `name:` string literal from a component() call's
 * first argument object literal in the source text.
 */
export function extractComponentNameFromConfig(node: ts.CallExpression): string | null {
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return null
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'name' &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text
    }
  }
  return null
}

/**
 * Generate Object.defineProperty calls for __preSource, __postSource,
 * __msgMaskMap, and __bindingSources on a component variable.  These are
 * non-enumerable so they don't appear in JSON.stringify(componentDef) but are
 * visible to devtools.
 */
export function generateCompilerCacheProps(varName: string, componentName: string): string {
  const entry = compilerCache.get(componentName)
  if (!entry) return ''
  return (
    `\nObject.defineProperty(${varName}, '__preSource', { value: ${JSON.stringify(entry.preSource)}, enumerable: false, configurable: true })` +
    `\nObject.defineProperty(${varName}, '__postSource', { value: ${JSON.stringify(entry.postSource)}, enumerable: false, configurable: true })` +
    `\nObject.defineProperty(${varName}, '__msgMaskMap', { value: ${JSON.stringify(entry.msgMaskMap)}, enumerable: false, configurable: true })` +
    `\nObject.defineProperty(${varName}, '__bindingSources', { value: ${JSON.stringify(entry.bindingSources)}, enumerable: false, configurable: true })`
  )
}

/**
 * After the full output string is assembled, update each cached component's
 * postSource (extract view body from the transformed output), then append
 * Object.defineProperty calls for all four compiler-cache properties.
 */
export function appendCompilerCacheProps(
  output: string,
  componentDecls: Array<{ varName: string; componentName: string }>,
): string {
  let result = output
  for (const { varName, componentName } of componentDecls) {
    const existing = compilerCache.get(componentName)
    if (!existing) continue
    // Update the cache entry with the post-transform view body
    const postSource = extractViewBody(output) ?? ''
    compilerCache.set(componentName, { ...existing, postSource })
    // Append non-enumerable property definitions
    result += generateCompilerCacheProps(varName, componentName)
  }
  return result
}
