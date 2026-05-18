import ts from 'typescript'
import { collectDeps } from './collect-deps.js'
import {
  resolveLocalConstInitializer,
  resolveAccessorBody,
  isMemoCallWithArrowArg,
} from './accessor-resolver.js'
import { extractMsgSchema, extractEffectSchema } from './msg-schema.js'
import { extractMsgAnnotations } from './msg-annotations.js'
import { extractStateSchema } from './state-schema.js'
// `computeSchemaHash` no longer imported here — `schemaHashModule` owns
// the __schemaHash emission. See modules/schema-hash.ts.
// `tagDispatchHandlers` + `injectScopeVariantRegistrations` are now
// consumed by `bindingDescriptorsModule` via the registry's preTransform
// hook — no longer imported here. See modules/binding-descriptors.ts.
import { compilerCache } from './compiler-cache.js'
import { ModuleRegistry, type CompilerModule, type EmissionContribution } from './module.js'
import { componentMetaModule } from './modules/component-meta.js'
import { stateSchemaModule } from './modules/state-schema.js'
import { msgAnnotationsModule } from './modules/msg-annotations.js'
import { msgSchemaModule } from './modules/msg-schema.js'
import { schemaHashModule } from './modules/schema-hash.js'
import {
  bindingDescriptorsModule,
  BINDING_DESCRIPTORS_SLOT,
} from './modules/binding-descriptors.js'
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

const PROP_KEYS = new Set([
  'value',
  'checked',
  'selected',
  'disabled',
  'readOnly',
  'multiple',
  'indeterminate',
  'defaultValue',
  'defaultChecked',
  'innerHTML',
  'textContent',
])

type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style'

/**
 * A `value` at a reactive-prop position — classified for the compiler.
 *
 * Element-helper props (`{ disabled: X, class: X, title: X, ... }`) and the
 * driver accessor of structural primitives (`each.items`, `branch.on`,
 * `show.when`) accept any callable that takes the state and returns a
 * value. The compiler must distinguish recognized shapes from values it
 * can't safely classify (imports, parameters, opaque expressions) — the
 * latter must bail to the runtime helper, never to a static assignment.
 *
 * Bailing is load-bearing: emitting `__e.disabled = identifier` statically
 * when the runtime value happens to be a function silently binds the
 * function ref to the boolean DOM property and never re-runs.
 */
type ResolvedReactiveBinding =
  | {
      kind: 'arrow'
      accessor: ts.ArrowFunction | ts.FunctionExpression
      valueForBinding: ts.Expression
    }
  | {
      kind: 'fn-decl'
      accessor: ts.FunctionDeclaration
      valueForBinding: ts.Expression
    }
  | {
      kind: 'memo-call'
      accessor: ts.ArrowFunction | ts.FunctionExpression
      valueForBinding: ts.Expression
    }

type ResolvedReactiveValue =
  | ResolvedReactiveBinding
  | { kind: 'static-literal' }
  | { kind: 'bail' }
  | null

function isStaticPrimitiveLiteral(expr: ts.Expression): boolean {
  return (
    ts.isStringLiteral(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  )
}

/**
 * Classify a reactive-prop value. See `ResolvedReactiveValue` for the
 * contract. Returns `null` only when the value is none of the recognized
 * shapes (caller can fall back to its own branches — currently only
 * `tryTransformElementCall` does this for `isPerItemFieldAccess` /
 * `isHoistedPerItem`).
 */
function classifyReactiveValue(value: ts.Expression): ResolvedReactiveValue {
  // Inline arrow / function expression at the call site
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { kind: 'arrow', accessor: value, valueForBinding: value }
  }

  // Inline `memo(arrow)` at the call site
  if (isMemoCallWithArrowArg(value)) {
    return {
      kind: 'memo-call',
      accessor: value.arguments[0] as ts.ArrowFunction | ts.FunctionExpression,
      valueForBinding: value,
    }
  }

  // Identifier — resolve and classify the resolved declaration
  if (ts.isIdentifier(value)) {
    const resolved = resolveLocalConstInitializer(value)
    if (!resolved) {
      // Imported / parameter / unbound — can't prove it's a primitive,
      // can't prove it's a function. Caller must bail to runtime.
      return { kind: 'bail' }
    }
    if (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved)) {
      return { kind: 'arrow', accessor: resolved, valueForBinding: value }
    }
    if (ts.isFunctionDeclaration(resolved)) {
      return { kind: 'fn-decl', accessor: resolved, valueForBinding: value }
    }
    if (isMemoCallWithArrowArg(resolved)) {
      return {
        kind: 'memo-call',
        accessor: resolved.arguments[0] as ts.ArrowFunction | ts.FunctionExpression,
        valueForBinding: value,
      }
    }
    if (isStaticPrimitiveLiteral(resolved)) {
      return { kind: 'static-literal' }
    }
    // Resolved to something else (object/array/expression) — conservative
    // bail. We don't know if the runtime value is a function; the runtime
    // element helper handles both cases correctly.
    return { kind: 'bail' }
  }

  // Static literals at the call site
  if (isStaticPrimitiveLiteral(value)) {
    return { kind: 'static-literal' }
  }

  // CallExpression — caller decides (per-item, etc.)
  return null
}

function classifyKind(key: string): BindingKind {
  if (key === 'class' || key === 'className') return 'class'
  if (key.startsWith('style.')) return 'style'
  if (PROP_KEYS.has(key)) return 'prop'
  return 'attr'
}

