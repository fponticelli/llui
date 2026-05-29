// Component-level signal transform — rewrite a signal `view` and inject imports.
//
// Detects `component({ ... view: ({ state, send }) => [ <nodes> ] ... })` whose
// view destructures a `state` bag (the signal-component shape), rewrites the
// returned node array via the view transform (transform-view.ts), and prepends
// an `import { … } from '@llui/dom/signals'` for the runtime helpers it emits.
//
// Source→source string output. The Vite plugin calls this and feeds the result
// to esbuild/rollup. Legacy (arrow-accessor) components are left untouched.
//
// Scope: concise `=> [ ... ]` array bodies (the common shape). Block bodies and
// multi-slice bags are follow-ups.

import ts from 'typescript'
import { transformNodeExpr } from './transform-view.js'
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
}

const RUNTIME_HELPERS = [
  'signalText',
  'staticText',
  'el',
  'react',
  'signalEach',
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

/** The returned node array of a view body (concise `=> [...]`), or null. */
function returnedArray(
  viewFn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ArrayLiteralExpression | null {
  const body = viewFn.body
  if (body && ts.isArrayLiteralExpression(body)) return body
  if (body && ts.isParenthesizedExpression(body) && ts.isArrayLiteralExpression(body.expression)) {
    return body.expression
  }
  return null
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
    const msgSchema = extractMsgSchema(source, 'Msg')
    const effectSchema = extractEffectSchema(source, 'Effect')
    const stateSchema = extractStateSchema(source, 'State')
    const msgAnnotations = extractMsgAnnotations(source, 'Msg')
    const props: string[] = []
    if (msgSchema) props.push(`__msgSchema: ${JSON.stringify(msgSchema)}`)
    if (effectSchema) props.push(`__effectSchema: ${JSON.stringify(effectSchema)}`)
    if (stateSchema) props.push(`__stateSchema: ${JSON.stringify(stateSchema)}`)
    if (msgAnnotations && Object.keys(msgAnnotations).length > 0) {
      props.push(`__msgAnnotations: ${JSON.stringify(msgAnnotations)}`)
    }
    props.push(
      `__schemaHash: ${JSON.stringify(computeSchemaHash({ msgSchema, stateSchema, msgAnnotations }))}`,
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
    const props = sharedMetaProps().filter((p) => !existing.has(p.split(':')[0]!.trim()))
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
            const rewritten = `[${arr.elements.map((e) => transformNodeExpr(e, sf, roots)).join(', ')}]`
            edits.push({ start: arr.getStart(sf), end: arr.getEnd(), text: rewritten })
            transformedAny = true
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

  if (!transformedAny) return source

  // apply edits back-to-front so offsets stay valid
  let out = source
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }

  // inject import for the helpers actually used
  const used = RUNTIME_HELPERS.filter((h) => new RegExp(`\\b${h}\\(`).test(out))
  if (used.length > 0) {
    out = `import { ${used.join(', ')} } from '@llui/dom/signals'\n${out}`
  }
  return out
}
