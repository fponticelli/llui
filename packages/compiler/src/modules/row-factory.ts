// `row-factory` — emits `each() { ...; __tpl: ...; __rowUpd: ... }`
// when the each() call's render body can be hoisted into a static
// template + per-row patch function, eliminating per-row arrow
// allocation and giving the runtime a fast-path clone-and-patch loop.
//
// Fires **bottom-up** (`transformCall`, not `transformCallEnter`)
// because the rewrite depends on the each() call's render body
// already containing a rewritten `elTemplate(...)` call that
// `elementRewriteModule` produces via subtree-collapse. In Phase 2b's
// bottom-up phase the children have already gone through the
// registry's enter+recurse+exit chain, so the each() call this
// module sees has its render body in the post-element-rewrite shape.
//
// The function bails (returns null) on many shapes — no render
// prop, multiple `elTemplate` calls, nested structural primitives
// in render, selector.bind() V8-deopt patterns, etc. When it throws,
// the module catches and emits a one-line `[llui] Row factory
// failed in ...` warning matching the inline path's behavior.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { shadowsStateParam } from '../collect-deps.js'
import { isHelperCall } from '../transform.js'

export interface RowFactoryModuleOptions {
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
  /** Filename for the warn message. */
  filename: string
  /** Original source text — passed through to the rewrite (unused
   *  by the function, but the signature requires it). */
  source: string
}

export function rowFactoryModule(options: RowFactoryModuleOptions): CompilerModule {
  const { viewHelperNames, viewHelperAliases, filename, source } = options
  return {
    name: 'row-factory',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCall(ctx, node) {
      if (!isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)) return null
      try {
        return tryEmitRowFactory(node, ctx.factory, source)
      } catch (err) {
        const sf = ctx.analysis.sourceFile
        const line =
          node.pos >= 0 ? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 : 0
        console.warn(`[llui] Row factory failed in ${filename}:${line} — ${(err as Error).message}`)
        return null
      }
    },
  }
}

// ─── Rewrite implementation (moved verbatim from transform.ts) ─────