function resolveKey(key: string, kind: BindingKind): string {
  if (kind === 'class') return 'class'
  if (kind === 'style') return key.slice(6)
  if (kind === 'prop') return key
  if (key === 'className') return 'class'
  return key
}

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
): { output: string; edits: TransformEdit[] } | null {
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
  if (importedHelpers.size === 0 && !hasReactiveAccessors(sourceFile)) return null

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
  if (devMode) {
    activeModules.push(componentMetaModule)
  }
  if (shouldEmitAgentMetadataAtToplevel) {
    // binding-descriptors fires FIRST so the AST mutations (handler
    // tagging + scope-variant registration) land before any later
    // module's visitor or emit sees the file. The other agent modules
    // then run against the post-binding-descriptors sourceFile.
    activeModules.push(bindingDescriptorsModule)
    // Order matters (v2c §2.1): the three input-producer modules run
    // before schemaHashModule so the inputs slot is populated when
    // schema-hash's emit runs. The registry's emit pass iterates
    // modules in declaration order.
    if (hoistedMsgSchema || hoistedEffectSchema) {
      activeModules.push(
        msgSchemaModule({ msgSchema: hoistedMsgSchema, effectSchema: hoistedEffectSchema }),
      )
    }
    if (hoistedStateSchema) {
      activeModules.push(stateSchemaModule({ stateSchema: hoistedStateSchema }))
    }
    // msgAnnotationsModule populates schema-hash inputs even when the
    // annotation map carries only defaults — the schema-hash is over
    // the full map. Suppression of `__msgAnnotations` emission happens
    // inside the module via `hasNonDefaultAnnotation`.
    if (hoistedMsgAnnotations !== null) {
      activeModules.push(msgAnnotationsModule({ msgAnnotations: hoistedMsgAnnotations }))
    }
  }
  // schemaHashModule registers unconditionally — the monolith emitted
  // `__schemaHash` for every compiled component regardless of agent
  // mode (the hash itself is well-defined for null inputs). The agent
  // producer modules populate the inputs slot when active; their
  // absence flows through as null inputs to the hash.
  activeModules.push(schemaHashModule)
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
  const registryResult = registry.run(sourceFile)
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
    f,
  )

  if (edits.length === 0) return null

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
      if (devMode || emitAgentMetadata) {
        output = appendCompilerCacheProps(output, componentDecls)
      }
      return { output, edits: [{ start: 0, end: source.length, replacement: output }] }
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

  // Dev setup: enable* must run BEFORE user's mountApp (top of file),
  // but import.meta.hot.accept needs to reference user's component vars
  // (bottom of file). So split the injection.
  if (devMode) {
    const { top, bottom } = generateDevCode(componentDecls, mcpPort)
    if (top) finalEdits.push({ start: 0, end: 0, replacement: top + '\n' })
    if (bottom)
      finalEdits.push({ start: source.length, end: source.length, replacement: '\n' + bottom })
  }

  if (finalEdits.length === 0) return null

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

  return { output, edits: finalEdits }
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

function hasReactiveAccessors(sf: ts.SourceFile): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'text' || node.expression.text === 'component') {
        found = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
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

function emitStaticProp(
  staticProps: ts.Statement[],
  f: ts.NodeFactory,
  kind: BindingKind,
  resolvedKey: string,
  value: ts.Expression,
): void {
  switch (kind) {
    case 'class':
      staticProps.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), 'className'),
            ts.SyntaxKind.EqualsToken,
            value,
          ),
        ),
      )
      break
    case 'prop':
      staticProps.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), resolvedKey),
            ts.SyntaxKind.EqualsToken,
            value,
          ),
        ),
      )
      break
    case 'style':
      staticProps.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(
              f.createPropertyAccessExpression(f.createIdentifier('__e'), 'style'),
              'setProperty',
            ),
            undefined,
            [f.createStringLiteral(resolvedKey), value],
          ),
        ),
      )
      break
    default: // attr
      staticProps.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), 'setAttribute'),
            undefined,
            [f.createStringLiteral(resolvedKey), value],
          ),
        ),
      )
  }
}

// ── Pass 1: Element → elSplit ────────────────────────────────────

