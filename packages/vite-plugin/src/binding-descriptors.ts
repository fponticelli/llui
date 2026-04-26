import ts from 'typescript'

/**
 * Compiler passes that surface the Msg variants currently dispatchable
 * from rendered UI to the agent layer's `list_actions`. Two passes
 * cover two distinct dispatch shapes:
 *
 * 1. `tagEventHandlerSends` — tags event-handler arrow functions
 *    (`onClick`, `onInput`, …) whose body contains literal
 *    `<id>({type: 'X', …})` call sites. Wraps with
 *    `Object.assign(arrow, { __lluiVariants: ['X', …] })`. The
 *    runtime in `@llui/dom` `elements.ts` / `el-split.ts` reads the
 *    metadata at bind time and registers the variants on the active
 *    component instance for the lifetime of the binding's scope.
 *
 * 2. `injectScopeVariantRegistrations` — handles the
 *    dispatch-translation case that pass (1) can't follow:
 *    `<bag>.connect(get, sendFn, …)` where `sendFn` is a user-
 *    defined function that translates library Msgs into app Msgs via
 *    `dispatch({type: 'X', …})`. Static analysis of the library's
 *    internal onClick can't see across this hop. The pass detects the
 *    `*.connect(get, sendFn, …)` syntactic pattern, follows `sendFn`
 *    to its declaration, scans the body for literal dispatches, and
 *    inserts a runtime `__registerScopeVariants(['X', …])` call
 *    immediately before the connect call. Lifetime semantics fall
 *    out of the render context: the call's active scope is whatever
 *    `each(...)` / `branch(...)` / root scope happens to be live when
 *    the view evaluates that statement.
 *
 * Both passes are gated on `devMode || emitAgentMetadata` in
 * `transform.ts`. Production bundles without agent integration get
 * neither the per-handler `Object.assign` cost nor the registration
 * statements.
 *
 * False positives are deliberate. The alternative — proving the
 * callee resolves to the destructured `send` from a `View` bag, or
 * tracing function calls across files — would require full scope
 * tracking the compiler doesn't do. In practice the patterns
 * `<id>({type:'X',…})` and `*.connect(get, fn, …)` are reliable
 * shape-level signals; an extra entry in the live descriptor
 * registry just means the agent sees one more "affordable variant"
 * than necessary — never a wrong dispatch, never a runtime error.
 *
 * False negatives stay where they were: non-literal `type` values
 * (`send({ type: nextStep })`), and dispatch translators bound via
 * patterns other than `*.connect(get, fn, …)`. Apps that hit those
 * cases declare `agentAffordances` on the component def — the
 * documented escape hatch.
 *
 * @see agent spec §5.2, §12.2
 * @see @llui/dom binding-descriptors.ts (runtime registry + helper)
 */

// ── Pass 1: event-handler tagger ────────────────────────────────────

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

function maybeTagHandler(value: ts.Expression, f: ts.NodeFactory): ts.Expression | null {
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return null
  const variants = collectLiteralSendVariants(value.body)
  if (variants.length === 0) return value
  return wrapWithVariants(value, variants, f)
}

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

// ── Pass 3: dispatch-translator tagger ──────────────────────────────

/**
 * Tags variable-bound arrow/function expressions whose body contains
 * literal `<id>({type:'X', …})` dispatches with
 * `Object.assign(fn, {__lluiVariants: ['X', …]})`. Complements Pass 1
 * (event-handler arrows): translator functions are commonly declared
 * once and passed by reference (`*.connect(get, sendMenu, …)`) — often
 * at module top-level — so the inline-arrow tagger can't reach them.
 *
 * The tag travels with the function reference. Library `*.connect`
 * implementations call `tagSend(send, libVariants, fn)` on each
 * returned handler, which prefers `send.__lluiVariants` over
 * `libVariants` so the agent surfaces the USER's variants (what
 * `update()` actually receives) rather than the library's internal
 * Msg shape.
 *
 * Module-scope is fine here — Pass 2's module-scope skip exists
 * because eager `__registerScopeVariants(...)` would no-op outside a
 * render context, but Pass 3's tag is read lazily at binding time
 * (always inside a render context by definition).
 *
 * Already-wrapped initializers (CallExpressions, including
 * user-applied `tagSend(...)` or prior compiler output) are left
 * untouched — Pass 3 only fires when the initializer is a bare arrow
 * or function expression.
 *
 * Pass ordering: Pass 1 → Pass 2 → Pass 3. Running Pass 3 last
 * preserves Pass 2's `collectLocalFns` resolution: that helper looks
 * for variable declarations whose initializer is itself an arrow or
 * function expression, which Pass 3 would replace with a CallExpression
 * wrapper.
 */
