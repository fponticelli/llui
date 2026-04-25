import ts from 'typescript'

/**
 * Compiler pass that tags event-handler arrow functions with the Msg
 * variants they dispatch. Replaces the older static-extract approach
 * (which only walked the inline `view` arrow body of a `component({…})`
 * literal, missing every send inside imported view fragments — i.e.
 * every realistic LLui app).
 *
 * Detection
 * ---------
 * Walks the AST looking for object-literal properties whose name
 * matches `/^on[A-Z]/` (DOM event handler convention) and whose value
 * is an arrow / function expression. Inside that handler body, any
 * `<identifier>({ type: 'literal', … })` call site is treated as a
 * `send(…)`-equivalent dispatch and the literal `type` string is
 * collected.
 *
 * False positives are deliberate: the alternative — proving the
 * callee resolves to the destructured `send` from a `View` bag —
 * would require full scope tracking across re-exports, which the
 * compiler doesn't do. In practice the pattern `id({ type: 'X', … })`
 * is vanishingly rare outside dispatches, and an extra entry in the
 * live descriptor registry just means the agent sees one more
 * "affordable variant" than necessary — never a wrong dispatch, never
 * a runtime error. Net safe to be permissive.
 *
 * False negatives: non-literal `type` (e.g. `send({ type: nextStep })`)
 * are skipped. Same reasoning as the old extractor — we can only
 * record statically-known variants. Apps that route through dynamic
 * dispatch should declare `agentAffordances` for the variants they
 * want the agent to see.
 *
 * Emission
 * --------
 * Each event-handler arrow with at least one collected variant is
 * wrapped with `Object.assign(<arrow>, { __lluiVariants: ['X', …] })`.
 * `Object.assign` returns the original function (so DOM
 * `addEventListener` still gets a callable) with an extra read-only
 * metadata field that the runtime inspects in `elements.ts` to
 * register the variants on the active component instance.
 *
 * Why `Object.assign` rather than a runtime helper import: zero new
 * imports in user code, zero call-graph friction, the optimizer
 * inlines it. Cost is one extra property assignment per tagged
 * handler at view-evaluation time.
 *
 * @see agent spec §5.2, §12.2
 * @see @llui/dom binding-descriptors.ts (runtime registration)
 */
export function tagEventHandlerSends(node: ts.SourceFile, f: ts.NodeFactory): ts.SourceFile {
  const transformer: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    const visit: ts.Visitor = (n) => {
      if (ts.isPropertyAssignment(n) && isEventHandlerKey(n.name)) {
        const tagged = maybeTagHandler(n.initializer, f)
        if (tagged !== null && tagged !== n.initializer) {
          return f.updatePropertyAssignment(n, n.name, tagged)
        }
      }
      return ts.visitEachChild(n, visit, ctx)
    }
    return (sf) => ts.visitEachChild(sf, visit, ctx) as ts.SourceFile
  }
  const result = ts.transform(node, [transformer])
  const out = result.transformed[0] as ts.SourceFile
  result.dispose()
  return out
}

function isEventHandlerKey(name: ts.PropertyName): name is ts.Identifier | ts.StringLiteral {
  if (ts.isIdentifier(name)) return /^on[A-Z]/.test(name.text)
  if (ts.isStringLiteral(name)) return /^on[A-Z]/.test(name.text)
  return false
}

/**
 * If `value` is an arrow / function expression containing literal
 * sends, return the wrapped form. If it's a function with no
 * discoverable variants, or not a function at all, return the
 * original `value` (or null when nothing applies) so the AST stays
 * untouched in the common no-send case — `onMount` handlers that
 * perform DOM measurement, `onInput` callbacks that just call
 * non-send functions, etc.
 */
function maybeTagHandler(value: ts.Expression, f: ts.NodeFactory): ts.Expression | null {
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return null
  const variants = collectLiteralSendVariants(value.body)
  if (variants.length === 0) return value
  return wrapWithVariants(value, variants, f)
}

/**
 * Recursively walk the handler body collecting every literal type
 * string from `<id>({ type: 'literal', … })` call sites. De-dupes
 * while preserving first-seen order so the emitted array reads
 * naturally for anyone inspecting the compiled output.
 */
function collectLiteralSendVariants(node: ts.Node): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      const first = n.arguments[0]
      if (callee && ts.isIdentifier(callee) && first && ts.isObjectLiteralExpression(first)) {
        const variant = readTypeLiteral(first)
        if (variant !== null && !seen.has(variant)) {
          seen.add(variant)
          out.push(variant)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

function readTypeLiteral(obj: ts.ObjectLiteralExpression): string | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (!prop.name) continue
    const nameOk =
      (ts.isIdentifier(prop.name) && prop.name.text === 'type') ||
      (ts.isStringLiteral(prop.name) && prop.name.text === 'type')
    if (!nameOk) continue
    const init = prop.initializer
    if (ts.isStringLiteral(init)) return init.text
    if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text
  }
  return null
}

/**
 * Build `Object.assign(<arrow>, { __lluiVariants: ['X', 'Y'] })`.
 *
 * The wrapper is intentionally a member-call expression rather than a
 * runtime helper from `@llui/dom`: emitting an Object.assign call
 * keeps the compiled output inspectable (no opaque imports), avoids
 * dragging a new identifier into the user's import list, and lets the
 * JS engine inline the assignment cheaply.
 */
function wrapWithVariants(
  arrow: ts.ArrowFunction | ts.FunctionExpression,
  variants: readonly string[],
  f: ts.NodeFactory,
): ts.CallExpression {
  return f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier('Object'), 'assign'),
    undefined,
    [
      arrow,
      f.createObjectLiteralExpression(
        [
          f.createPropertyAssignment(
            '__lluiVariants',
            f.createArrayLiteralExpression(
              variants.map((v) => f.createStringLiteral(v)),
              false,
            ),
          ),
        ],
        false,
      ),
    ],
  )
}
