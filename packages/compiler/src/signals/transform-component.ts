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
export function transformSignalComponentSource(source: string): string {
  const sf = ts.createSourceFile('m.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: Edit[] = []
  let transformedAny = false

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