export function tagDispatchTranslators(node: ts.SourceFile, f: ts.NodeFactory): ts.SourceFile {
  const transformer: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    const visit: ts.Visitor = (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      ) {
        const variants = collectLiteralSendVariants(n.initializer.body)
        if (variants.length > 0) {
          const wrapped = wrapWithVariants(n.initializer, variants, f)
          return f.updateVariableDeclaration(n, n.name, n.exclamationToken, n.type, wrapped)
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

// ── Pass 2: connect-pattern registration injector ────────────────

export interface InjectResult {
  sf: ts.SourceFile
  /** True when at least one `__registerScopeVariants(...)` call was inserted. */
  injected: boolean
}

export function injectScopeVariantRegistrations(
  node: ts.SourceFile,
  f: ts.NodeFactory,
): InjectResult {
  let injected = false

  const transformer: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    /**
     * Tracks whether we're inside a function body. Top-level
     * (module-scope) connect calls are skipped — there's no render
     * context active when module code runs, so the registration
     * would silently no-op anyway, and emitting it adds noise. Apps
     * with module-scope translators (a single shared `parts` re-used
     * across views) declare `agentAffordances` instead.
     */
    let inFunction = 0

    function rewriteBlock<B extends ts.Block | ts.SourceFile>(block: B): B {
      const stmts = (block as ts.Block | ts.SourceFile).statements
      const localFns = collectLocalFns(stmts)
      const out: ts.Statement[] = []
      for (const stmt of stmts) {
        const visited = ts.visitNode(stmt, (n) => visitNode(n, localFns)) as ts.Statement
        out.push(visited)
      }
      if (ts.isSourceFile(block)) {
        return f.updateSourceFile(block, out) as B
      }
      return f.updateBlock(block, out) as B
    }

    function visitNode(
      n: ts.Node,
      localFns: Map<string, ts.ArrowFunction | ts.FunctionExpression>,
    ): ts.Node {
      if (ts.isBlock(n)) {
        return rewriteBlock(n)
      }
      // Track function-body nesting so we know whether the current
      // call site can plausibly run within a render context. Arrow
      // functions and function expressions/declarations both qualify.
      if (
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n)
      ) {
        inFunction++
        const r = ts.visitEachChild(n, (c) => visitNode(c, localFns), ctx)
        inFunction--
        return r
      }
      if (ts.isCallExpression(n) && inFunction > 0 && isConnectCallShape(n)) {
        const sendArg = n.arguments[1]!
        const sendFn = resolveSendFn(sendArg, localFns)
        if (sendFn) {
          const variants = collectLiteralSendVariants(sendFn.body)
          if (variants.length > 0) {
            // Replace the call expression with a comma expression:
            //   (__registerScopeVariants([...]), originalCall)
            // The comma keeps the call's value position intact (so
            // `const parts = popover.connect(...)` still binds the
            // original return), and ensures the registration fires
            // *before* the call returns. This positions correctly
            // regardless of the surrounding function context: view
            // body, render callback inside `each(...)`, or any
            // nested helper called from within a view.
            injected = true
            const inner = ts.visitEachChild(
              n,
              (c) => visitNode(c, localFns),
              ctx,
            ) as ts.CallExpression
            return f.createParenthesizedExpression(
              f.createBinaryExpression(
                emitRegisterCall(variants, f),
                f.createToken(ts.SyntaxKind.CommaToken),
                inner,
              ),
            )
          }
        }
      }
      return ts.visitEachChild(n, (c) => visitNode(c, localFns), ctx)
    }

    return (sf) => rewriteBlock(sf)
  }

  const result = ts.transform(node, [transformer])
  const out = result.transformed[0] as ts.SourceFile
  result.dispose()
  return { sf: out, injected }
}

/**
 * Collect `const fn = (m) => { … }` / `const fn = function(m){ … }`
 * declarations in `stmts` so an identifier passed to a connect call
 * later in the same scope can resolve to its body. Conservative —
 * only direct function-valued initializers count; aliasing
 * (`const a = b`) is not followed.
 */
function collectLocalFns(
  stmts: ts.NodeArray<ts.Statement>,
): Map<string, ts.ArrowFunction | ts.FunctionExpression> {
  const out = new Map<string, ts.ArrowFunction | ts.FunctionExpression>()
  for (const stmt of stmts) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      const init = decl.initializer
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        out.set(decl.name.text, init)
      }
    }
  }
  return out
}

function isConnectCallShape(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  if (node.expression.name.text !== 'connect') return false
  return node.arguments.length >= 2
}

function resolveSendFn(
  arg: ts.Expression,
  localFns: Map<string, ts.ArrowFunction | ts.FunctionExpression>,
): ts.ArrowFunction | ts.FunctionExpression | null {
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg
  if (ts.isIdentifier(arg)) return localFns.get(arg.text) ?? null
  return null
}

function emitRegisterCall(variants: readonly string[], f: ts.NodeFactory): ts.CallExpression {
  return f.createCallExpression(f.createIdentifier('__registerScopeVariants'), undefined, [
    f.createArrayLiteralExpression(
      variants.map((v) => f.createStringLiteral(v)),
      false,
    ),
  ])
}

// ── Shared: literal-send variant collection ──────────────────────────

/**
 * Recursively walk `node`, collecting every literal type string from
 * `<id>({ type: 'literal', … })` call sites. De-dupes while preserving
 * first-seen order so the emitted array reads naturally for anyone
 * inspecting the compiled output.
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