function tryEmitRowFactory(
  eachCall: ts.CallExpression,
  f: ts.NodeFactory,
  _originalSource: string,
): ts.CallExpression | null {
  const arg = eachCall.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null

  // Find render property
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
  const body = ts.isBlock(renderFn.body) ? renderFn.body : null
  if (!body) return null

  // Find the elTemplate call in the transformed render body
  let templateCall: ts.CallExpression | null = null
  let templateVarName: string | null = null

  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer)
        ) {
          if (
            ts.isIdentifier(decl.initializer.expression) &&
            decl.initializer.expression.text === 'elTemplate'
          ) {
            if (templateCall) return null // multiple templates — bail
            templateCall = decl.initializer
            templateVarName = decl.name.text
          }
        }
      }
    }
    // Check for nested structural primitives — bail
    if (containsStructuralCall(stmt)) return null
    // Bail on selector.bind() — row factory + selector causes V8 deopt
    // even without per-row disposers (selector fn declarations per render)
    if (_containsSelectorBind(stmt)) return null
  }

  if (!templateCall || templateCall.arguments.length < 2) return null

  // Extract HTML string
  const htmlArg = templateCall.arguments[0]
  if (!htmlArg || !ts.isStringLiteral(htmlArg)) return null
  const html = htmlArg.text

  // Extract patch function
  const patchFn = templateCall.arguments[1]
  if (!patchFn || (!ts.isArrowFunction(patchFn) && !ts.isFunctionExpression(patchFn))) return null
  const patchBody = ts.isBlock(patchFn.body) ? patchFn.body : null
  if (!patchBody) return null

  const rootParam = patchFn.parameters[0]
  const bindParam = patchFn.parameters[1]
  if (!rootParam || !bindParam) return null
  const rootName = ts.isIdentifier(rootParam.name) ? rootParam.name.text : null
  const bindName = ts.isIdentifier(bindParam.name) ? bindParam.name.text : null
  if (!rootName || !bindName) return null

  // Extract bindings from patch function
  interface RowBinding {
    nodeInitializer: ts.Expression // the node path expression (e.g., root.firstChild)
    kind: string
    key: string | undefined
    accessor: ts.Expression
  }
  const bindings: RowBinding[] = []
  const nodeVarInitializers = new Map<string, ts.Expression>()

  for (const stmt of patchBody.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          nodeVarInitializers.set(decl.name.text, decl.initializer)
        }
      }
    }

    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === bindName &&
        call.arguments.length >= 5
      ) {
        const nodeArg = call.arguments[0]!
        const maskArg = call.arguments[1]!
        const kindArg = call.arguments[2]!
        const keyArg = call.arguments[3]!
        const accessorArg = call.arguments[4]!

        // Must be per-item (mask -1)
        if (ts.isPrefixUnaryExpression(maskArg) && maskArg.operator === ts.SyntaxKind.MinusToken) {
          // -1 → per-item ✓
        } else if (ts.isBinaryExpression(maskArg)) {
          // -1 | 0 or 4294967295 | 0 → per-item ✓
        } else {
          return null // state-level binding — bail
        }

        const kind = ts.isStringLiteral(kindArg) ? kindArg.text : ''
        const key = ts.isStringLiteral(keyArg) ? keyArg.text : undefined

        // Resolve node path — recursively expand variable references to get
        // the full path from root, then create fresh factory nodes
        function resolveNodePath(expr: ts.Expression): ts.Expression {
          if (ts.isIdentifier(expr)) {
            if (expr.text === rootName) return f.createIdentifier(rootName)
            const init = nodeVarInitializers.get(expr.text)
            if (init) return resolveNodePath(init)
            return f.createIdentifier(expr.text)
          }
          if (ts.isPropertyAccessExpression(expr)) {
            return f.createPropertyAccessExpression(
              resolveNodePath(expr.expression),
              expr.name.text,
            )
          }
          if (ts.isElementAccessExpression(expr)) {
            return f.createElementAccessExpression(
              resolveNodePath(expr.expression),
              expr.argumentExpression,
            )
          }
          return expr
        }
        const nodeInit = resolveNodePath(nodeArg)

        // Clone accessor to strip source position — prevents mixed-position errors
        const clonedAccessor = ts.isIdentifier(accessorArg)
          ? f.createIdentifier(accessorArg.text)
          : accessorArg
        bindings.push({ nodeInitializer: nodeInit, kind, key, accessor: clonedAccessor })
      }
    }
  }

  if (bindings.length === 0) return null

  // Build map of __a{N} → __s{N} for rewriting accessor references.
  // After dedup, `__a{N} = acc(__s{N})`. In the row factory, __a{N} declarations
  // are eliminated, so all references must be rewritten to __s{N}.
  const accToSelector = new Map<string, string>()
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.name.text.startsWith('__a')) continue
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
      const callArg0 = decl.initializer.arguments[0]
      if (callArg0 && ts.isIdentifier(callArg0) && callArg0.text.startsWith('__s')) {
        accToSelector.set(decl.name.text, callArg0.text)
      }
    }
  }

  // Rewrite binding accessors: __a{N} → __s{N}
  for (const b of bindings) {
    if (ts.isIdentifier(b.accessor) && accToSelector.has(b.accessor.text)) {
      b.accessor = f.createIdentifier(accToSelector.get(b.accessor.text)!)
    }
  }

  // Collect __s{N} selector definitions — needed by __rowUpd and render init.
  // These are currently scoped to the render body; we'll hoist them into the
  // __rowUpd IIFE so they're accessible.
  const selectorDefs = new Map<string, ts.Expression>()
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text.startsWith('__s') && decl.initializer) {
        selectorDefs.set(decl.name.text, decl.initializer)
      }
    }
  }

  // === Generate the row factory ===

  // 1. __tpl: IIFE that creates + caches the template element
  const tplInit = f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock(
          [
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    't',
                    undefined,
                    undefined,
                    f.createCallExpression(
                      f.createPropertyAccessExpression(
                        f.createIdentifier('document'),
                        'createElement',
                      ),
                      undefined,
                      [f.createStringLiteral('template')],
                    ),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
            f.createExpressionStatement(
              f.createBinaryExpression(
                f.createPropertyAccessExpression(f.createIdentifier('t'), 'innerHTML'),
                ts.SyntaxKind.EqualsToken,
                f.createStringLiteral(html),
              ),
            ),
            f.createReturnStatement(f.createIdentifier('t')),
          ],
          true,
        ),
      ),
    ),
    undefined,
    [],
  )

  // 2. __rowUpd: (e) => { const t = e.current; for each binding: check + write }
  const updStmts: ts.Statement[] = []
  updStmts.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            't',
            undefined,
            undefined,
            f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!
    const vId = f.createIdentifier(`v${i}`)
    const cachedProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_v${i}`),
    )
    const nodeProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_n${i}`),
    )

    // const v{i} = accessor(t)
    updStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              vId,
              undefined,
              undefined,
              f.createCallExpression(b.accessor, undefined, [f.createIdentifier('t')]),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )

    // DOM write expression
    const domWrite =
      b.kind === 'text'
        ? f.createBinaryExpression(
            f.createPropertyAccessExpression(nodeProp, 'nodeValue'),
            ts.SyntaxKind.EqualsToken,
            vId,
          )
        : b.kind === 'class'
          ? f.createBinaryExpression(
              f.createPropertyAccessExpression(nodeProp, 'className'),
              ts.SyntaxKind.EqualsToken,
              vId,
            )
          : f.createBinaryExpression(
              f.createPropertyAccessExpression(nodeProp, 'nodeValue'),
              ts.SyntaxKind.EqualsToken,
              vId,
            )

    // if (v{i} !== e['_v{i}']) { e['_v{i}'] = v{i}; DOM_WRITE }
    updStmts.push(
      f.createIfStatement(
        f.createBinaryExpression(vId, ts.SyntaxKind.ExclamationEqualsEqualsToken, cachedProp),
        f.createBlock(
          [
            f.createExpressionStatement(
              f.createBinaryExpression(cachedProp, ts.SyntaxKind.EqualsToken, vId),
            ),
            f.createExpressionStatement(domWrite),
          ],
          true,
        ),
      ),
    )
  }

  // Wrap __rowUpd in IIFE that declares selectors (they're scoped to the
  // render body but __rowUpd lives on the options object outside render).
  const rawUpdFn = f.createArrowFunction(
    undefined,
    undefined,
    [f.createParameterDeclaration(undefined, undefined, 'e')],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(updStmts, true),
  )

  // Build: (() => { const __s0 = ...; const __s1 = ...; return (e) => { ... } })()
  const selectorDecls: ts.Statement[] = []
  for (const [name, init] of selectorDefs) {
    selectorDecls.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(name, undefined, undefined, init)],
          ts.NodeFlags.Const,
        ),
      ),
    )
  }
  selectorDecls.push(f.createReturnStatement(rawUpdFn))

  const rowUpdFn = f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock(selectorDecls, true),
      ),
    ),
    undefined,
    [],
  )

  // 3. New render callback: ({ entry: e, __tpl, __rowUpd }) => { ... }
  const renderStmts: ts.Statement[] = []

  // Declare selectors at the top of render body (they're used for initial values)
  for (const [name, init] of selectorDefs) {
    renderStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(name, undefined, undefined, init)],
          ts.NodeFlags.Const,
        ),
      ),
    )
  }

  // const r = __tpl.content.firstElementChild.cloneNode(true)
  renderStmts.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            'r',
            undefined,
            undefined,
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(
                  f.createPropertyAccessExpression(f.createIdentifier('__tpl'), 'content'),
                  'firstElementChild',
                ),
                'cloneNode',
              ),
              undefined,
              [f.createTrue()],
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  // For each binding: store node ref, compute initial, apply
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!
    const nProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_n${i}`),
    )
    const vProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_v${i}`),
    )

    // Rewrite node path: replace root param name with 'r'
    const rewrittenPath = rewriteRoot(b.nodeInitializer, rootName, 'r', f)

    // e['_n{i}'] = rewrittenPath
    renderStmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(nProp, ts.SyntaxKind.EqualsToken, rewrittenPath),
      ),
    )

    // e['_v{i}'] = accessor(e.current)
    renderStmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          vProp,
          ts.SyntaxKind.EqualsToken,
          f.createCallExpression(b.accessor, undefined, [
            f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
          ]),
        ),
      ),
    )

    // DOM write: e['_n{i}'].nodeValue = e['_v{i}']
    const initWrite =
      b.kind === 'text'
        ? f.createBinaryExpression(
            f.createPropertyAccessExpression(nProp, 'nodeValue'),
            ts.SyntaxKind.EqualsToken,
            vProp,
          )
        : b.kind === 'class'
          ? f.createBinaryExpression(
              f.createPropertyAccessExpression(nProp, 'className'),
              ts.SyntaxKind.EqualsToken,
              vProp,
            )
          : f.createBinaryExpression(
              f.createPropertyAccessExpression(nProp, 'nodeValue'),
              ts.SyntaxKind.EqualsToken,
              vProp,
            )
    renderStmts.push(f.createExpressionStatement(initWrite))
  }

  // e.__rowUpdate = __rowUpd
  renderStmts.push(
    f.createExpressionStatement(
      f.createBinaryExpression(
        f.createPropertyAccessExpression(f.createIdentifier('e'), '__rowUpdate'),
        ts.SyntaxKind.EqualsToken,
        f.createIdentifier('__rowUpd'),
      ),
    ),
  )

  // Rewrite a statement: replace __a{N}() → __s{N}(e.current),
  // replace template var → r, strip positions via deep clone.
  function rewriteStmt(stmt: ts.Statement): ts.Statement {
    function visit(node: ts.Node): ts.Node {
      // Skip nested functions whose param shadows `templateVarName`.
      // Without this, a user-named template (e.g. `const tpl = elTemplate(...)`)
      // paired with a render-body callback that reuses `tpl` as a
      // parameter name would have the inner reference incorrectly
      // rewritten to `r`. Defensive fix — unlikely in practice
      // (template names are typically `__tpl{N}`) but the bug shape
      // mirrors the other shadow-blind walkers fixed in this round.
      if (
        templateVarName &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node) ||
          ts.isFunctionDeclaration(node)) &&
        shadowsStateParam(node.parameters, templateVarName)
      ) {
        return node
      }
      // Rewrite __a{N}() → __s{N}(e.current)
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        accToSelector.has(node.expression.text) &&
        node.arguments.length === 0
      ) {
        const selectorName = accToSelector.get(node.expression.text)!
        return f.createCallExpression(f.createIdentifier(selectorName), undefined, [
          f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
        ])
      }
      // Rewrite template variable → r
      if (ts.isIdentifier(node) && templateVarName && node.text === templateVarName) {
        return f.createIdentifier('r')
      }
      // Clone identifiers to strip positions
      if (ts.isIdentifier(node)) {
        return f.createIdentifier(node.text)
      }
      return ts.visitEachChild(node, visit, undefined!)
    }
    return ts.visitEachChild(stmt, visit, undefined!) as ts.Statement
  }

  // Preserve non-template, non-compiler-generated, non-return statements.
  for (const stmt of body.statements) {
    if (ts.isReturnStatement(stmt)) continue

    if (ts.isVariableStatement(stmt)) {
      // Skip template declaration
      const isTemplate = stmt.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === templateVarName,
      )
      if (isTemplate) continue
      // Skip __a{N} and __s{N} declarations (compiler-generated acc/selector)
      const isCompilerOnly = stmt.declarationList.declarations.every(
        (d) =>
          ts.isIdentifier(d.name) &&
          (d.name.text.startsWith('__a') || d.name.text.startsWith('__s')),
      )
      if (isCompilerOnly) continue
    }

    // Rewrite and include
    renderStmts.push(rewriteStmt(stmt))
  }

  // return [r]
  renderStmts.push(
    f.createReturnStatement(f.createArrayLiteralExpression([f.createIdentifier('r')])),
  )

  const newRenderFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(
        undefined,
        undefined,
        f.createObjectBindingPattern([
          f.createBindingElement(undefined, 'entry', 'e'),
          f.createBindingElement(undefined, undefined, '__tpl'),
          f.createBindingElement(undefined, undefined, '__rowUpd'),
        ]),
      ),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(renderStmts, true),
  )

  // 4. Build new each options. To avoid mixed-position AST issues, we keep
  // original properties unchanged and only ADD __tpl, __rowUpd, and replace render.
  // The trick: return the original node structure but with the render property
  // swapped. Use ts.factory.updateObjectLiteralExpression which preserves positions.
  const updatedProps = arg.properties.map(
    (p): ts.ObjectLiteralElementLike =>
      p === renderProp ? f.createPropertyAssignment('render', newRenderFn) : p,
  )
  updatedProps.push(f.createPropertyAssignment('__tpl', tplInit))
  updatedProps.push(f.createPropertyAssignment('__rowUpd', rowUpdFn))

  const newOpts = f.updateObjectLiteralExpression(arg, updatedProps)

  return f.updateCallExpression(eachCall, eachCall.expression, eachCall.typeArguments, [
    newOpts,
    ...eachCall.arguments.slice(1),
  ])
}

function _containsSelectorBind(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'bind'
  ) {
    return true
  }
  return ts.forEachChild(node, _containsSelectorBind) ?? false
}

function containsStructuralCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    if (['each', 'branch', 'scope', 'show', 'child', 'foreign'].includes(node.expression.text))
      return true
  }
  return ts.forEachChild(node, containsStructuralCall) ?? false
}

/** Rewrite property access chains replacing oldRoot identifier with newRoot */
function rewriteRoot(
  expr: ts.Expression,
  oldRoot: string,
  newRoot: string,
  f: ts.NodeFactory,
): ts.Expression {
  if (ts.isIdentifier(expr) && expr.text === oldRoot) return f.createIdentifier(newRoot)
  if (ts.isPropertyAccessExpression(expr)) {
    return f.createPropertyAccessExpression(
      rewriteRoot(expr.expression, oldRoot, newRoot, f),
      expr.name.text,
    )
  }
  if (ts.isElementAccessExpression(expr)) {
    return f.createElementAccessExpression(
      rewriteRoot(expr.expression, oldRoot, newRoot, f),
      expr.argumentExpression,
    )
  }
  return expr
}
