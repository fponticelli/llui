import ts from 'typescript'

export interface LintViolation {
  rule: string
  message: string
  file: string
  line: number
  column: number
  suggestion?: string
}

export interface LintResult {
  violations: LintViolation[]
  /** Score from 0 to 15. Starts at 15, -1 per violated rule category. */
  score: number
}

/**
 * Lint a single source file for LLui idiomatic anti-patterns.
 * Returns violations and a numeric score (6 = perfect).
 */
export function lintIdiomatic(source: string, filename = 'input.ts'): LintResult {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const violations: LintViolation[] = []

  checkStateMutation(sf, filename, violations)
  checkMissingMemo(sf, filename, violations)
  checkEachClosureViolation(sf, filename, violations)
  checkMapOnStateArrays(sf, filename, violations)
  checkUnnecessaryChild(sf, filename, violations)
  checkFormBoilerplate(sf, filename, violations)
  checkAsyncUpdate(sf, filename, violations)
  checkDirectStateInView(sf, filename, violations)
  checkExhaustiveEffectHandling(sf, filename, violations)
  checkEffectWithoutHandler(sf, filename, violations)
  checkForgottenSpread(sf, filename, violations)
  checkStringEffectCallback(sf, filename, violations)
  checkNestedSendInUpdate(sf, filename, violations)
  checkImperativeDomInView(sf, filename, violations)
  checkAccessorSideEffect(sf, filename, violations)

  // Score: unique violated rule categories
  const violatedRules = new Set(violations.map((v) => v.rule))
  const score = Math.max(0, 15 - violatedRules.size)

  return { violations, score }
}

// ── Helpers ─────────────────────────────────────────────────────────

function pos(node: ts.Node, sf: ts.SourceFile): { line: number; column: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return { line: line + 1, column: character + 1 }
}

function isStatePropertyAccess(node: ts.Node, stateName: string): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === stateName) return true
    return isStatePropertyAccess(node.expression, stateName)
  }
  return false
}

function isInsideViewFunction(node: ts.Node): boolean {
  let current = node.parent
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      if (ts.isIdentifier(current.name) && current.name.text === 'view') {
        return true
      }
    }
    current = current.parent
  }
  return false
}

function referencesStateParam(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return referencesStateParam(node.expression)
  }
  if (ts.isIdentifier(node)) {
    const name = node.text
    return name === 'state' || name === 's' || name === '_state'
  }
  return false
}

// ── Rule 1: state-mutation ──────────────────────────────────────────

function checkStateMutation(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'update'
    ) {
      const fn = node.initializer
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        const stateParam = fn.parameters[0]
        if (stateParam && ts.isIdentifier(stateParam.name)) {
          const stateName = stateParam.name.text
          checkMutationsInBody(fn.body, stateName, sf, filename, violations)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function checkMutationsInBody(
  node: ts.Node,
  stateName: string,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Check for direct assignment: state.x = y
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (isStatePropertyAccess(node.left, stateName)) {
      const { line, column } = pos(node, sf)
      violations.push({
        rule: 'state-mutation',
        message: `Direct mutation of state via assignment in update(). Use spread: { ...${stateName}, field: newValue }`,
        file: filename,
        line,
        column,
        suggestion: `Return a new object: { ...${stateName}, ... }`,
      })
    }
  }
  // Check for compound assignment: state.x += y
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.PlusEqualsToken,
      ts.SyntaxKind.MinusEqualsToken,
      ts.SyntaxKind.AsteriskEqualsToken,
      ts.SyntaxKind.SlashEqualsToken,
    ].includes(node.operatorToken.kind)
  ) {
    if (isStatePropertyAccess(node.left, stateName)) {
      const { line, column } = pos(node, sf)
      violations.push({
        rule: 'state-mutation',
        message: 'Compound assignment on state in update(). State is immutable.',
        file: filename,
        line,
        column,
      })
    }
  }
  // Check for prefix/postfix increment/decrement: state.x++, ++state.x
  if (
    (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
    isStatePropertyAccess(node.operand, stateName)
  ) {
    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'state-mutation',
      message: 'Increment/decrement on state in update(). State is immutable.',
      file: filename,
      line,
      column,
    })
  }
  // Check for mutating method calls: state.items.push(...)
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const methodName = node.expression.name.text
    if (
      ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill'].includes(methodName)
    ) {
      if (isStatePropertyAccess(node.expression.expression, stateName)) {
        const { line, column } = pos(node, sf)
        violations.push({
          rule: 'state-mutation',
          message: `Mutating method .${methodName}() called on state property in update(). Use immutable alternatives.`,
          file: filename,
          line,
          column,
          suggestion:
            methodName === 'push'
              ? 'Use [...array, newItem]'
              : `Use immutable alternative to .${methodName}()`,
        })
      }
    }
  }
  ts.forEachChild(node, (child) => checkMutationsInBody(child, stateName, sf, filename, violations))
}