export function tryTransformElementCall(
  node: ts.CallExpression,
  helpers: Map<string, string>,
  fieldBits: Map<string, number>,
  compiled: Set<string>,
  bailed: Set<string>,
  f: ts.NodeFactory,
  fieldBitsHi: Map<string, number> = new Map(),
): ts.CallExpression | null {
  if (!ts.isIdentifier(node.expression)) return null
  const localName = node.expression.text
  const originalName = helpers.get(localName)
  if (!originalName) return null

  // Handle children-only overload: `div([...])` — first arg is the children array.
  // Normalize to props=undefined, children=firstArg so downstream logic works.
  const firstArg = node.arguments[0]
  const usesChildrenOnlyOverload = firstArg && ts.isArrayLiteralExpression(firstArg)
  const propsArg = usesChildrenOnlyOverload ? undefined : firstArg
  if (propsArg && !ts.isObjectLiteralExpression(propsArg)) {
    bailed.add(localName)
    return null
  }
  // Bail on spread assignments (`...parts.root`) — the compiler cannot
  // statically classify spread contents, and silently dropping them would
  // break consumers (e.g. @llui/components parts spreading). Fall back to
  // the runtime element helper so spreads are applied normally.
  if (
    propsArg &&
    ts.isObjectLiteralExpression(propsArg) &&
    propsArg.properties.some((p) => ts.isSpreadAssignment(p))
  ) {
    bailed.add(localName)
    return null
  }

  const tag = f.createStringLiteral(originalName)

  // Classify props
  const staticProps: ts.Statement[] = []
  const events: ts.ArrayLiteralExpression[] = []
  const bindings: ts.ArrayLiteralExpression[] = []

  if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
    for (const prop of propsArg.properties) {
      // Handle both PropertyAssignment (key: value) and ShorthandPropertyAssignment ({ id })
      let key: string
      let value: ts.Expression

      if (ts.isPropertyAssignment(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue
        key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text
        value = prop.initializer
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        key = prop.name.text
        value = prop.name // The identifier itself is the value
      } else {
        continue
      }
      if (key === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(key)) {
        const eventName = key.slice(2).toLowerCase()
        events.push(f.createArrayLiteralExpression([f.createStringLiteral(eventName), value]))
        continue
      }

      // Per-item shapes — handled before the general classifier because
      // they appear inside `each().render` callbacks where `item` is a
      // closed-over per-row accessor (zero-arg). The resolver above can't
      // see them; they're shape-matched syntactically.
      if (isPerItemFieldAccess(value) || isHoistedPerItem(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push(
          f.createArrayLiteralExpression([
            createMaskLiteral(f, 0xffffffff | 0),
            f.createStringLiteral(kind),
            f.createStringLiteral(resolvedKey),
            value,
          ]),
        )
        continue
      }
      if (ts.isCallExpression(value) && isPerItemCall(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push(
          f.createArrayLiteralExpression([
            createMaskLiteral(f, 0xffffffff | 0),
            f.createStringLiteral(kind),
            f.createStringLiteral(resolvedKey),
            value,
          ]),
        )
        continue
      }

      // Classify the value at a reactive-prop position:
      //   - inline arrow / fn-expr at the call site
      //   - inline `memo(arrow)` at the call site
      //   - Identifier referencing a const-bound arrow/fn-expr in scope
      //   - Identifier referencing a hoisted function declaration in scope
      //   - Identifier referencing `const x = memo(arrow)` in scope
      //   - Identifier referencing a static primitive literal
      //   - Anything else (imports, parameters, opaque expressions) — bail
      //     to runtime; the runtime helper handles `typeof v === 'function'`
      //     correctly for both function and primitive values.
      const classified = classifyReactiveValue(value)
      if (classified === null) {
        // Unknown shape (a CallExpression that isn't memo/per-item, etc.)
        // — historically bailed to runtime. Preserve that.
        bailed.add(localName)
        return null
      }
      if (classified.kind === 'bail') {
        bailed.add(localName)
        return null
      }
      if (classified.kind === 'static-literal') {
        // Fall through to emitStaticProp (`__e.disabled = X`). Safe because
        // we proved X is a primitive.
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        emitStaticProp(staticProps, f, kind, resolvedKey, value)
        continue
      }
      // 'arrow' | 'fn-decl' | 'memo-call' — emit as a binding tuple. Mask is
      // analyzed from the resolved accessor body (or the inner arrow inside
      // a memo() call); the value emitted into the binding tuple is what the
      // runtime calls as `accessor(state)` — for inline arrows we keep the
      // arrow itself (preserves the historical inlining behavior), for
      // identifier-bound forms we keep the identifier so consumers see
      // a single canonical reference (and `memo()` proxies aren't rebuilt
      // per render).
      {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, maskHi, readsState } = computeAccessorMask(
          classified.accessor,
          fieldBits,
          undefined,
          fieldBitsHi,
        )

        // Zero-mask constant folding only applies to inline arrows whose body
        // we can safely call at compile time. For identifier-bound forms
        // (`accessor !== value`) we skip the fold — calling the identifier's
        // declaration at compile time would be unsafe (different scope) and
        // calling the identifier in the emitted output would defeat the point.
        if (
          classified.kind === 'arrow' &&
          classified.accessor === value &&
          mask === 0 &&
          maskHi === 0 &&
          !readsState
        ) {
          emitStaticProp(
            staticProps,
            f,
            kind,
            resolvedKey,
            f.createCallExpression(classified.accessor, undefined, []),
          )
          continue
        }

        const effectiveMask = mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask
        // Emit a 5-tuple only when the accessor reads a high-word
        // prefix (positions 31..61). For the common ≤31-prefix case
        // the emit stays byte-identical to the pre-multi-word baseline,
        // and stale runtime bundles ignore the 5th slot.
        const tupleEls = [
          createMaskLiteral(f, effectiveMask),
          f.createStringLiteral(kind),
          f.createStringLiteral(resolvedKey),
          classified.valueForBinding,
        ]
        if (maskHi !== 0) tupleEls.push(createMaskLiteral(f, maskHi))
        bindings.push(f.createArrayLiteralExpression(tupleEls))
      }
    }
  }

  // Build elSplit args
  const staticFn =
    staticProps.length > 0
      ? f.createArrowFunction(
          undefined,
          undefined,
          [f.createParameterDeclaration(undefined, undefined, '__e')],
          undefined,
          f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          f.createBlock(staticProps, true),
        )
      : f.createNull()

  const eventsArr = events.length > 0 ? f.createArrayLiteralExpression(events) : f.createNull()

  const bindingsArr =
    bindings.length > 0 ? f.createArrayLiteralExpression(bindings) : f.createNull()

  const children = usesChildrenOnlyOverload
    ? node.arguments[0]!
    : (node.arguments[1] ?? f.createNull())

  compiled.add(localName)

  // Subtree collapse: if children contain nested element helpers,
  // collapse the entire tree into a single elTemplate() call
  const analyzed = analyzeSubtree(node, helpers, fieldBits, [], fieldBitsHi)
  if (analyzed && hasNestedElements(analyzed)) {
    // Mark all descendant helpers as compiled for import cleanup
    collectUsedHelpers(analyzed, compiled)
    const templateCall = emitSubtreeTemplate(analyzed, fieldBits, f)
    return templateCall
  }

  // Static subtree prerendering: if no events, no bindings, and children
  // are all static text, emit a <template> clone
  if (events.length === 0 && bindings.length === 0 && isStaticChildren(children)) {
    const html = buildStaticHTML(originalName, staticProps, children, f)
    if (html) {
      return emitTemplateClone(html, f) as ts.CallExpression
    }
  }

  const call = f.createCallExpression(f.createIdentifier('elSplit'), undefined, [
    tag,
    staticFn,
    eventsArr,
    bindingsArr,
    children,
  ])
  ts.addSyntheticLeadingComment(call, ts.SyntaxKind.MultiLineCommentTrivia, '@__PURE__', false)
  return call
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
  f: ts.NodeFactory,
): ts.SourceFile {
  if (
    compiled.size === 0 &&
    !usesElTemplate &&
    !usesElSplit &&
    !usesMemo &&
    !usesApplyBinding &&
    !usesCloneStaticTemplate &&
    !usesRegisterScopeVariants
  )
    return sf

  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return sf

  const remaining = clause.namedBindings.elements.filter((spec) => !compiled.has(spec.name.text))

  const hasElSplit = clause.namedBindings.elements.some((s) => s.name.text === 'elSplit')
  if (!hasElSplit && usesElSplit) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elSplit')))
  }

  const hasElTemplate = clause.namedBindings.elements.some((s) => s.name.text === 'elTemplate')
  if (!hasElTemplate && usesElTemplate) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elTemplate')))
  }

  const hasCloneStaticTemplate = clause.namedBindings.elements.some(
    (s) => s.name.text === '__cloneStaticTemplate',
  )
  if (!hasCloneStaticTemplate && usesCloneStaticTemplate) {
    remaining.push(
      f.createImportSpecifier(false, undefined, f.createIdentifier('__cloneStaticTemplate')),
    )
  }

  const hasMemo = clause.namedBindings.elements.some((s) => s.name.text === 'memo')
  if (!hasMemo && usesMemo) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('memo')))
  }

  if (usesApplyBinding) {
    if (!clause.namedBindings.elements.some((s) => s.name.text === '__runPhase2')) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('__runPhase2')))
    }
    if (!clause.namedBindings.elements.some((s) => s.name.text === '__handleMsg')) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('__handleMsg')))
    }
  }

  // The connect-pattern injector (binding-descriptors.ts) emits
  // `__registerScopeVariants([...])` calls; ensure the runtime
  // helper is imported when at least one was inserted.
  const hasRegisterScopeVariants = clause.namedBindings.elements.some(
    (s) => s.name.text === '__registerScopeVariants',
  )
  if (!hasRegisterScopeVariants && usesRegisterScopeVariants) {
    remaining.push(
      f.createImportSpecifier(false, undefined, f.createIdentifier('__registerScopeVariants')),
    )
  }

  const newBindings = f.createNamedImports(remaining)
  const newClause = f.createImportClause(false, undefined, newBindings)
  const newImportDecl = f.createImportDeclaration(undefined, newClause, lluiImport.moduleSpecifier)

  let replaced = false
  const statements = sf.statements.map((stmt) => {
    if (
      !replaced &&
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom' &&
      !stmt.importClause?.isTypeOnly
    ) {
      replaced = true
      return newImportDecl
    }
    return stmt
  })

  return f.updateSourceFile(sf, statements as unknown as ts.Statement[])
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

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

