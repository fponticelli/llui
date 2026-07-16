// Component-level signal transform — rewrite a signal `view` and inject imports.
//
// Detects `component({ ... view: ({ state, send }) => [ <nodes> ] ... })` whose
// view destructures a `state` bag (the signal-component shape), rewrites the
// returned node array via the view transform (transform-view.ts), and prepends
// an `import { … } from '@llui/dom'` for the runtime helpers it emits.
//
// Source→source string output. The Vite plugin calls this and feeds the result
// to esbuild/rollup. Legacy (arrow-accessor) components are left untouched.
//
// Scope: concise `=> [ ... ]` array bodies (the common shape). Block bodies and
// multi-slice bags are follow-ups.

import ts from 'typescript'
import {
  transformNodeExpr,
  setAutoBatchContext,
  lowerHelperEach,
  setHelperDecls,
  setHelperBindings,
  setLowerBailHook,
  setEachLoweredHook,
  type LowerBail,
} from './transform-view.js'
import { HelperBindings } from './helper-bindings.js'
import { singleRoot, type Roots } from './extract-deps.js'
import { applyEditsWithMap, type TextEdit } from './apply-edits.js'
import type { SourceMap } from 'magic-string'
import { perfDiagnosticsForFile } from './perf-diagnostics.js'
import { scriptKindForFilename } from './script-kind.js'
import type { Diagnostic } from '../diagnostic.js'
import { extractMsgSchema, extractEffectSchema } from '../msg-schema.js'
import { extractStateSchema } from '../state-schema.js'
import {
  extractMsgAnnotations,
  sparseMsgAnnotations,
  type MessageAnnotations,
} from '../msg-annotations.js'
import { computeSchemaHash } from '../schema-hash.js'

/** Options controlling introspection metadata emission (mirrors the legacy
 * transform's `devMode`/`emitAgentMetadata` gating). */
export interface SignalTransformOptions {
  /** emit `__msgSchema`/`__stateSchema`/`__msgAnnotations`/`__effectSchema` for the agent surface */
  emitAgentMetadata?: boolean
  /** dev build — also emit `__componentMeta` { file, line } */
  devMode?: boolean
  /** source file path, for `__componentMeta.file` */
  fileName?: string
  /** cross-file pre-extracted, composition-aware schemas (msg/effect/annotations)
   * resolved by the adapter; takes precedence over file-local extraction. */
  preExtracted?: {
    msgSchema?: unknown
    effectSchema?: unknown
    msgAnnotations?: Record<string, MessageAnnotations> | null
  }
  /** cross-file resolved external type sources (for `State`, which isn't a union
   * so composition doesn't apply — extract from its declaring file). */
  typeSources?: {
    state?: { source: string; typeName: string }
  }
  /** Lowering-bail telemetry: called for every lowering ATTEMPT that gave up and
   * fell back to a slower path (see {@link LowerBail}). Coverage tooling and the
   * future `perf` diagnostics channel consume this; it does not affect output. */
  onLowerBail?: (bail: LowerBail) => void
  /** Perf diagnostics: called with one `llui/each-verbatim` Diagnostic
   * (category `perf`, severity `warning`) per `each` site that ends FULLY
   * verbatim — its rows render via the runtime authoring path instead of the
   * compiled factory. Advisory only; never affects output. Verbatim `show`/
   * `branch` are intentionally not surfaced (they only pay at toggle time). */
  onPerfDiagnostic?: (diagnostic: Diagnostic) => void
}

const RUNTIME_HELPERS = [
  'signalText',
  'staticText',
  'el',
  'react',
  'signalEach',
  'signalEachDirect',
  'eachDirect',
  'eachArm',
  'rowHandle',
  'applyAttr',
  'signalShow',
  'signalBranch',
  'signalForeign',
]
const RUNTIME_HELPER_SET = new Set(RUNTIME_HELPERS)

type Edit = TextEdit

/** The runtime helpers ACTUALLY emitted by the transform, collected by parsing the
 * edit replacement texts (compiler-generated code) and walking for calls to a known
 * helper. AST-based — so a helper name appearing in a user comment or string literal
 * (which lives in the untouched source, never in an edit text) is NOT a false match,
 * unlike the old `\bhelper\(` regex over the whole output. */
