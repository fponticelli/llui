// `item-dedup` — deduplicates repeated `item(selector)` calls AND
// `item.FIELD` property accesses inside an each() render callback.
//
// Before: `item((r) => r.id)` and `item.id` mixed across the render
// body produce a fresh selector closure / Proxy.get trap on every
// invocation, fragmenting the V8 inline cache. Worse, repeated
// `item(...)` calls each allocate a new accessor closure.
//
// After: every distinct accessor target (keyed by the simple field
// name when extractable, else by the printed expression text) is
// lifted into a single `const __sN = (r) => r.FIELD` selector plus
// a single `const __aN = acc(__sN)` accessor at the top of the
// render body. Every occurrence then resolves to a plain identifier
// reference (`__aN`), and the runtime evaluates them via the
// non-Proxy `acc()` helper.
//
// Fires top-down (`transformCallEnter`) on `each()` so subsequent
// element-rewrite passes see the hoisted form — important because
// element rewrites inline accessor argument references, and the
// hoisted `__aN` is a stable identifier they can compile correctly.
//
// Gated on the `each` helper (alias-aware via `isHelperCall`). The
// module exits early when fewer than 2 occurrences exist; no point
// hoisting a single access.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { isHelperCall } from '../transform.js'

export interface ItemDedupModuleOptions {
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
}