interface AnalyzedNode {
  tag: string
  localName: string
  /** Static HTML attributes (class, id, etc.) */
  staticAttrs: Array<[string, string]>
  /** Event handlers: [eventName, handlerExpression] */
  events: Array<[string, ts.Expression]>
  /** Reactive bindings: [mask, maskHi, kind, key, accessor]. `maskHi` is
   *  0 for low-word-only bindings (the common case) and a non-zero
   *  high-word mask when the accessor reads a prefix at bit position
   *  31..61. Emit serializes maskHi as a 5th tuple slot only when
   *  non-zero — see `__bind` / elSplit's tuple-length detection. */
  bindings: Array<[number, number, string, string, ts.Expression]>
  /** Children: analyzed elements, static text, or reactive text */
  children: AnalyzedChild[]
  /** Path from template root as childNodes indices */
  path: number[]
}

type AnalyzedChild =
  | { type: 'element'; node: AnalyzedNode }
  | { type: 'staticText'; value: string }
  | {
      type: 'reactiveText'
      accessor: ts.Expression
      mask: number
      maskHi: number
      childIdx: number
    }

/**
 * Try to analyze an element call and all its descendants as a collapsible subtree.
 * Returns null if any part of the tree is not eligible for collapse.
 */
function analyzeSubtree(
  node: ts.CallExpression,
  helpers: Map<string, string>,
  fieldBits: Map<string, number>,
  path: number[],
  fieldBitsHi: Map<string, number> = new Map(),
): AnalyzedNode | null {
  if (!ts.isIdentifier(node.expression)) return null
  const localName = node.expression.text
  const tag = helpers.get(localName)
  if (!tag) return null

  // Handle children-only overload: `div([...])` — first arg is the children array.
  // In that case, treat it as no props + children=firstArg.
  const firstArg = node.arguments[0]
  const usesChildrenOnlyOverload = firstArg && ts.isArrayLiteralExpression(firstArg)
  const propsArg = usesChildrenOnlyOverload ? undefined : firstArg
  const childrenArg = usesChildrenOnlyOverload ? firstArg : node.arguments[1]

  if (propsArg && !ts.isObjectLiteralExpression(propsArg)) return null

  const staticAttrs: Array<[string, string]> = []
  const events: Array<[string, ts.Expression]> = []
  const bindings: Array<[number, number, string, string, ts.Expression]> = []

  if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
    for (const prop of propsArg.properties) {
      let key: string
      let value: ts.Expression

      if (ts.isPropertyAssignment(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) return null
        key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text
        value = prop.initializer
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        key = prop.name.text
        value = prop.name
      } else {
        return null
      }
      if (key === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(key)) {
        events.push([key.slice(2).toLowerCase(), value])
        continue
      }

      // Resolve identifier → local const arrow initializer (see elSplit
      // path for the full rationale).
      if (ts.isIdentifier(value)) {
        const resolved = resolveLocalConstInitializer(value)
        if (resolved && (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved))) {
          value = resolved
        }
      }

      // Reactive binding
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, maskHi, readsState } = computeAccessorMask(
          value,
          fieldBits,
          undefined,
          fieldBitsHi,
        )
        if (mask === 0 && maskHi === 0 && !readsState) {
          // Constant fold — treat as static if we can extract a string
          const staticVal = tryExtractStaticString(value)
          if (staticVal !== null) {
            const attrKey = kind === 'class' ? 'class' : resolvedKey
            staticAttrs.push([attrKey, staticVal])
            continue
          }
        }
        const finalMask = mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask
        bindings.push([finalMask, maskHi, kind, resolvedKey, value])
        continue
      }

      // Per-item accessor call
      if (ts.isCallExpression(value) && isPerItemCall(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push([0xffffffff | 0, 0, kind, resolvedKey, value])
        continue
      }

      // Per-item property access: item.field (or hoisted __a0/__a1/…)
      if (isPerItemFieldAccess(value) || isHoistedPerItem(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push([0xffffffff | 0, 0, kind, resolvedKey, value])
        continue
      }

      // Static literal prop
      if (ts.isStringLiteral(value)) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, value.text])
        continue
      }
      if (ts.isNumericLiteral(value)) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, value.text])
        continue
      }
      if (value.kind === ts.SyntaxKind.TrueKeyword) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, ''])
        continue
      }

      // Non-literal prop — can't collapse
      return null
    }
  }

  // Analyze children
  const children: AnalyzedChild[] = []

  if (childrenArg && ts.isArrayLiteralExpression(childrenArg)) {
    let childIdx = 0
    for (const child of childrenArg.elements) {
      // String literal child — static text node
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        children.push({ type: 'staticText', value: child.text })
        childIdx++
        continue
      }

      // text('literal') — static text
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === 'text'
      ) {
        if (child.arguments.length >= 1 && ts.isStringLiteral(child.arguments[0]!)) {
          children.push({ type: 'staticText', value: child.arguments[0]!.text })
          childIdx++ // static text creates a text node in the template DOM
          continue
        }
        // Reactive text — accessor is first arg
        const accessor = child.arguments[0]!
        if (ts.isArrowFunction(accessor) || ts.isFunctionExpression(accessor)) {
          const { mask, maskHi, readsState } = computeAccessorMask(
            accessor,
            fieldBits,
            undefined,
            fieldBitsHi,
          )
          children.push({
            type: 'reactiveText',
            accessor,
            mask: mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask,
            maskHi,
            childIdx,
          })
          childIdx++ // placeholder text node in template
          continue
        }
        // Per-item text: text(item(t => t.label))
        if (ts.isCallExpression(accessor) && isPerItemCall(accessor)) {
          children.push({
            type: 'reactiveText',
            accessor,
            mask: 0xffffffff | 0,
            maskHi: 0,
            childIdx,
          })
          childIdx++ // placeholder text node in template
          continue
        }
        // Per-item text via property access: text(item.label)
        // Also matches hoisted __a0/__a1/… identifiers produced by dedup.
        if (isPerItemFieldAccess(accessor) || isHoistedPerItem(accessor)) {
          children.push({
            type: 'reactiveText',
            accessor,
            mask: 0xffffffff | 0,
            maskHi: 0,
            childIdx,
          })
          childIdx++
          continue
        }
        return null // unsupported text() form
      }

      // Element helper call — recurse
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        helpers.has(child.expression.text)
      ) {
        const childNode = analyzeSubtree(
          child,
          helpers,
          fieldBits,
          [...path, childIdx],
          fieldBitsHi,
        )
        if (!childNode) return null
        children.push({ type: 'element', node: childNode })
        childIdx++
        continue
      }

      // Anything else (each, branch, show, arbitrary expressions) — bail
      return null
    }

    // Note: mixed static + reactive text in the same parent is now supported
    // because reactive text uses <!--$--> comment placeholders that break
    // text-node merging at parse time.
  } else if (childrenArg && childrenArg.kind !== ts.SyntaxKind.NullKeyword) {
    // Non-array children (e.g., spread, variable) — bail
    return null
  }

  return { tag, localName, staticAttrs, events, bindings, children, path }
}

