import ts from 'typescript'

/**
 * Pre-scan a source file to collect all unique state access paths
 * referenced by reactive accessors (arrow functions in props and text() calls).
 * Returns a Map<path, bitPosition> where each path gets a unique power-of-two bit.
 */
export function collectDeps(source: string): Map<string, number> {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Check if file imports from @llui/dom
  if (!hasLluiImport(sourceFile)) {
    return new Map()
  }

  const paths = new Set<string>()

  // Walk the AST to find reactive accessors
  function visit(node: ts.Node): void {
    // Look for arrow functions that are reactive accessors:
    // - First arg to text(): text(s => s.count)
    // - Prop values in element helper calls: div({ title: s => s.title })
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const params = node.parameters
      if (params.length === 1) {
        const paramName = params[0]!.name
        if (ts.isIdentifier(paramName)) {
          // Check if this looks like a reactive accessor (not an event handler)
          if (isReactiveAccessor(node)) {
            extractPaths(node.body, paramName.text, '', paths)
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  // Assign bit positions. Single-mask tier holds 31 unique paths
  // (positions 0..30). When the count exceeds 31, all overflow paths
  // use FULL_MASK (-1) — they will always trigger a re-evaluation,
  // degrading gracefully. The diagnostic warns the user to decompose.
  const fieldBits = new Map<string, number>()
  let bit = 1
  let index = 0
  for (const path of paths) {
    if (index >= 31) {
      fieldBits.set(path, -1)
    } else {
      fieldBits.set(path, bit)
      bit <<= 1
    }
    index++
  }

  return fieldBits
}

function hasLluiImport(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom'
    ) {
      return true
    }
  }
  return false
}

/**
 * Determines if an arrow/function expression is a reactive accessor
 * (not an event handler, not a callback like onClick).
 */
function isReactiveAccessor(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = node.parent

  // text(s => s.count) — first arg to a call
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    // Skip item(t => t.id) — per-item selectors inside each() render
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'item') {
      return false
    }
    // Skip array method callbacks: .filter(t => ...), .map(t => ...), .some(t => ...), etc.
    if (ts.isPropertyAccessExpression(parent.expression)) {
      return false
    }
    return true
  }

  // div({ title: s => s.title }) — value in a property assignment inside an object literal.
  // Only treat as reactive if the containing call is a known framework API whose
  // properties are reactive accessors. Otherwise user-land helpers like
  // sliceHandler({ narrow: (m) => m.type === ... }) would pollute the path set.
  if (ts.isPropertyAssignment(parent)) {
    const key = parent.name
    if (ts.isIdentifier(key)) {
      // Skip event handlers (onClick, onInput, etc.)
      if (/^on[A-Z]/.test(key.text)) return false
      // Skip each() key function and other non-reactive props
      if (key.text === 'key' || key.text === 'name') return false
      // Walk up to find the enclosing call expression
      let ancestor: ts.Node | undefined = parent.parent // ObjectLiteralExpression
      while (ancestor && !ts.isCallExpression(ancestor)) {
        ancestor = ancestor.parent
      }
      if (!ancestor) return false
      const callExpr = ancestor as ts.CallExpression
      if (!ts.isIdentifier(callExpr.expression)) return false
      return REACTIVE_API_NAMES.has(callExpr.expression.text)
    }
  }

  return false
}

// Framework APIs whose object-literal arguments contain reactive accessors.
// Arrow functions in property values of these calls are state-tracked.
const REACTIVE_API_NAMES = new Set([
  // Element helpers (see ELEMENT_HELPERS in transform.ts — we keep a superset here)
  ...[
    'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'canvas',
    'code', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'em', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'hr', 'i', 'iframe', 'img', 'input', 'label', 'legend', 'li', 'main',
    'mark', 'nav', 'ol', 'optgroup', 'option', 'output', 'p', 'pre', 'progress',
    'section', 'select', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'ul', 'video',
  ],
  // Structural primitives
  'each', 'branch', 'show', 'memo', 'portal', 'foreign', 'child', 'errorBoundary',
])

/**
 * Extract state access paths from an expression body.
 * Handles:
 * - Direct property access: param.field, param.field.subfield
 * - Bracket notation with string literal: param['field']
 */
function extractPaths(node: ts.Node, paramName: string, _prefix: string, paths: Set<string>): void {
  if (ts.isPropertyAccessExpression(node)) {
    // Skip if this is an intermediate in a deeper chain
    if (ts.isPropertyAccessExpression(node.parent)) {
      // handled when the leaf is visited
    }
    // Skip if this is the callee of a method call: s.todos.filter(...)
    else if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
      // It's a method call — record the object, not the method
      // e.g. s.todos.filter(...) → record 'todos', not 'todos.filter'
      if (ts.isPropertyAccessExpression(node.expression)) {
        const chain = resolvePropertyChain(node.expression, paramName)
        if (chain) paths.add(chain)
      }
    } else {
      const chain = resolvePropertyChain(node, paramName)
      if (chain) {
        paths.add(chain)
      }
    }
  }

  if (ts.isElementAccessExpression(node)) {
    const chain = resolveElementAccess(node, paramName)
    if (chain) {
      paths.add(chain)
    }
  }

  ts.forEachChild(node, (child) => extractPaths(child, paramName, _prefix, paths))
}

/**
 * Resolve a property access chain like s.user.name to "user.name".
 * Returns null if the chain doesn't start with the state parameter.
 * Stops at depth 2.
 */
function resolvePropertyChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  // The root must be the state parameter
  if (!ts.isIdentifier(current) || current.text !== paramName) {
    return null
  }

  // Limit to depth 2
  if (parts.length > 2) {
    return parts.slice(0, 2).join('.')
  }

  return parts.join('.')
}

/**
 * Resolve bracket access with string literal: s['count'] → "count"
 */
function resolveElementAccess(node: ts.ElementAccessExpression, paramName: string): string | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== paramName) {
    return null
  }

  if (ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text
  }

  return null
}