// ── Rule 2: missing-memo ────────────────────────────────────────────

function checkMissingMemo(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void {
  // Collect arrow functions used as arguments in binding positions (text(), prop values)
  // Group by printed source text. Flag groups with count >= 2 not wrapped in memo().
  const arrowsByText = new Map<string, { node: ts.ArrowFunction; inMemo: boolean }[]>()

  function isInMemoCall(node: ts.Node): boolean {
    const parent = node.parent
    if (
      parent &&
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === 'memo'
    ) {
      return true
    }
    return false
  }

  function visit(node: ts.Node): void {
    if (ts.isArrowFunction(node) && isInsideViewFunction(node)) {
      // Check if this arrow is in a binding position:
      // - first arg to text()
      // - prop value in element helper call
      const parent = node.parent
      const isBinding =
        (parent &&
          ts.isCallExpression(parent) &&
          ts.isIdentifier(parent.expression) &&
          parent.expression.text === 'text' &&
          parent.arguments[0] === node) ||
        (parent && ts.isPropertyAssignment(parent))

      if (isBinding) {
        const sourceText = node.getText(sf).replace(/\s+/g, ' ').trim()
        const inMemo = isInMemoCall(node)
        const entries = arrowsByText.get(sourceText) ?? []
        entries.push({ node, inMemo })
        arrowsByText.set(sourceText, entries)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)

  for (const [_sourceText, entries] of arrowsByText) {
    if (entries.length < 2) continue
    const unmemoized = entries.filter((e) => !e.inMemo)
    if (unmemoized.length < 2) continue
    // Report on all but the first occurrence
    for (let i = 1; i < unmemoized.length; i++) {
      const entry = unmemoized[i]!
      const { line, column } = pos(entry.node, sf)
      violations.push({
        rule: 'missing-memo',
        message:
          'Duplicate accessor arrow function used in multiple binding sites without memo(). Wrap in memo() to share computation.',
        file: filename,
        line,
        column,
        suggestion: 'Wrap the accessor in memo() and reuse the reference.',
      })
    }
  }
}

// ── Rule 3: each-closure-violation ──────────────────────────────────

function checkEachClosureViolation(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    // Look for each() calls
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'each'
    ) {
      // each() typically takes an object with a render callback
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'render'
          ) {
            const renderFn = prop.initializer
            if (ts.isArrowFunction(renderFn) || ts.isFunctionExpression(renderFn)) {
              checkClosureCaptures(renderFn, sf, filename, violations)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function checkClosureCaptures(
  renderFn: ts.ArrowFunction | ts.FunctionExpression,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Collect parameter names of the render callback
  const paramNames = new Set<string>()
  for (const param of renderFn.parameters) {
    if (ts.isIdentifier(param.name)) {
      paramNames.add(param.name.text)
    }
  }

  // Collect locally declared names inside the render body
  const localNames = new Set<string>()
  function collectLocals(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      localNames.add(node.name.text)
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      localNames.add(node.name.text)
    }
    ts.forEachChild(node, collectLocals)
  }
  if (renderFn.body) {
    collectLocals(renderFn.body)
  }

  // Known safe globals/imports that should not be flagged
  const safeNames = new Set([
    'send',
    'console',
    'Math',
    'JSON',
    'String',
    'Number',
    'Boolean',
    'Array',
    'Object',
    'Date',
    'Promise',
    'undefined',
    'null',
    'true',
    'false',
    'div',
    'span',
    'p',
    'text',
    'button',
    'input',
    'each',
    'memo',
    'show',
    'branch',
    'child',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'form',
    'label',
    'select',
    'textarea',
    'table',
    'tr',
    'td',
    'th',
    'header',
    'footer',
    'nav',
    'main',
    'section',
    'article',
  ])

  // Find identifiers in binding positions that reference parent scope
  function checkBindings(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const name = node.text
      // Skip if it's a parameter, local, or safe name
      if (paramNames.has(name) || localNames.has(name) || safeNames.has(name)) return
      // Skip if it's a property name in a property access (rhs of dot)
      if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        return
      // Skip if it's a property name in a property assignment
      if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node) return
      // Skip type references
      if (node.parent && ts.isTypeReferenceNode(node.parent)) return

      // Check if this identifier is used in a binding context (arrow fn arg to text(), prop value)
      if (isInBindingContext(node)) {
        const { line, column } = pos(node, sf)
        violations.push({
          rule: 'each-closure-violation',
          message: `Identifier '${name}' captured from parent scope inside each() render callback. Use the item accessor instead.`,
          file: filename,
          line,
          column,
          suggestion: 'Access data through the item/index parameters provided by each().',
        })
      }
    }
    ts.forEachChild(node, checkBindings)
  }

  if (renderFn.body) {
    checkBindings(renderFn.body)
  }
}

function isInBindingContext(node: ts.Node): boolean {
  // Walk up to find if we're inside an arrow function used as a binding
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isArrowFunction(current)) {
      const parent: ts.Node | undefined = current.parent
      // First arg to text()
      if (
        parent &&
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'text' &&
        parent.arguments[0] === current
      ) {
        return true
      }
      // Prop value in object literal
      if (parent && ts.isPropertyAssignment(parent)) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

// ── Rule 4: map-on-state-array ──────────────────────────────────────

function checkMapOnStateArrays(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit)
      return
    }
    if (!ts.isPropertyAccessExpression(node.expression)) {
      ts.forEachChild(node, visit)
      return
    }
    if (node.expression.name.text !== 'map') {
      ts.forEachChild(node, visit)
      return
    }

    if (!referencesStateParam(node.expression.expression)) {
      ts.forEachChild(node, visit)
      return
    }

    if (!isInsideViewFunction(node)) {
      ts.forEachChild(node, visit)
      return
    }

    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'map-on-state-array',
      message: 'Array .map() on state-derived value in view(). Use each() for reactive lists.',
      file: filename,
      line,
      column,
      suggestion: 'Replace .map() with each({ source: ..., key: ..., render: ... }).',
    })

    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── Rule 5: unnecessary-child ───────────────────────────────────────