export function itemDedupModule(options: ItemDedupModuleOptions): CompilerModule {
  const { viewHelperNames, viewHelperAliases } = options
  // Printer is per-module — created lazily on first match, then reused
  // across calls. The selector-expression key uses the printer's output
  // as a fallback when `extractSimpleField` can't reduce to a plain
  // field name.
  let printer: ts.Printer | null = null
  return {
    name: 'item-dedup',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (!isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)) return null
      const f = ctx.factory
      const sf = ctx.analysis.sourceFile
      if (!printer) printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

      const arg = node.arguments[0]
      if (!arg || !ts.isObjectLiteralExpression(arg)) return null

      let renderProp: ts.PropertyAssignment | null = null
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'render'
        ) {
          renderProp = prop
          break
        }
      }
      if (!renderProp) return null

      const renderFn = renderProp.initializer
      if (!ts.isArrowFunction(renderFn) && !ts.isFunctionExpression(renderFn)) return null

      const renderParam = renderFn.parameters[0]
      if (!renderParam) return null

      let itemName: string | null = null
      if (ts.isIdentifier(renderParam.name)) {
        itemName = renderParam.name.text
      } else if (ts.isObjectBindingPattern(renderParam.name)) {
        for (const el of renderParam.name.elements) {
          if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === 'item') {
            itemName = 'item'
            break
          }
        }
      }
      if (!itemName) return null

      type Occurrence =
        | { kind: 'call'; node: ts.CallExpression; selector: ts.Expression; key: string }
        | { kind: 'access'; node: ts.PropertyAccessExpression; field: string; key: string }
      const occurrences: Occurrence[] = []

      function extractSimpleField(sel: ts.ArrowFunction | ts.FunctionExpression): string | null {
        if (sel.parameters.length !== 1) return null
        const paramName = sel.parameters[0]!.name
        if (!ts.isIdentifier(paramName)) return null
        const body = ts.isArrowFunction(sel) ? sel.body : null
        if (!body) return null
        const expr = ts.isBlock(body) ? null : body
        if (!expr || !ts.isPropertyAccessExpression(expr)) return null
        if (!ts.isIdentifier(expr.expression) || expr.expression.text !== paramName.text)
          return null
        if (!ts.isIdentifier(expr.name)) return null
        return expr.name.text
      }

      function collectItemCalls(n: ts.Node): void {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === itemName &&
          n.arguments.length === 1
        ) {
          const sel = n.arguments[0]!
          if (ts.isArrowFunction(sel) || ts.isFunctionExpression(sel)) {
            const field = extractSimpleField(sel)
            const key =
              field !== null
                ? `field:${field}`
                : `expr:${printer!.printNode(ts.EmitHint.Expression, sel, sf)}`
            occurrences.push({ kind: 'call', node: n, selector: sel, key })
          }
        } else if (
          ts.isPropertyAccessExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === itemName &&
          ts.isIdentifier(n.name)
        ) {
          const field = n.name.text
          // `item.current` is the Proxy-only shorthand for "the whole
          // row" (each.ts:768). The rewrite path would lower it to
          // `acc(r => r.current)`, which evaluates as
          // `entry.current.current` at runtime and returns undefined
          // for any row that doesn't literally have a `current` field
          // — i.e. essentially every consumer. Skip the rewrite and
          // let the runtime Proxy handle the call.
          if (field === 'current') return
          occurrences.push({ kind: 'access', node: n, field, key: `field:${field}` })
        }
        ts.forEachChild(n, collectItemCalls)
      }
      collectItemCalls(renderFn.body)

      if (occurrences.length < 2) return null

      const groups = new Map<string, Occurrence[]>()
      for (const occ of occurrences) {
        const existing = groups.get(occ.key)
        if (existing) existing.push(occ)
        else groups.set(occ.key, [occ])
      }

      const allGroups = [...groups.entries()]
      if (allGroups.length === 0) return null

      const hoistedStmts: ts.Statement[] = []
      const replacements = new Map<ts.Node, ts.Identifier>()
      let sIdx = 0

      for (const [key, occs] of allGroups) {
        const selVar = `__s${sIdx}`
        const accVar = `__a${sIdx}`
        sIdx++

        let selector: ts.Expression
        const callOccurrence = occs.find((o) => o.kind === 'call')
        if (callOccurrence && callOccurrence.kind === 'call') {
          selector = callOccurrence.selector
        } else {
          const firstAccess = occs[0]!
          if (firstAccess.kind !== 'access') throw new Error('unreachable')
          selector = f.createArrowFunction(
            undefined,
            undefined,
            [f.createParameterDeclaration(undefined, undefined, 't')],
            undefined,
            f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            f.createPropertyAccessExpression(f.createIdentifier('t'), firstAccess.field),
          )
        }

        hoistedStmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(selVar, undefined, undefined, selector)],
              ts.NodeFlags.Const,
            ),
          ),
        )
        hoistedStmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  accVar,
                  undefined,
                  undefined,
                  f.createCallExpression(f.createIdentifier('acc'), undefined, [
                    f.createIdentifier(selVar),
                  ]),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
        )

        void key
        for (const occ of occs) {
          replacements.set(occ.node, f.createIdentifier(accVar))
        }
      }

      function replaceVisitor(n: ts.Node): ts.Node {
        if (replacements.has(n)) return replacements.get(n)!
        return ts.visitEachChild(n, replaceVisitor, undefined!)
      }
      const newBody = ts.visitNode(renderFn.body, replaceVisitor)!

      let finalBody: ts.ConciseBody
      if (ts.isBlock(newBody)) {
        finalBody = f.createBlock([...hoistedStmts, ...(newBody as ts.Block).statements], true)
      } else {
        finalBody = f.createBlock(
          [...hoistedStmts, f.createReturnStatement(newBody as ts.Expression)],
          true,
        )
      }

      const newParameters = renderFn.parameters.map((p, idx) => {
        if (idx !== 0) return p
        if (!ts.isObjectBindingPattern(p.name)) return p
        const hasAcc = p.name.elements.some(
          (el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === 'acc',
        )
        if (hasAcc) return p
        const newBinding = f.createObjectBindingPattern([
          ...p.name.elements,
          f.createBindingElement(undefined, undefined, f.createIdentifier('acc')),
        ])
        return f.createParameterDeclaration(
          p.modifiers,
          p.dotDotDotToken,
          newBinding,
          p.questionToken,
          p.type,
          p.initializer,
        )
      })

      const newRenderFn = ts.isArrowFunction(renderFn)
        ? f.createArrowFunction(
            renderFn.modifiers,
            renderFn.typeParameters,
            newParameters,
            renderFn.type,
            f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            finalBody,
          )
        : f.createFunctionExpression(
            renderFn.modifiers,
            renderFn.asteriskToken,
            renderFn.name,
            renderFn.typeParameters,
            newParameters,
            renderFn.type,
            finalBody as ts.Block,
          )

      const newProps = arg.properties.map((p) =>
        p === renderProp ? f.createPropertyAssignment('render', newRenderFn) : p,
      )
      const newArg = f.createObjectLiteralExpression(newProps, true)
      return f.createCallExpression(node.expression, node.typeArguments, [
        newArg,
        ...node.arguments.slice(1),
      ])
    },
  }
}