function tryExtractStaticString(accessor: ts.ArrowFunction | ts.FunctionExpression): string | null {
  const body = ts.isArrowFunction(accessor) ? accessor.body : null
  if (body && ts.isStringLiteral(body)) return body.text
  return null
}

/**
 * Check if a subtree has any nested element children (worth collapsing).
 */
function hasNestedElements(node: AnalyzedNode): boolean {
  return node.children.some((c) => c.type === 'element')
}

/**
 * Collect all local helper names used in the subtree for import cleanup.
 */
function collectUsedHelpers(node: AnalyzedNode, out: Set<string>): void {
  out.add(node.localName)
  for (const child of node.children) {
    if (child.type === 'element') collectUsedHelpers(child.node, out)
  }
}

/**
 * Build the static HTML string from an analyzed subtree.
 */
function buildTemplateHTML(node: AnalyzedNode): string {
  let html = `<${node.tag}`
  for (const [key, value] of node.staticAttrs) {
    html += ` ${key}="${escapeAttr(value)}"`
  }
  html += '>'

  if (VOID_ELEMENTS.has(node.tag)) return html

  for (let ci = 0; ci < node.children.length; ci++) {
    const child = node.children[ci]!
    if (child.type === 'staticText') {
      html += escapeHTML(child.value)
    } else if (child.type === 'element') {
      html += buildTemplateHTML(child.node)
    } else if (child.type === 'reactiveText') {
      // When the reactive text is not adjacent to another text-type child,
      // we can use a literal text node placeholder instead of a comment.
      // The cloned text node is reused in the patch function — no
      // createTextNode + replaceChild needed. This saves 2 DOM operations
      // per text binding per row.
      //
      // When adjacent text WOULD cause HTML-parser merging (two text nodes
      // collapse into one), we fall back to the comment placeholder.
      const prev = ci > 0 ? node.children[ci - 1]! : null
      const next = ci < node.children.length - 1 ? node.children[ci + 1]! : null
      const adjText =
        prev?.type === 'staticText' ||
        prev?.type === 'reactiveText' ||
        next?.type === 'staticText' ||
        next?.type === 'reactiveText'
      if (adjText) {
        html += '<!--$-->'
      } else {
        // Space character becomes a Text node in the cloned template.
        // Mark the child so the patch codegen knows to skip replaceChild.
        html += ' '
        ;(child as { inlineText?: boolean }).inlineText = true
      }
    }
  }

  html += `</${node.tag}>`
  return html
}

interface PatchOp {
  /** Variable name for this node (e.g., __n0) */
  varName: string
  /** Expression to walk to this node from root */
  walkExpr: ts.Expression
  /** Event listeners to attach */
  events: Array<[string, ts.Expression]>
  /** Bindings to register via __bind: [mask, maskHi, kind, key, accessor] */
  bindings: Array<[number, number, string, string, ts.Expression]>
  /** Reactive text children — reference existing placeholder text nodes */
  reactiveTexts: Array<{
    accessor: ts.Expression
    mask: number
    maskHi: number
    childIdx: number
  }>
}

/**
 * Collect all patch operations from an analyzed subtree.
 */