function checkUnnecessaryChild(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Collect component definitions: look for component() calls and count state access paths
  const componentInfo = new Map<
    string,
    { stateAccessCount: number; hasReceives: boolean; node: ts.Node }
  >()

  function collectComponents(node: ts.Node): void {
    // Look for: const X = component({ ... })
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'component'
    ) {
      const arg = node.initializer.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        let hasReceives = false
        let stateAccessCount = 0

        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            if (prop.name.text === 'receives') {
              hasReceives = true
            }
            if (prop.name.text === 'view' || prop.name.text === 'update') {
              // Count unique state property accesses
              const accesses = new Set<string>()
              countStateAccesses(prop.initializer, accesses)
              stateAccessCount += accesses.size
            }
          }
        }

        componentInfo.set(node.name.text, {
          stateAccessCount,
          hasReceives,
          node: node.initializer,
        })
      }
    }
    ts.forEachChild(node, collectComponents)
  }

  collectComponents(sf)

  // Now find child() calls that reference these components
  function findChildCalls(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'child'
    ) {
      // child() first arg is typically { component: X, ... }
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'component'
          ) {
            if (ts.isIdentifier(prop.initializer)) {
              const compName = prop.initializer.text
              const info = componentInfo.get(compName)
              if (info && info.stateAccessCount < 10 && !info.hasReceives) {
                const { line, column } = pos(node, sf)
                violations.push({
                  rule: 'unnecessary-child',
                  message: `child() used for component '${compName}' which has fewer than 10 state access paths and no receives. Consider using a view function (Level 1 composition) instead.`,
                  file: filename,
                  line,
                  column,
                  suggestion: 'Use Level 1 composition (view function) for simple components.',
                })
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, findChildCalls)
  }

  findChildCalls(sf)
}

