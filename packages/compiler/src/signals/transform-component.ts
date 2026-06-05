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
import { transformNodeExpr, setAutoBatchContext, lowerHelperEach } from './transform-view.js'
import { singleRoot, type Roots } from './extract-deps.js'
import { extractMsgSchema, extractEffectSchema } from '../msg-schema.js'
import { extractStateSchema } from '../state-schema.js'
import { extractMsgAnnotations } from '../msg-annotations.js'
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
    msgAnnotations?: Record<string, unknown> | null
  }
  /** cross-file resolved external type sources (for `State`, which isn't a union
   * so composition doesn't apply — extract from its declaring file). */
  typeSources?: {
    state?: { source: string; typeName: string }
  }
}

const RUNTIME_HELPERS = [
  'signalText',
  'staticText',
  'el',
  'react',
  'signalEach',
  'signalEachDirect',
  'eachDirect',
  'applyAttr',
  'signalShow',
  'signalBranch',
  'signalForeign',
]

interface Edit {
  start: number
  end: number
  text: string
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

/**
 * Rewrite signal `view`s in a source file and inject the runtime import.
 * Returns the source unchanged if it contains no signal components.
 */
export function transformSignalComponentSource(
  source: string,
  opts: SignalTransformOptions = {},
): string {
  const sf = ts.createSourceFile('m.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: Edit[] = []
  let transformedAny = false

  // Introspection metadata is per-file (Msg/State/Effect follow the `Msg`/`State`/
  // `Effect` convention). Compute the shared agent fields once, lazily.
  const shouldEmit = Boolean(opts.emitAgentMetadata || opts.devMode)
  let sharedMeta: string[] | null = null
  const sharedMetaProps = (): string[] => {
    if (sharedMeta) return sharedMeta
    const pre = opts.preExtracted
    const stateSrc = opts.typeSources?.state
    // Cross-file pre-extracted schemas take precedence; else extract file-locally.
    const msgSchema = pre?.msgSchema !== undefined ? pre.msgSchema : extractMsgSchema(source, 'Msg')
    const effectSchema =
      pre?.effectSchema !== undefined ? pre.effectSchema : extractEffectSchema(source, 'Effect')
    const msgAnnotations =
      pre?.msgAnnotations !== undefined ? pre.msgAnnotations : extractMsgAnnotations(source, 'Msg')
    const stateSchema = stateSrc
      ? extractStateSchema(stateSrc.source, stateSrc.typeName)
      : extractStateSchema(source, 'State')
    const props: string[] = []
    if (msgSchema) props.push(`__msgSchema: ${JSON.stringify(msgSchema)}`)
    if (effectSchema) props.push(`__effectSchema: ${JSON.stringify(effectSchema)}`)
    if (stateSchema) props.push(`__stateSchema: ${JSON.stringify(stateSchema)}`)
    if (msgAnnotations && Object.keys(msgAnnotations).length > 0) {
      props.push(`__msgAnnotations: ${JSON.stringify(msgAnnotations)}`)
    }
    props.push(
      `__schemaHash: ${JSON.stringify(
        computeSchemaHash({ msgSchema, stateSchema, msgAnnotations: msgAnnotations ?? null }),
      )}`,
    )
    sharedMeta = props
    return props
  }

  /** The metadata property strings to splice into a component config, minus any
   * field the author already wrote (user-provided takes precedence). */
  const metaForComponent = (config: ts.ObjectLiteralExpression, callNode: ts.Node): string[] => {
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
    props.push(...sharedMetaProps().filter((p) => !existing.has(p.split(':')[0]!.trim())))
    if (opts.devMode && opts.fileName && !existing.has('__componentMeta')) {
      const line = sf.getLineAndCharacterOfPosition(callNode.getStart(sf)).line + 1
      props.push(`__componentMeta: ${JSON.stringify({ file: opts.fileName, line })}`)
    }
    return props
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
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
  visit(sf)

  // ── Pass 2: view-helper coverage ────────────────────────────────────────────
  // Lower `each(...)` calls that live OUTSIDE a component view — i.e. inside view-
  // helper functions (`fileTree(routeSig): Renderable { … each(…) }`), the documented
  // composition default. Their items source roots in a call-site-bound signal param
  // the compiler can't statically resolve, so the items handle is kept verbatim and
  // only the row compiles to a factory (`eachDirect`). Skip any `each` already inside
  // a pass-1 component-view edit range (those were lowered with a rooted source).
  const pass1Ranges = edits.map((e) => [e.start, e.end] as const)
  const insidePass1 = (n: ts.Node): boolean =>
    pass1Ranges.some(([s, e]) => s < e && n.getStart(sf) >= s && n.getEnd() <= e)
  const visitHelpers = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'each' &&
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

  if (!transformedAny) return source

  // apply edits back-to-front so offsets stay valid
  let out = source
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }

  // inject import for the helpers actually used
  const used = RUNTIME_HELPERS.filter((h) => new RegExp(`\\b${h}\\(`).test(out))
  if (used.length > 0) {
    out = `import { ${used.join(', ')} } from '@llui/dom'\n${out}`
  }
  return out
}
