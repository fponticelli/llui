import ts from 'typescript'

export type BindingDescriptor = {
  variant: string
}

/**
 * Walk the `view` arrow function of every top-level `component({...})` call
 * in the source and collect every `send({type: '...'})` call site's variant
 * literal. Returns them in encounter order.
 *
 * False positives: any call of the form `identifier({ type: 'x', ... })` —
 * we don't verify the callee resolves to the destructured `send` from the
 * view argument, because that level of scope tracking is beyond the budget
 * of this MVP extractor. Apps that call other identifiers with similarly
 * shaped literals would see those in the output. In practice, the pattern
 * is uncommon enough that false positives are rare.
 *
 * Missing: non-literal `type` values (e.g. `send({type: nextStep})`) are
 * skipped. This is the correct behavior — we can only record statically-
 * known variants.
 *
 * @see agent spec §5.2, §12.2
 */
export function extractBindingDescriptors(source: string): BindingDescriptor[] {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const out: BindingDescriptor[] = []

  function visitComponentConfig(config: ts.ObjectLiteralExpression): void {
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== 'view') continue
      const viewExpr = prop.initializer
      if (!ts.isArrowFunction(viewExpr) && !ts.isFunctionExpression(viewExpr)) continue
      collectSendCalls(viewExpr.body)
    }
  }

  function collectSendCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const first = node.arguments[0]
      if (callee && ts.isIdentifier(callee) && first && ts.isObjectLiteralExpression(first)) {
        const variant = readTypeLiteral(first)
        if (variant !== null) {
          out.push({ variant })
        }
      }
    }
    ts.forEachChild(node, collectSendCalls)
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

  function visitTopLevel(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const calleeName = ts.isIdentifier(callee) ? callee.text : null
      if (calleeName === 'component' && node.arguments.length > 0) {
        const firstArg = node.arguments[0]
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          visitComponentConfig(firstArg)
        }
      }
    }
    ts.forEachChild(node, visitTopLevel)
  }

  ts.forEachChild(sf, visitTopLevel)
  return out
}
