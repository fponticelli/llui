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
  /** Score from 0 to 6. Starts at 6, -1 per violated rule category. */
  score: number
}

/**
 * Lint a single source file for LLui idiomatic anti-patterns.
 * Returns violations and a numeric score (6 = perfect).
 */
export function lintIdiomatic(
  source: string,
  filename = 'input.ts',
): LintResult {
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const violations: LintViolation[] = []

  checkStateMutation(sf, filename, violations)
  checkMissingMemo(sf, filename, violations)
  checkEachClosureViolation(sf, filename, violations)
  checkMapOnStateArrays(sf, filename, violations)
  checkUnnecessaryChild(sf, filename, violations)
  checkFormBoilerplate(sf, filename, violations)

  // Score: unique violated rule categories
  const violatedRules = new Set(violations.map((v) => v.rule))
  const score = Math.max(0, 6 - violatedRules.size)

  return { violations, score }
}

// ── Helpers ─────────────────────────────────────────────────────────

function pos(
  node: ts.Node,
  sf: ts.SourceFile,
): { line: number; column: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  )
  return { line: line + 1, column: character + 1 }
}

function isStatePropertyAccess(node: ts.Node, stateName: string): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === stateName)
      return true
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
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
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
        message:
          'Compound assignment on state in update(). State is immutable.',
        file: filename,
        line,
        column,
      })
    }
  }
  // Check for prefix/postfix increment/decrement: state.x++, ++state.x
  if (
    (ts.isPostfixUnaryExpression(node) ||
      ts.isPrefixUnaryExpression(node)) &&
    isStatePropertyAccess(node.operand, stateName)
  ) {
    const { line, column } = pos(node, sf)
    violations.push({
      rule: 'state-mutation',
      message:
        'Increment/decrement on state in update(). State is immutable.',
      file: filename,
      line,
      column,
    })
  }
  // Check for mutating method calls: state.items.push(...)
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    const methodName = node.expression.name.text
    if (
      [
        'push',
        'pop',
        'shift',
        'unshift',
        'splice',
        'sort',
        'reverse',
        'fill',
      ].includes(methodName)
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
  ts.forEachChild(node, (child) =>
    checkMutationsInBody(child, stateName, sf, filename, violations),
  )
}

// ── Rule 2: missing-memo ────────────────────────────────────────────

function checkMissingMemo(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Collect arrow functions used as arguments in binding positions (text(), prop values)
  // Group by printed source text. Flag groups with count >= 2 not wrapped in memo().
  const arrowsByText = new Map<
    string,
    { node: ts.ArrowFunction; inMemo: boolean }[]
  >()

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
            if (
              ts.isArrowFunction(renderFn) ||
              ts.isFunctionExpression(renderFn)
            ) {
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
      if (paramNames.has(name) || localNames.has(name) || safeNames.has(name))
        return
      // Skip if it's a property name in a property access (rhs of dot)
      if (
        node.parent &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      )
        return
      // Skip if it's a property name in a property assignment
      if (
        node.parent &&
        ts.isPropertyAssignment(node.parent) &&
        node.parent.name === node
      )
        return
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
          suggestion:
            'Access data through the item/index parameters provided by each().',
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
      message:
        'Array .map() on state-derived value in view(). Use each() for reactive lists.',
      file: filename,
      line,
      column,
      suggestion:
        'Replace .map() with each({ source: ..., key: ..., render: ... }).',
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
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name)
          ) {
            if (prop.name.text === 'receives') {
              hasReceives = true
            }
            if (
              prop.name.text === 'view' ||
              prop.name.text === 'update'
            ) {
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
                  suggestion:
                    'Use Level 1 composition (view function) for simple components.',
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
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression)
  ) {
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
          message: `Msg type has ${group.length} variants with identical shapes (${group.slice(0, 3).map((g) => `'${g}'`).join(', ')}${group.length > 3 ? ', ...' : ''}). Consider using a generic field-update message pattern.`,
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