function collectEmittedHelpers(edits: readonly Edit[]): Set<string> {
  const found = new Set<string>()
  for (const e of edits) {
    if (!e.text.includes('(')) continue // no call — nothing to collect (metadata, `batch,`)
    const probe = ts.createSourceFile(
      '__probe.tsx',
      `const __x = [${e.text}]`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const walk = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        RUNTIME_HELPER_SET.has(n.expression.text)
      ) {
        found.add(n.expression.text)
      }
      n.forEachChild(walk)
    }
    walk(probe)
  }
  return found
}

/** Local binding names already imported from '@llui/dom' in this file — so the
 * injected import doesn't re-declare one the user already imported (a duplicate
 * binding is a SyntaxError). */
function domImportedNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === '@llui/dom'
    ) {
      const nb = st.importClause?.namedBindings
      if (nb && ts.isNamedImports(nb)) for (const spec of nb.elements) out.add(spec.name.text)
    }
  }
  return out
}

/** The `state` (and any extra) root names a signal view destructures from its
 * bag parameter, or null if this isn't a signal view. */
function signalRoots(viewFn: ts.ArrowFunction | ts.FunctionExpression): Roots | null {
  const param = viewFn.parameters[0]
  if (!param || !ts.isObjectBindingPattern(param.name)) return null
  for (const el of param.name.elements) {
    if (!ts.isIdentifier(el.name)) continue
    const key =
      el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
    if (key === 'state') {
      return singleRoot(el.name.text) // the local alias used in the body
    }
  }
  return null
}

/** The view bag's destructuring pattern plus the local name bound to `send` and
 * whether `batch` is already bound — used to drive auto-batch (Opportunity A) and,
 * when a handler is wrapped, to inject a `batch` binding into the bag. Null when the
 * bag isn't an object pattern (then the component isn't a signal view anyway). */
function bagInfo(
  viewFn: ts.ArrowFunction | ts.FunctionExpression,
): { pattern: ts.ObjectBindingPattern; sendName: string | null; hasBatch: boolean } | null {
  const param = viewFn.parameters[0]
  if (!param || !ts.isObjectBindingPattern(param.name)) return null
  const pattern = param.name
  let sendName: string | null = null
  let hasBatch = false
  for (const el of pattern.elements) {
    if (!ts.isIdentifier(el.name)) continue
    const key =
      el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
    if (key === 'send') sendName = el.name.text
    if (key === 'batch') hasBatch = true
  }
  return { pattern, sendName, hasBatch }
}

/** The returned node array of a view body — concise (`=> [...]`) OR a block body
 * (`=> { …; return [...] }`), or null. For a block body, signal-bound locals
 * declared above the `return` stay in scope: the lowered array references them
 * verbatim where the static tracer can't follow them (the view transform leaves
 * non-rooted args to the runtime authoring helpers), so only the array literal is
 * rewritten — the block's statements are preserved. */