function countStateAccesses(node: ts.Node, accesses: Set<string>): void {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text
    if (name === 'state' || name === 's' || name === '_state') {
      accesses.add(node.name.text)
    }
  }
  ts.forEachChild(node, (child) => countStateAccesses(child, accesses))
}

// ── Rule 6: form-boilerplate ────────────────────────────────────────

function checkFormBoilerplate(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Find Msg type alias declarations that are union types
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== 'Msg') continue

    const variants = collectMsgVariantShapes(stmt.type)
    if (variants.length < 3) continue

    // Group variants by their "shape" — same fields except the type literal value
    // A variant shape is: sorted field names + field types (excluding the 'type' field value)
    const shapeGroups = new Map<string, string[]>()

    for (const variant of variants) {
      const shape = variant.shape
      const group = shapeGroups.get(shape) ?? []
      group.push(variant.typeName)
      shapeGroups.set(shape, group)
    }

    for (const [_shape, group] of shapeGroups) {
      if (group.length >= 3) {
        const { line, column } = pos(stmt, sf)
        violations.push({
          rule: 'form-boilerplate',
          message: `Msg type has ${group.length} variants with identical shapes (${group
            .slice(0, 3)
            .map((g) => `'${g}'`)
            .join(
              ', ',
            )}${group.length > 3 ? ', ...' : ''}). Consider using a generic field-update message pattern.`,
          file: filename,
          line,
          column,
          suggestion:
            "Use a single { type: 'setField'; field: string; value: string } variant instead.",
        })
      }
    }
  }
}

interface MsgVariantShape {
  typeName: string
  shape: string
}

// ── Rule 7: async-update ───────────────────────────────────────────

function checkAsyncUpdate(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'update'
    ) {
      const fn = node.initializer
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        // Check for async modifier
        const mods = ts.getModifiers(fn)
        if (mods?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          const { line, column } = pos(fn, sf)
          violations.push({
            rule: 'async-update',
            message:
              'update() must be synchronous and pure. Move async operations to effects.',
            file: filename,
            line,
            column,
          })
        }
        // Check for await keyword inside body
        if (fn.body) {
          checkForAwait(fn.body, sf, filename, violations)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function checkForAwait(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Don't descend into nested functions — only check the update body itself
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    return
  }
  if (ts.isAwaitExpression(node)) {
    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'async-update',
      message:
        'update() must be synchronous and pure. Move async operations to effects.',
      file: filename,
      line,
      column,
    })
    return
  }
  ts.forEachChild(node, (child) => checkForAwait(child, sf, filename, violations))
}

// ── Rule 8: direct-state-in-view ───────────────────────────────────

function checkDirectStateInView(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'view'
    ) {
      const fn = node.initializer
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        // Look for state.X references inside event handler closures within view
        if (fn.body) {
          findStateInEventHandlers(fn.body, sf, filename, violations)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function findStateInEventHandlers(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Look for event handler properties: onClick, onInput, onChange, onSubmit, etc.
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
    const propName = node.name.text
    if (/^on[A-Z]/.test(propName)) {
      const handler = node.initializer
      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        if (handler.body) {
          findStateAccess(handler.body, sf, filename, violations)
        }
        return // don't recurse further into the handler
      }
    }
  }
  ts.forEachChild(node, (child) =>
    findStateInEventHandlers(child, sf, filename, violations),
  )
}

function findStateAccess(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Don't descend into nested arrow functions that are accessors (s => s.x)
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'state'
  ) {
    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'direct-state-in-view',
      message:
        'Possible stale state capture in event handler. Use an accessor (s => s.field) for reactive reads, or item.field() for imperative reads inside each().',
      file: filename,
      line,
      column,
    })
    return
  }
  ts.forEachChild(node, (child) => findStateAccess(child, sf, filename, violations))
}

// ── Rule 9: exhaustive-effect-handling ─────────────────────────────