function collectPatchOps(
  node: AnalyzedNode,
  f: ts.NodeFactory,
  rootExpr: ts.Expression,
  ops: PatchOp[],
  counter: { n: number; t: number },
): void {
  const hasDynamic =
    node.events.length > 0 ||
    node.bindings.length > 0 ||
    node.children.some((c) => c.type === 'reactiveText')

  let nodeExpr = rootExpr

  if (hasDynamic) {
    const varName = `__n${counter.n++}`
    // Build walk expression: root.childNodes[i].childNodes[j]...
    nodeExpr = f.createIdentifier(varName)
    ops.push({
      varName,
      walkExpr: buildWalkExpr(node.path, f),
      events: node.events,
      bindings: node.bindings,
      reactiveTexts: node.children.filter(
        (c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText',
      ),
    })
  }

  // Recurse into element children
  for (const child of node.children) {
    if (child.type === 'element') {
      collectPatchOps(child.node, f, nodeExpr, ops, counter)
    }
  }
}

function buildWalkExpr(path: number[], f: ts.NodeFactory): ts.Expression {
  let expr: ts.Expression = f.createIdentifier('root')
  for (const idx of path) {
    // Use firstChild + nextSibling chain instead of childNodes[n]
    // firstChild/nextSibling are direct pointer lookups, childNodes is a live NodeList
    expr = f.createPropertyAccessExpression(expr, 'firstChild')
    for (let i = 0; i < idx; i++) {
      expr = f.createPropertyAccessExpression(expr, 'nextSibling')
    }
  }
  return expr
}

/**
 * Emit elTemplate(htmlString, (root, __bind) => { ... }) call.
 */
function emitSubtreeTemplate(
  analyzed: AnalyzedNode,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression {
  const html = buildTemplateHTML(analyzed)
  const ops: PatchOp[] = []
  const counter = { n: 0, t: 0 }

  // Collect root-level patches
  const rootHasDynamic =
    analyzed.events.length > 0 ||
    analyzed.bindings.length > 0 ||
    analyzed.children.some((c) => c.type === 'reactiveText')

  if (rootHasDynamic) {
    ops.push({
      varName: '', // use 'root' directly
      walkExpr: f.createIdentifier('root'),
      events: analyzed.events,
      bindings: analyzed.bindings,
      reactiveTexts: analyzed.children.filter(
        (c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText',
      ),
    })
  }

  // Collect child patches
  for (const child of analyzed.children) {
    if (child.type === 'element') {
      collectPatchOps(child.node, f, f.createIdentifier('root'), ops, counter)
    }
  }

  // Collect delegatable events: group by event type across all ops
  // Events on child nodes with the same type are delegated to the root
  const delegatableEvents = new Map<string, Array<{ nodeVar: string; handler: ts.Expression }>>()
  for (const op of ops) {
    for (const [eventName, handler] of op.events) {
      if (!op.varName) {
        // Root-level events — can't delegate further up
        continue
      }
      const list = delegatableEvents.get(eventName)
      if (list) list.push({ nodeVar: op.varName, handler })
      else delegatableEvents.set(eventName, [{ nodeVar: op.varName, handler }])
    }
  }

  // Build patch function body
  const stmts: ts.Statement[] = []

  for (const op of ops) {
    const nodeRef = op.varName ? f.createIdentifier(op.varName) : f.createIdentifier('root')

    // Variable declaration for walking to node
    if (op.varName) {
      stmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(op.varName, undefined, undefined, op.walkExpr)],
            ts.NodeFlags.Const,
          ),
        ),
      )
    }

    // Non-delegatable events (root-level or single-use event types)
    for (const [eventName, handler] of op.events) {
      const delegated = delegatableEvents.get(eventName)
      if (op.varName && delegated && delegated.length >= 2) continue // handled below
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(nodeRef, 'addEventListener'),
            undefined,
            [f.createStringLiteral(eventName), handler],
          ),
        ),
      )
    }

    // Reactive text children — walk to placeholder, create text node, bind
    for (const rt of op.reactiveTexts) {
      const tVar = `__t${counter.t++}`
      const isInline = !!(rt as { inlineText?: boolean }).inlineText

      if (isInline) {
        // Inline text placeholder: the template HTML has a space character
        // that cloneNode already created as a Text node. Walk to it and
        // bind directly — no createTextNode, no replaceChild.
        let walk: ts.Expression = f.createPropertyAccessExpression(nodeRef, 'firstChild')
        for (let i = 0; i < rt.childIdx; i++) {
          walk = f.createPropertyAccessExpression(walk, 'nextSibling')
        }
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(tVar, undefined, undefined, walk)],
              ts.NodeFlags.Const,
            ),
          ),
        )
      } else {
        // Comment placeholder: create a new text node and replace the comment.
        const cVar = `__c${counter.t - 1}`
        let walk: ts.Expression = f.createPropertyAccessExpression(nodeRef, 'firstChild')
        for (let i = 0; i < rt.childIdx; i++) {
          walk = f.createPropertyAccessExpression(walk, 'nextSibling')
        }
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(cVar, undefined, undefined, walk)],
              ts.NodeFlags.Const,
            ),
          ),
        )
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  tVar,
                  undefined,
                  undefined,
                  f.createCallExpression(
                    f.createPropertyAccessExpression(f.createIdentifier('__dom'), 'createTextNode'),
                    undefined,
                    [f.createStringLiteral('')],
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
        )
        stmts.push(
          f.createExpressionStatement(
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(f.createIdentifier(cVar), 'parentNode'),
                'replaceChild',
              ),
              undefined,
              [f.createIdentifier(tVar), f.createIdentifier(cVar)],
            ),
          ),
        )
      }
      // __bind(__t0, mask, 'text', undefined, accessor, [maskHi])
      const rtArgs: ts.Expression[] = [
        f.createIdentifier(tVar),
        createMaskLiteral(f, rt.mask),
        f.createStringLiteral('text'),
        f.createIdentifier('undefined'),
        rt.accessor,
      ]
      // Only pass the 6th positional arg when the accessor reads a
      // high-word prefix. Keeps the emit byte-identical to the
      // pre-multi-word baseline for the common case.
      if (rt.maskHi !== 0) rtArgs.push(createMaskLiteral(f, rt.maskHi))
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, rtArgs),
        ),
      )
    }

    // Reactive bindings — __bind(node, mask, kind, key, accessor, [maskHi])
    for (const [mask, maskHi, kind, key, accessor] of op.bindings) {
      const args: ts.Expression[] = [
        nodeRef,
        createMaskLiteral(f, mask),
        f.createStringLiteral(kind),
        key ? f.createStringLiteral(key) : f.createIdentifier('undefined'),
        accessor,
      ]
      if (maskHi !== 0) args.push(createMaskLiteral(f, maskHi))
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, args),
        ),
      )
    }
  }

  // Emit delegated event listeners on root
  for (const [eventName, entries] of delegatableEvents) {
    if (entries.length < 2) continue
    // root.onclick = (e) => { if (n1.contains(e.target)) { h1(); return } if (n2.contains(e.target)) { h2(); return } }
    const eParam = f.createIdentifier('__e')
    const eTarget = f.createPropertyAccessExpression(eParam, 'target')

    const ifStmts: ts.Statement[] = []
    for (const { nodeVar, handler } of entries) {
      // if (nodeVar.contains(e.target)) { handler(e); return }
      ifStmts.push(
        f.createIfStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier(nodeVar), 'contains'),
            undefined,
            [eTarget],
          ),
          f.createBlock(
            [
              f.createExpressionStatement(f.createCallExpression(handler, undefined, [eParam])),
              f.createReturnStatement(),
            ],
            true,
          ),
        ),
      )
    }

    const delegateHandler = f.createArrowFunction(
      undefined,
      undefined,
      [f.createParameterDeclaration(undefined, undefined, '__e')],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock(ifStmts, true),
    )

    // root.addEventListener(eventName, handler)
    stmts.push(
      f.createExpressionStatement(
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier('root'), 'addEventListener'),
          undefined,
          [f.createStringLiteral(eventName), delegateHandler],
        ),
      ),
    )
  }

  // (root, __bind, __dom) => { ... }
  const patchFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'root'),
      f.createParameterDeclaration(undefined, undefined, '__bind'),
      f.createParameterDeclaration(undefined, undefined, '__dom'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(stmts, true),
  )

  const call = f.createCallExpression(f.createIdentifier('elTemplate'), undefined, [
    f.createStringLiteral(html),
    patchFn,
  ])

  return call
}

