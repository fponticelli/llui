// Aggressive, sound dependency analyzer for signal accessor bodies.
//
// Given a `.map`/`derived` callback (a closed function whose state entry is a
// single known-rooted parameter), compute the set of dependency paths the body
// reads — relative to each parameter. The analysis is intra-procedural here;
// inter-procedural narrowing (following local helpers) is a later step.
//
// SOUNDNESS (the invariant the property test enforces): imprecision coarsens,
// it never misses. Dependencies are about COVERAGE — a dep on a prefix path `p`
// covers any change to a descendant `p.x.y` (immutable updates change the prefix
// reference). So when the analyzer cannot narrow (method call, escape into a
// function, dynamic key, iteration, unknown syntax), it emits the wholesale
// parent path, which covers everything beneath it. The result is always a
// superset of the true dependencies.
//
// See docs/proposals/signals/README.md "Dependency Analysis".

import ts from 'typescript'

/** Per-parameter dependency paths. `deps[i]` holds dotted relative paths read
 * from parameter `i`; the empty string `''` means the whole parameter. */
export interface DepResult {
  deps: Set<string>[]
}

// A taint set tracks which (param, path) a value may carry. Entries are encoded
// as `"<paramIndex> <dotted.path>"`; an empty path = the whole parameter.
const SEP = ' '
type Taint = Set<string>

function enc(param: number, path: string): string {
  return `${param}${SEP}${path}`
}
function* decode(t: Taint): Generator<{ param: number; path: string }> {
  for (const e of t) {
    const i = e.indexOf(SEP)
    yield { param: Number(e.slice(0, i)), path: e.slice(i + 1) }
  }
}
function member(t: Taint, key: string): Taint {
  const out: Taint = new Set()
  for (const { param, path } of decode(t)) {
    out.add(enc(param, path === '' ? key : `${path}.${key}`))
  }
  return out
}
function union(a: Taint, b: Taint): Taint {
  const out = new Set(a)
  for (const e of b) out.add(e)
  return out
}

/**
 * Analyze a signal-accessor function. Each parameter is treated as a tainted
 * root; the returned `deps[i]` is the set of paths read from parameter `i`.
 */