function checkExhaustiveEffectHandling(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    // Look for .else(<empty fn>) calls
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'else'
    ) {
      const arg = node.arguments[0]
      if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
        if (isEmptyFunctionBody(arg)) {
          const { line, column } = pos(node, sf)
          violations.push({
            rule: 'exhaustive-effect-handling',
            message:
              'Empty .else() handler silently drops unhandled effects. Add a console.warn for unrecognized effect types, or handle them explicitly.',
            file: filename,
            line,
            column,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function isEmptyFunctionBody(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  if (!fn.body) return true
  // Arrow with block body: () => {}
  if (ts.isBlock(fn.body)) {
    return fn.body.statements.length === 0
  }
  // Arrow with expression body is never "empty" — e.g. () => undefined is intentional
  return false
}

// ── Rule 10: effect-without-handler ───────────────────────────────

function checkEffectWithoutHandler(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component'
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        let hasOnEffect = false
        let hasEffectsInUpdate = false
        let updateNode: ts.Node | undefined

        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
          if (prop.name.text === 'onEffect') {
            hasOnEffect = true
          }
          if (prop.name.text === 'update') {
            updateNode = prop
            const fn = prop.initializer
            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
              if (fn.body) {
                hasEffectsInUpdate = bodyReturnsEffects(fn.body)
              }
            }
          }
        }

        if (hasEffectsInUpdate && !hasOnEffect && updateNode) {
          const { line, column } = pos(updateNode, sf)
          violations.push({
            rule: 'effect-without-handler',
            message:
              'Component returns effects from update() but has no onEffect handler. Effects will be silently dropped (only built-in delay/log are handled automatically).',
            file: filename,
            line,
            column,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function bodyReturnsEffects(node: ts.Node): boolean {
  // Look for array literals in return position with non-empty second element
  // Pattern: return [state, [{ type: ... }]] or [state, [effect]]
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
    const second = node.elements[1]
    if (
      second &&
      ts.isArrayLiteralExpression(second) &&
      second.elements.length > 0
    ) {
      return true
    }
  }
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found) found = bodyReturnsEffects(child)
  })
  return found
}

// ── Rule 11: forgotten-spread ─────────────────────────────────────

function checkForgottenSpread(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  const structuralNames = new Set(['show', 'branch', 'each'])

  function visit(node: ts.Node): void {
    // Look for array literals containing calls to show/branch/each without spread
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (
          ts.isCallExpression(element) &&
          ts.isIdentifier(element.expression) &&
          structuralNames.has(element.expression.text)
        ) {
          const { line, column } = pos(element, sf)
          violations.push({
            rule: 'forgotten-spread',
            message: `${element.expression.text}() returns Node[] — spread it: [...${element.expression.text}({...})]. Without spread, the array is nested and won't render correctly.`,
            file: filename,
            line,
            column,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── Rule 12: string-effect-callback ───────────────────────────────

function checkStringEffectCallback(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  const callbackProps = new Set(['onSuccess', 'onError', 'onLoad', 'onChange', 'onMessage'])

  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (callbackProps.has(node.name.text) && ts.isStringLiteral(node.initializer)) {
        const { line, column } = pos(node, sf)
        violations.push({
          rule: 'string-effect-callback',
          message: `String-based effect callback '${node.name.text}' is deprecated. Use a typed message constructor: ${node.name.text}: (data) => ({ type: '${node.initializer.text}', payload: data }).`,
          file: filename,
          line,
          column,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── Rule 13: nested-send-in-update ────────────────────────────────

function checkNestedSendInUpdate(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'update'
    ) {
      // Check that this property is inside a component() call
      if (isInsideComponentCall(node)) {
        const fn = node.initializer
        if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
          if (fn.body) {
            findSendCalls(fn.body, sf, filename, violations)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function isInsideComponentCall(node: ts.Node): boolean {
  let current = node.parent
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'component'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function findSendCalls(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Don't descend into nested functions
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    return
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'send'
  ) {
    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'nested-send-in-update',
      message:
        'Calling send() inside update() causes recursive dispatch. Return effects instead: return [newState, [myEffect]].',
      file: filename,
      line,
      column,
    })
  }
  ts.forEachChild(node, (child) => findSendCalls(child, sf, filename, violations))
}

// ── Rule 14: imperative-dom-in-view ───────────────────────────────

function checkImperativeDomInView(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  const imperativeMethods = new Set([
    'querySelector',
    'querySelectorAll',
    'getElementById',
    'getElementsByClassName',
    'getElementsByTagName',
  ])

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'view'
    ) {
      const fn = node.initializer
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        if (fn.body) {
          findImperativeDom(fn.body, sf, filename, violations, imperativeMethods)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function isInsideOnMountCall(node: ts.Node): boolean {
  let current = node.parent
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'onMount'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function findImperativeDom(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
  imperativeMethods: Set<string>,
): void {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'document' &&
    imperativeMethods.has(node.name.text)
  ) {
    if (!isInsideOnMountCall(node)) {
      const { line, column } = pos(node, sf)
      violations.push({
        rule: 'imperative-dom-in-view',
        message:
          "Imperative DOM access in view() won't be reactive. Use LLui primitives (text, show, branch, each) for reactive rendering. Use onMount() for imperative DOM that runs once.",
        file: filename,
        line,
        column,
      })
    }
  }
  ts.forEachChild(node, (child) =>
    findImperativeDom(child, sf, filename, violations, imperativeMethods),
  )
}

// ── Rule 15: accessor-side-effect ─────────────────────────────────

function checkAccessorSideEffect(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  const sideEffectNames = new Set(['fetch', 'alert'])
  const consoleMethods = new Set(['log', 'warn', 'error'])

  function visit(node: ts.Node): void {
    if (!isInsideViewFunction(node)) {
      ts.forEachChild(node, visit)
      return
    }

    // Find arrow functions that are accessors:
    // 1. First arg to text()
    // 2. Prop values in element helpers (e.g. class: s => ...)
    if (ts.isArrowFunction(node)) {
      const isAccessor = isAccessorArrow(node)
      if (isAccessor && node.body) {
        findSideEffectsInAccessor(node.body, sf, filename, violations, sideEffectNames, consoleMethods)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function isAccessorArrow(node: ts.ArrowFunction): boolean {
  const parent = node.parent
  // First arg to text()
  if (
    parent &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'text' &&
    parent.arguments[0] === node
  ) {
    return true
  }
  // Prop value in a property assignment (e.g. class: s => ...)
  if (parent && ts.isPropertyAssignment(parent)) {
    return true
  }
  return false
}

function findSideEffectsInAccessor(
  node: ts.Node,
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
  sideEffectNames: Set<string>,
  consoleMethods: Set<string>,
): void {
  if (ts.isCallExpression(node)) {
    // Check for console.log/warn/error
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console' &&
      consoleMethods.has(node.expression.name.text)
    ) {
      const { line, column } = pos(node, sf)
      violations.push({
        rule: 'accessor-side-effect',
        message:
          'Side effect in accessor function. Accessors run on every state change — move side effects to update() or onEffect.',
        file: filename,
        line,
        column,
      })
      return
    }
    // Check for fetch, alert
    if (
      ts.isIdentifier(node.expression) &&
      sideEffectNames.has(node.expression.text)
    ) {
      const { line, column } = pos(node, sf)
      violations.push({
        rule: 'accessor-side-effect',
        message:
          'Side effect in accessor function. Accessors run on every state change — move side effects to update() or onEffect.',
        file: filename,
        line,
        column,
      })
      return
    }
  }
  ts.forEachChild(node, (child) =>
    findSideEffectsInAccessor(child, sf, filename, violations, sideEffectNames, consoleMethods),
  )
}

function collectMsgVariantShapes(type: ts.TypeNode): MsgVariantShape[] {
  const variants: MsgVariantShape[] = []

  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      variants.push(...collectMsgVariantShapes(member))
    }
    return variants
  }

  if (ts.isTypeLiteralNode(type)) {
    let typeName = ''
    const fields: string[] = []

    for (const member of type.members) {
      if (!ts.isPropertySignature(member)) continue
      if (!member.name || !ts.isIdentifier(member.name)) continue

      const fieldName = member.name.text
      const fieldType = member.type ? member.type.getText() : 'unknown'

      if (fieldName === 'type') {
        // Extract the literal value as the variant name
        if (
          member.type &&
          ts.isLiteralTypeNode(member.type) &&
          ts.isStringLiteral(member.type.literal)
        ) {
          typeName = member.type.literal.text
        }
      } else {
        fields.push(`${fieldName}:${fieldType}`)
      }
    }

    if (typeName && fields.length > 0) {
      fields.sort()
      variants.push({ typeName, shape: fields.join(',') })
    }
  }

  return variants
}