// ── Static subtree detection ─────────────────────────────────────

function isStaticChildren(children: ts.Expression): boolean {
  if (children.kind === ts.SyntaxKind.NullKeyword) return true
  if (!ts.isArrayLiteralExpression(children)) return false
  return children.elements.every((child) => {
    // text('literal') — static text
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'text'
    ) {
      return child.arguments.length === 1 && ts.isStringLiteral(child.arguments[0]!)
    }
    // Another elSplit or element helper that was already determined static
    // For now, only handle text() children
    return false
  })
}

function buildStaticHTML(
  tag: string,
  staticProps: ts.Statement[],
  children: ts.Expression,
  _f: ts.NodeFactory,
): string | null {
  // Extract static attributes from staticFn statements
  let attrs = ''
  for (const stmt of staticProps) {
    if (!ts.isExpressionStatement(stmt)) return null
    const expr = stmt.expression
    // __e.className = 'value'
    if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
      const prop = expr.left.name.text
      if (prop === 'className' && ts.isStringLiteral(expr.right)) {
        attrs += ` class="${escapeAttr(expr.right.text)}"`
      }
    }
    // __e.setAttribute('key', 'value')
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      if (expr.expression.name.text === 'setAttribute' && expr.arguments.length === 2) {
        const key = expr.arguments[0]
        const val = expr.arguments[1]
        if (key && val && ts.isStringLiteral(key) && ts.isStringLiteral(val)) {
          attrs += ` ${key.text}="${escapeAttr(val.text)}"`
        } else {
          return null // non-literal attribute
        }
      }
    }
  }

  // Extract text children
  let inner = ''
  if (ts.isArrayLiteralExpression(children)) {
    for (const child of children.elements) {
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === 'text'
      ) {
        if (ts.isStringLiteral(child.arguments[0]!)) {
          inner += escapeHTML(child.arguments[0]!.text)
        } else {
          return null
        }
      } else {
        return null
      }
    }
  }

  return `<${tag}${attrs}>${inner}</${tag}>`
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function emitTemplateClone(html: string, f: ts.NodeFactory): ts.Expression {
  // Emits: __cloneStaticTemplate("<html>")
  //
  // The helper lives in `@llui/dom` and threads through `ctx.dom` so SSR
  // under jsdom/linkedom works without touching globalThis. The import
  // cleanup pass (see cleanupImports) auto-injects the import when this
  // emission fires.
  return f.createCallExpression(f.createIdentifier('__cloneStaticTemplate'), undefined, [
    f.createStringLiteral(html),
  ])
}

function isPerItemCall(node: ts.CallExpression): boolean {
  // Matches: item(t => t.field) or item(t => expr)
  // where item is an identifier (the scoped accessor from each() render)
  if (!ts.isIdentifier(node.expression)) return false
  // Check that the first argument is an arrow function (the selector)
  if (node.arguments.length !== 1) return false
  const arg = node.arguments[0]!
  return ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
}

// Matches: item.FIELD — the item-proxy shorthand equivalent of item(t => t.FIELD).
// Lifetime-checked: the `item` identifier must resolve to a parameter of an
// `each({ render })` callback. Without this check, plain
// `arr.map((item) => item.field)` outside each() would be rewritten as a
// per-item binding and crash at runtime with "accessor is not a function"
// because `item.field` evaluates to a bare value (not a function) when
// treated as an accessor.
function isPerItemFieldAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  if (!ts.isPropertyAccessExpression(node)) return false
  if (!ts.isIdentifier(node.expression)) return false
  if (node.expression.text !== 'item') return false
  if (!ts.isIdentifier(node.name)) return false
  return isItemBoundToEachRender(node)
}