export function analyzeAccessor(fn: ts.ArrowFunction | ts.FunctionExpression): DepResult {
  const deps: Set<string>[] = fn.parameters.map(() => new Set<string>())

  // Scope chain of name -> taint. Inner scopes shadow outer ones, so a nested
  // closure parameter named the same as an outer binding correctly does NOT
  // resolve to the outer taint.
  const scopes: Map<string, Taint>[] = [new Map()]
  const pushScope = (): void => void scopes.push(new Map())
  const popScope = (): void => void scopes.pop()
  const bind = (name: string, t: Taint): void => void scopes[scopes.length - 1]!.set(name, t)
  const lookup = (name: string): Taint | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const t = scopes[i]!.get(name)
      if (t) return t
    }
    return undefined
  }

  const emit = (t: Taint): void => {
    for (const { param, path } of decode(t)) deps[param]!.add(path)
  }

  const propNameText = (n: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text
    return undefined
  }

  // Bind a (possibly destructured) parameter/binding to a taint.
  const bindPattern = (name: ts.BindingName, base: Taint): void => {
    if (ts.isIdentifier(name)) {
      bind(name.text, base)
      return
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) {
        if (el.dotDotDotToken) {
          emit(base) // rest captures unknown remaining keys -> wholesale parent
          if (ts.isIdentifier(el.name)) bind(el.name.text, new Set())
          continue
        }
        // A default initializer (`{ x = expr }`) is evaluated when the key is
        // absent — its reads are genuine dependencies.
        if (el.initializer) emit(evalExpr(el.initializer))
        const key = el.propertyName
          ? propNameText(el.propertyName)
          : ts.isIdentifier(el.name)
            ? el.name.text
            : undefined
        if (key !== undefined) bindPattern(el.name, member(base, key))
        else emit(base) // computed key we can't track -> wholesale parent
      }
      return
    }
    // array binding pattern
    name.elements.forEach((el, idx) => {
      if (ts.isOmittedExpression(el)) return
      if (el.dotDotDotToken) {
        emit(base)
        if (ts.isIdentifier(el.name)) bind(el.name.text, new Set())
        return
      }
      if (el.initializer) emit(evalExpr(el.initializer)) // `[x = expr]` default read
      bindPattern(el.name, member(base, String(idx)))
    })
  }

  // Evaluate a function-like scope (arrow, function expression, or object-literal
  // method/accessor): bind its params (evaluating parameter defaults, which are
  // real reads) and analyze its body.
  const evalFnScope = (
    parameters: readonly ts.ParameterDeclaration[],
    body: ts.ConciseBody | undefined,
  ): void => {
    pushScope()
    for (const p of parameters) {
      if (p.initializer) emit(evalExpr(p.initializer))
      bindPattern(p.name, new Set())
    }
    if (body) evalBody(body)
    popScope()
  }

  // Sound coarse fallback: emit the taint of every identifier read in a subtree,
  // descending normally but handing nested closures to evalExpr (for scope).
  const emitReads = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      emit(lookup(node.text) ?? new Set())
      return
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      evalExpr(node)
      return
    }
    node.forEachChild(emitReads)
  }

  // Evaluate an expression to the taint set its VALUE may carry. Emits deps for
  // any sub-expression that is consumed (read for its data).
  const evalExpr = (node: ts.Expression | undefined): Taint => {
    if (!node) return new Set()

    if (ts.isIdentifier(node)) return lookup(node.text) ?? new Set()
    if (node.kind === ts.SyntaxKind.ThisKeyword) return new Set()
    if (ts.isParenthesizedExpression(node)) return evalExpr(node.expression)
    if (ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
      return evalExpr(node.expression)
    }

    if (ts.isPropertyAccessExpression(node)) {
      return member(evalExpr(node.expression), node.name.text)
    }

    if (ts.isElementAccessExpression(node)) {
      const recv = evalExpr(node.expression)
      const arg = node.argumentExpression
      if (ts.isStringLiteral(arg) || ts.isNumericLiteral(arg)) return member(recv, arg.text)
      emit(recv) // dynamic key: any key may be read -> wholesale receiver
      emit(evalExpr(arg))
      return new Set()
    }

    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        emit(evalExpr(node.expression.expression)) // method reads receiver wholesale
      } else {
        emit(evalExpr(node.expression)) // calling a tainted value escapes it
      }
      for (const a of node.arguments) emit(evalExpr(a)) // args escape into the opaque callee
      return new Set() // unknown return (intra-procedural)
    }

    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) emit(evalExpr(span.expression))
      return new Set()
    }
    if (ts.isTaggedTemplateExpression(node)) {
      emit(evalExpr(node.tag))
      if (ts.isTemplateExpression(node.template)) {
        for (const span of node.template.templateSpans) emit(evalExpr(span.expression))
      }
      return new Set()
    }

    if (ts.isBinaryExpression(node)) {
      const left = evalExpr(node.left)
      const right = evalExpr(node.right)
      const op = node.operatorToken.kind
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        emit(left) // left operand is always evaluated/tested
        return union(left, right) // logical ops return one operand
      }
      emit(left)
      emit(right)
      return new Set()
    }

    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      emit(evalExpr(node.operand))
      return new Set()
    }

    if (ts.isConditionalExpression(node)) {
      emit(evalExpr(node.condition))
      return union(evalExpr(node.whenTrue), evalExpr(node.whenFalse))
    }

    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (ts.isSpreadElement(el)) emit(evalExpr(el.expression))
        else emit(evalExpr(el))
      }
      return new Set()
    }

    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p)) emit(evalExpr(p.initializer))
        else if (ts.isShorthandPropertyAssignment(p)) emit(lookup(p.name.text) ?? new Set())
        else if (ts.isSpreadAssignment(p)) emit(evalExpr(p.expression))
        else if (
          ts.isMethodDeclaration(p) ||
          ts.isGetAccessorDeclaration(p) ||
          ts.isSetAccessorDeclaration(p)
        ) {
          // A method/getter/setter body is a closure over the enclosing scope —
          // analyze it like an arrow so its reads aren't missed.
          evalFnScope(p.parameters, p.body)
        }
      }
      return new Set()
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      evalFnScope(node.parameters, node.body)
      return new Set()
    }

    // Unknown expression form: sound coarse fallback.
    emitReads(node)
    return new Set()
  }

  const evalStmt = (st: ts.Statement): void => {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        bindPattern(d.name, d.initializer ? evalExpr(d.initializer) : new Set())
      }
      return
    }
    if (ts.isReturnStatement(st)) {
      emit(evalExpr(st.expression)) // returned value is consumed downstream
      return
    }
    if (ts.isExpressionStatement(st)) {
      emit(evalExpr(st.expression))
      return
    }
    if (ts.isIfStatement(st)) {
      emit(evalExpr(st.expression))
      evalStmt(st.thenStatement)
      if (st.elseStatement) evalStmt(st.elseStatement)
      return
    }
    if (ts.isBlock(st)) {
      pushScope()
      for (const s of st.statements) evalStmt(s)
      popScope()
      return
    }
    if (ts.isForOfStatement(st) || ts.isForInStatement(st)) {
      emit(evalExpr(st.expression)) // iterating reads the whole collection
      pushScope()
      if (ts.isVariableDeclarationList(st.initializer)) {
        for (const d of st.initializer.declarations) bindPattern(d.name, new Set())
      }
      evalStmt(st.statement)
      popScope()
      return
    }
    // Other statements: recurse statements, coarse-emit expression children.
    st.forEachChild((c) => {
      if (isStmt(c)) evalStmt(c)
      else emitReads(c)
    })
  }

  const evalBody = (body: ts.ConciseBody): void => {
    if (ts.isBlock(body)) {
      pushScope()
      for (const s of body.statements) evalStmt(s)
      popScope()
    } else {
      emit(evalExpr(body)) // concise body IS the returned (consumed) value
    }
  }

  fn.parameters.forEach((p, i) => {
    if (p.initializer) emit(evalExpr(p.initializer)) // top-level parameter default read
    bindPattern(p.name, new Set([enc(i, '')]))
  })
  evalBody(fn.body)

  return { deps }
}

function isStmt(n: ts.Node): n is ts.Statement {
  return n.kind >= ts.SyntaxKind.FirstStatement && n.kind <= ts.SyntaxKind.LastStatement
}

/** Does emitted dependency set `emitted` COVER a change at `path`? A dep on a
 * prefix covers any descendant (immutable update changes the prefix ref); a dep
 * deeper than the changed node is also covered (the change propagates up the
 * ref chain); the empty path covers everything. */
export function covers(emitted: Set<string>, path: string): boolean {
  for (const e of emitted) {
    if (e === '' || e === path) return true
    if (path.startsWith(e + '.')) return true
    if (e.startsWith(path + '.')) return true
  }
  return false
}