function returnedArray(
  viewFn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ArrayLiteralExpression | null {
  let body: ts.Node | undefined = viewFn.body
  // block body: the (first) `return [...]` statement
  if (body && ts.isBlock(body)) {
    body = body.statements.find(ts.isReturnStatement)?.expression
  }
  while (body && ts.isParenthesizedExpression(body)) body = body.expression
  return body && ts.isArrayLiteralExpression(body) ? body : null
}

/** Result of {@link transformSignalComponentSourceWithMap}: the rewritten code and
 * a source map (null when the file had no signal component and was returned as-is). */
export interface SignalTransformResult {
  code: string
  map: SourceMap | null
}

/**
 * Rewrite signal `view`s in a source file and inject the runtime import.
 * Returns the source unchanged if it contains no signal components.
 *
 * String-only convenience wrapper over {@link transformSignalComponentSourceWithMap}
 * — kept for the many callers (mcp, dom codegen tests) that only need the code.
 */
export function transformSignalComponentSource(
  source: string,
  opts: SignalTransformOptions = {},
): string {
  return transformSignalComponentSourceWithMap(source, opts).code
}

/**
 * The map-returning form. Every splice (view rewrites, metadata, `batch,` bag
 * injection) plus the injected runtime import compose through ONE MagicString
 * instance, so the returned {@link SourceMap} is coherent. The vite-plugin threads
 * this map (and can compose the lint-autofix pass, which shares the same
 * {@link applyEditsWithMap} splicer) in a later stage.
 */
export function transformSignalComponentSourceWithMap(
  source: string,
  opts: SignalTransformOptions = {},
): SignalTransformResult {
  // Parse with the ScriptKind implied by the filename: a `.ts` file using the
  // generic-arrow form (`const id = <T>(x: T): T => x`) misparses as JSX under TSX.
  const fileName = opts.fileName ?? 'm.tsx'
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFilename(fileName),
  )
  const edits: Edit[] = []
  let transformedAny = false

  // Per-file `@llui/dom` import-binding set — gates every framework-call
  // recognition (below, and in the view transform): resolves aliases, excludes a
  // user's own binding of a helper name, and honors lexical shadowing.
  const bindings = HelperBindings.fromSourceFile(sf)

  // Introspection metadata is computed PER `component()` call: the Msg/State/Effect
  // type NAMES come from the call's own type arguments (`component<State, Msg, Effect>`),
  // falling back to the `State`/`Msg`/`Effect` convention when the call is untyped. A
  // second component in the same file with a different Msg union therefore gets its own
  // schema/hash — not the first component's. Results are memoized per name-tuple so two
  // components sharing the same types don't re-extract.
  const shouldEmit = Boolean(opts.emitAgentMetadata || opts.devMode)
  const metaCache = new Map<string, string[]>()
  const metaPropsFor = (stateName: string, msgName: string, effectName: string): string[] => {
    const key = `${stateName}\0${msgName}\0${effectName}`
    const cached = metaCache.get(key)
    if (cached) return cached
    const pre = opts.preExtracted
    const stateSrc = opts.typeSources?.state
    // Cross-file pre-extracted schemas take precedence; else extract file-locally
    // using the per-call type-argument names.
    const msgSchema =
      pre?.msgSchema !== undefined ? pre.msgSchema : extractMsgSchema(source, msgName)
    const effectSchema =
      pre?.effectSchema !== undefined ? pre.effectSchema : extractEffectSchema(source, effectName)
    const msgAnnotations =
      pre?.msgAnnotations !== undefined
        ? pre.msgAnnotations
        : extractMsgAnnotations(source, msgName)
    const stateSchema = stateSrc
      ? extractStateSchema(stateSrc.source, stateSrc.typeName)
      : extractStateSchema(source, stateName)
    const props: string[] = []
    if (msgSchema) props.push(`__msgSchema: ${JSON.stringify(msgSchema)}`)
    if (effectSchema) props.push(`__effectSchema: ${JSON.stringify(effectSchema)}`)
    if (stateSchema) props.push(`__stateSchema: ${JSON.stringify(stateSchema)}`)
    // Emit a SPARSE annotation map: variants (and per-variant fields) still at
    // their default are omitted — the runtime reconstructs them from absence. A
    // Msg with zero source annotations emits no `__msgAnnotations` at all. The
    // schema hash below still hashes the FULL record so hash stability doesn't
    // depend on this size optimization.
    const sparseAnnotations = msgAnnotations ? sparseMsgAnnotations(msgAnnotations) : null
    if (sparseAnnotations) {
      props.push(`__msgAnnotations: ${JSON.stringify(sparseAnnotations)}`)
    }
    props.push(
      `__schemaHash: ${JSON.stringify(
        computeSchemaHash({ msgSchema, stateSchema, msgAnnotations: msgAnnotations ?? null }),
      )}`,
    )
    metaCache.set(key, props)
    return props
  }

  /** The type name for the `i`th type argument of a `component<…>(…)` call (0 = State,
   * 1 = Msg, 2 = Effect), or `fallback` when the call is untyped / the argument isn't a
   * plain type reference. */
  const typeArgName = (call: ts.CallExpression, i: number, fallback: string): string => {
    const ta = call.typeArguments?.[i]
    if (ta && ts.isTypeReferenceNode(ta) && ts.isIdentifier(ta.typeName)) return ta.typeName.text
    return fallback
  }

  /** The metadata property strings to splice into a component config, minus any
   * field the author already wrote (user-provided takes precedence). */
  const metaForComponent = (
    config: ts.ObjectLiteralExpression,
    callNode: ts.CallExpression,
  ): string[] => {
    if (!shouldEmit) return []
    const existing = new Set(
      config.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? [p.name.getText(sf)] : [])),
    )
    const props: string[] = []
    // infer `name` from the binding (`const Counter = component({...})`) for the
    // debug registry / agent identity — unless the author set one.
    if (!existing.has('name')) {
      const decl = callNode.parent
      if (decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
        props.push(`name: ${JSON.stringify(decl.name.text)}`)
      }
    }
    const stateName = typeArgName(callNode, 0, 'State')
    const msgName = typeArgName(callNode, 1, 'Msg')
    const effectName = typeArgName(callNode, 2, 'Effect')
    props.push(
      ...metaPropsFor(stateName, msgName, effectName).filter(
        (p) => !existing.has(p.split(':')[0]!.trim()),
      ),
    )
    if (opts.devMode && opts.fileName && !existing.has('__componentMeta')) {
      const line = sf.getLineAndCharacterOfPosition(callNode.getStart(sf)).line + 1
      props.push(`__componentMeta: ${JSON.stringify({ file: opts.fileName, line })}`)
    }
    return props
  }

  // Collect same-file top-level view-helper declarations for phase-2 helper-row
  // inlining: `function rowHelper(...) {...}` and `const rowHelper = (...) => ...`.
  // A row `render: (item) => [rowHelper(item, …)]` inlines the resolved body.
  const helpers = new Map<
    string,
    ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
  >()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      helpers.set(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          helpers.set(d.name.text, d.initializer)
        }
      }
    }
  }
  setHelperDecls(helpers)
  setHelperBindings(bindings)
  // Perf diagnostics need the full event stream to attribute reasons to the
  // each sites that end verbatim — record while forwarding to the user hook.
  const recordedBails: LowerBail[] | null = opts.onPerfDiagnostic ? [] : null
  const loweredEachStarts: Set<number> | null = opts.onPerfDiagnostic ? new Set() : null
  const userBailHook = opts.onLowerBail ?? null
  if (recordedBails) {
    setLowerBailHook((b) => {
      recordedBails.push(b)
      userBailHook?.(b)
    })
    setEachLoweredHook((pos) => loweredEachStarts!.add(pos))
  } else {
    setLowerBailHook(userBailHook)
  }

  // A component is "covered" when it sits inside a view-array rewrite already
  // pushed for an OUTER component — its source is emitted VERBATIM inside that
  // outer edit, so lowering it separately would push an edit overlapping the outer
  // one (applyTextEdits assumes non-overlap → corrupt output). Pass-1 gets the same
  // containment discipline pass 2 already has: process outermost-first (the visitor
  // reaches the outer component before descending into the inner), and skip any
  // component already covered by a pushed edit. (Insertions — metadata / `batch,` —
  // are zero-width, so `start < end` excludes them.)
  const coveredByEdit = (node: ts.Node): boolean =>
    edits.some((e) => e.start < e.end && e.start <= node.getStart(sf) && node.getEnd() <= e.end)

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      bindings.resolveCall(node) === 'component' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      if (coveredByEdit(node)) return // nested inside an already-lowered outer view
      for (const prop of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name.getText(sf) === 'view' &&
          (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
        ) {
          const viewFn = prop.initializer
          const roots = signalRoots(viewFn)
          const arr = returnedArray(viewFn)
          if (roots && arr) {
            // Auto-batch (Opportunity A): wrap straight-line multi-`send` handlers
            // in `batch(...)`. Active only when the bag destructures `send` (so the
            // calls are recognizable). Reset after lowering this view.
            const bag = bagInfo(viewFn)
            const abCtx = bag?.sendName ? { sendName: bag.sendName, used: false } : null
            setAutoBatchContext(abCtx)
            const rewritten = `[${arr.elements.map((e) => transformNodeExpr(e, sf, roots)).join(', ')}]`
            setAutoBatchContext(null)
            edits.push({ start: arr.getStart(sf), end: arr.getEnd(), text: rewritten })
            transformedAny = true
            // A wrapped handler references the bag's `batch`; inject the binding when
            // the author didn't already destructure it (the runtime always provides it).
            if (abCtx?.used && bag && !bag.hasBatch) {
              const at = bag.pattern.getStart(sf) + 1 // just after `{`
              edits.push({ start: at, end: at, text: ' batch,' })
            }
            // splice introspection metadata after the view property (config object)
            const meta = metaForComponent(node.arguments[0], node)
            if (meta.length > 0) {
              const at = prop.getEnd()
              edits.push({ start: at, end: at, text: `, ${meta.join(', ')}` })
            }
          }
        }
      }
    }
    node.forEachChild(visit)
  }

  // The ambient helper registry + auto-batch context are module-level; a throw during
  // lowering must not leak them into the NEXT file the (singleton) transform processes
  // (a stale registry would resolve a helper name to the wrong file's declaration), so
  // reset both in `finally` regardless of how the passes exit.
  try {
    // Pass 1: component views.
    visit(sf)

    // ── Pass 2: view-helper coverage ──────────────────────────────────────────
    // Lower `each(...)` calls that live OUTSIDE a component view — i.e. inside view-
    // helper functions (`fileTree(routeSig): Renderable { … each(…) }`), the documented
    // composition default. Their items source roots in a call-site-bound signal param
    // the compiler can't statically resolve, so the items handle is kept verbatim and
    // only the row compiles to a factory (`eachDirect`). Skip any `each` already inside
    // a pass-1 component-view edit range (those were lowered with a rooted source) —
    // so `pass1Ranges` MUST be captured AFTER pass 1 has populated `edits`, else pass 2
    // double-lowers a component-view each and emits overlapping edits.
    const pass1Ranges = edits.map((e) => [e.start, e.end] as const)
    const insidePass1 = (n: ts.Node): boolean =>
      pass1Ranges.some(([s, e]) => s < e && n.getStart(sf) >= s && n.getEnd() <= e)
    const visitHelpers = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        bindings.resolveCall(node) === 'each' &&
        !insidePass1(node)
      ) {
        const lowered = lowerHelperEach(node, sf)
        if (lowered) {
          edits.push({ start: node.getStart(sf), end: node.getEnd(), text: lowered })
          transformedAny = true
          return // row factory bails on structural children, so no lowerable nested each
        }
      }
      node.forEachChild(visitHelpers)
    }
    visitHelpers(sf)

    // Perf diagnostics: one `llui/each-verbatim` per each site that did NOT lower.
    if (recordedBails && loweredEachStarts && opts.onPerfDiagnostic) {
      const diags = perfDiagnosticsForFile(
        sf,
        source,
        fileName,
        edits,
        loweredEachStarts,
        recordedBails,
      )
      for (const d of diags) opts.onPerfDiagnostic(d)
    }
  } finally {
    setHelperDecls(null)
    setHelperBindings(null)
    setAutoBatchContext(null)
    setLowerBailHook(null)
    setEachLoweredHook(null)
  }

  if (!transformedAny) return { code: source, map: null }

  // inject import for the helpers actually EMITTED (collected from the edit texts,
  // AST-based), minus any the file already imports from '@llui/dom' (avoids a
  // duplicate-binding SyntaxError and comment/string false positives).
  const emitted = collectEmittedHelpers(edits)
  const alreadyImported = domImportedNames(sf)
  const used = RUNTIME_HELPERS.filter((h) => emitted.has(h) && !alreadyImported.has(h))
  const prepend = used.length > 0 ? `import { ${used.join(', ')} } from '@llui/dom'\n` : undefined

  // Every edit + the import prepend compose through one MagicString instance → a
  // coherent source map.
  return applyEditsWithMap(source, edits, { fileName, prepend })
}