/**
 * Walks up from a node and returns true iff the nearest enclosing function
 * that binds an `item` parameter is the `render` property of an `each()`
 * call. Handles both positional (`(item) => …`) and destructured
 * (`({ item, index }) => …`) parameter bindings.
 */
function isItemBoundToEachRender(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      if (functionParamsBindItem(current)) {
        return isEachRenderCallback(current)
      }
    }
    current = current.parent
  }
  return false
}

function functionParamsBindItem(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  for (const param of fn.parameters) {
    if (bindingNameBindsItem(param.name)) return true
  }
  return false
}

function bindingNameBindsItem(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === 'item'
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el) && bindingNameBindsItem(el.name)) return true
    }
  }
  return false
}

function isEachRenderCallback(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = fn.parent
  if (!parent || !ts.isPropertyAssignment(parent)) return false
  if (!ts.isIdentifier(parent.name) || parent.name.text !== 'render') return false
  const objLit = parent.parent
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return false
  const call = objLit.parent
  if (!call || !ts.isCallExpression(call)) return false
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'each') return false
  return true
}

// Matches the hoisted identifiers produced by tryDeduplicateItemSelectors: __a0, __a1, …
// These represent already-cached per-item accessors.
function isHoistedPerItem(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false
  return /^__a\d+$/.test(node.text)
}

// ── Mask computation ─────────────────────────────────────────────

// Returns { mask, readsState }
// mask = 0 + readsState = false → constant (can fold to static)
// mask = 0 + readsState = true → unresolvable state access (FULL_MASK)
// mask > 0 → precise mask
// See `NON_DELEGATION_HELPERS` in collect-deps.ts — same set of names
// that aren't followed when scanning for `helper(s)` delegation calls.
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

// ── 'use client' directive ───────────────────────────────────────

export interface UseClientTransformResult {
  output: string
  warnings: string[]
}

/**
 * If `source` begins with a `'use client'` directive, generate a stub
 * replacement for the SSR build. Every `export const X = <expr>` becomes
 * `export const X = __clientOnlyStub('X')`, every `export function X`
 * becomes a stub, and `export default <expr>` becomes a default stub.
 * Returns `null` if the directive is absent (caller should fall through
 * to the normal compiler pass).
 *
 * The client build is expected to skip this path entirely — Vite passes
 * `{ ssr: false }` there, and the plugin checks that before invoking
 * this function.
 *
 * Shapes this v1 does NOT handle (emits a warning + leaves them out of
 * the stub output):
 *
 *   - `export function foo() {}` and `export class Foo {}` — rewritten
 *     as stubs but the caller may be surprised that `foo` and `Foo` are
 *     ComponentDef-shaped objects during SSR.
 *   - `export { a, b } from './other.js'` — re-export forms are not
 *     detected; they pass through and will still pull `./other` into
 *     the SSR graph.
 *   - `export * from './other.js'` — same as above.
 *   - `export type ...` — type exports are erased by TS so nothing to
 *     stub; left untouched.
 */
export function transformUseClientSsr(
  source: string,
  _filename: string,
): UseClientTransformResult | null {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Find the first non-comment, non-directive-whitespace statement.
  // 'use client' should be the literal first statement in the file.
  const first = sourceFile.statements[0]
  if (!first) return null
  if (!ts.isExpressionStatement(first)) return null
  if (!ts.isStringLiteral(first.expression)) return null
  if (first.expression.text !== 'use client') return null

  const warnings: string[] = []
  const namedExports: string[] = []
  let hasDefaultExport = false

  for (const stmt of sourceFile.statements) {
    // The `'use client'` directive itself — skip.
    if (stmt === first) continue

    // `export const NAME = ...` and `export let NAME = ...`
    if (
      ts.isVariableStatement(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          namedExports.push(decl.name.text)
        } else {
          warnings.push(
            '[llui/use-client] destructured `export const { ... }` is not supported; each binding would have to be stubbed individually. Refactor to one `export const` per value.',
          )
        }
      }
      continue
    }

    // `export function NAME() {}`
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export class NAME {}`
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      namedExports.push(stmt.name.text)
      continue
    }

    // `export default ...`
    if (
      ts.isExportAssignment(stmt) ||
      (ts.isFunctionDeclaration(stmt) &&
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
    ) {
      hasDefaultExport = true
      continue
    }

    // `export { a, b }` / `export { a } from './x.js'` / `export * from './x.js'`
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) {
        warnings.push(
          "[llui/use-client] `export ... from '...'` re-export forms still pull the source module into the SSR graph and bypass stubbing. Either drop the re-export or move the 'use client' directive to the source module.",
        )
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const spec of stmt.exportClause.elements) {
          namedExports.push((spec.name ?? spec.propertyName!).text)
        }
      }
      continue
    }

    // Type-only statements are erased at runtime — nothing to stub.
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue

    // Imports, `import type`, enum declarations, plain (non-export)
    // variable statements — dropped from the stub output.
  }

  // Build the generated module source.
  const lines: string[] = ["import { __clientOnlyStub } from '@llui/dom'", '']
  for (const name of namedExports) {
    lines.push(`export const ${name} = __clientOnlyStub(${JSON.stringify(name)})`)
  }
  if (hasDefaultExport) {
    lines.push('export default __clientOnlyStub("default")')
  }

  return {
    output: lines.join('\n') + '\n',
    warnings,
  }
}

/**
 * Check whether `source`'s first statement is a `'use client'` directive.
 * Cheap string scan so the caller can decide which transform to run
 * without parsing the whole file twice.
 */
export function hasUseClientDirective(source: string): boolean {
  // Skip leading whitespace and block/line comments; look for the
  // first token. A full parse is overkill here — users who write
  // `'use client'` in any other position (inside a function, after
  // imports) aren't using the directive as React/Vercel define it.
  let i = 0
  const len = source.length
  while (i < len) {
    const ch = source[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i)
      if (nl === -1) return false
      i = nl + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return false
      i = end + 2
      continue
    }
    break
  }
  return source.startsWith("'use client'", i) || source.startsWith('"use client"', i)
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
