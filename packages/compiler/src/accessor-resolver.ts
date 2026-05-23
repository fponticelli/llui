import ts from 'typescript'

/**
 * Helpers for resolving identifier references at reactive-accessor
 * positions. Shared by `transform.ts` (compile-time prop classification
 * + Pass 2 mask injection) and `collect-deps.ts` (state-path scanning
 * for `__dirty` / `__maskLegend`).
 *
 * The compiler must distinguish the legitimate accessor shapes:
 *
 *   - Inline arrow / function expression at the call site
 *   - Inline `memo(arrow)` at the call site
 *   - Identifier referencing a const-bound arrow / function expression
 *   - Identifier referencing a hoisted function declaration
 *   - Identifier referencing `const x = memo(arrow)`
 *
 * …from values we can't classify (imports, parameters, opaque calls), so
 * those can be bailed-to-runtime instead of silently miscompiled. See the
 * `disabled` binding bug, where a function reference at a reactive prop
 * position was statically assigned (`__e.disabled = isGated`) — writing
 * the function object onto the boolean DOM property and never re-evaluating.
 */

/**
 * Walk parent chains to find a `const X = ...` declaration matching
 * `use.text`, or a hoisted `function X(...)` declaration. Returns the
 * resolved declaration or `null` for unresolvable references (imports,
 * parameters, this-bindings, etc.).
 *
 * Limitations:
 *   - Only `const`. `let` resolution is unsafe — we can't track later
 *     reassignments without a type checker.
 *   - Only single-binding declarations (`const a = …`, not `const a = …, b = …`).
 *   - The declaration must dominate the use (lexical scope).
 */
export function resolveLocalConstInitializer(
  use: ts.Identifier,
): ts.Expression | ts.FunctionDeclaration | null {
  const name = use.text
  let node: ts.Node = use
  while (node.parent) {
    const parent = node.parent
    let statements: readonly ts.Statement[] | null = null
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)) {
      statements = parent.statements
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      statements = parent.statements
    }
    if (statements) {
      for (const stmt of statements) {
        if (ts.isFunctionDeclaration(stmt)) {
          if (stmt.name && stmt.name.text === name) return stmt
          continue
        }
        if (!ts.isVariableStatement(stmt)) continue
        const flags = stmt.declarationList.flags
        if (!(flags & ts.NodeFlags.Const)) continue
        if (stmt.declarationList.declarations.length !== 1) continue
        const decl = stmt.declarationList.declarations[0]!
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue
        if (!decl.initializer) continue
        return decl.initializer
      }
    }
    node = parent
  }
  return null
}

/**
 * Recognize `memo(arrow)` / `memo(fn)` calls so the inner accessor can
 * be analyzed for state-path masking. The runtime `memo()` returns a
 * cached accessor — its body's reads determine when it re-evaluates,
 * not the call site.
 */
export function isMemoCallWithArrowArg(expr: ts.Expression): expr is ts.CallExpression & {
  arguments: readonly [ts.ArrowFunction | ts.FunctionExpression, ...ts.Expression[]]
} {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'memo' &&
    expr.arguments.length >= 1 &&
    (ts.isArrowFunction(expr.arguments[0]!) || ts.isFunctionExpression(expr.arguments[0]!))
  )
}

/**
 * Resolve a value at a reactive-accessor position down to the callable
 * AST node we can mask-analyze. Returns `null` when the value isn't a
 * recognized accessor shape — caller leaves the call unchanged (runtime
 * falls back to FULL_MASK, which is correct just slower).
 *
 * Recognized shapes:
 *   - `(s) => …` (ArrowFunction)
 *   - `function (s) { … }` (FunctionExpression)
 *   - `memo((s) => …)` — returns the inner arrow
 *   - `someIdentifier` resolving to any of the above (or to a hoisted
 *     `function X(s) { … }` declaration)
 *
 * When `checker` is supplied, identifier resolution follows alias chains
 * across files: `import { matrixOrEmpty } from '../state'` becomes
 * resolvable. Without a checker the resolver falls back to file-local
 * `const`/`function` lookup. The cross-file path requires the
 * identifier's AST node to be bound to the checker's Program — pass
 * nodes obtained via `program.getSourceFile(...)`, not from a freshly
 * `ts.createSourceFile`'d copy. (See AnalysisContext.program.)
 */
export function resolveAccessorBody(
  value: ts.Expression,
  checker?: ts.TypeChecker,
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | null {
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value
  if (isMemoCallWithArrowArg(value)) {
    return value.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
  }
  if (ts.isIdentifier(value)) {
    const local = resolveLocalConstInitializer(value)
    if (local) {
      if (
        ts.isArrowFunction(local) ||
        ts.isFunctionExpression(local) ||
        ts.isFunctionDeclaration(local)
      ) {
        return local
      }
      if (isMemoCallWithArrowArg(local)) {
        return local.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
      }
      return null
    }
    if (checker) {
      const resolved = resolveCrossFileAccessor(value, checker)
      if (resolved) return resolved
    }
  }
  return null
}

/**
 * Follow the alias chain for an identifier reference through the type
 * checker, then inspect the resolved symbol's declarations for an arrow
 * accessor we can mask-analyze. This is the same descent the cross-file
 * walker does for view-helper classification (`cross-file-walker.ts`),
 * applied here so a same-package import like
 *   `import { matrixOrEmpty } from '../state'`
 *   `value: (s) => matrixOrEmpty(s).field`
 * doesn't trip the opaque-flow leak diagnostic — the walker descends
 * into `matrixOrEmpty`'s body and the call is tracked.
 *
 * Returns null for ambient declarations, type-only imports, parameters,
 * destructured bindings, and re-exports the checker can't pin to a
 * function-like declaration — every shape the opaque-flow rule is
 * documented to flag as a leak.
 */
function resolveCrossFileAccessor(
  use: ts.Identifier,
  checker: ts.TypeChecker,
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | null {
  let sym = checker.getSymbolAtLocation(use)
  if (!sym) return null
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(sym)
    } catch {
      return null
    }
  }
  const decls = sym.getDeclarations()
  if (!decls || decls.length === 0) return null
  for (const decl of decls) {
    if (ts.isFunctionDeclaration(decl) && decl.body) return decl
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = decl.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init
      if (isMemoCallWithArrowArg(init)) {
        return init.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
      }
    }
  }
  return null
}
