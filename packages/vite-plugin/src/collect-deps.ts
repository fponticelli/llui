import ts from 'typescript'

/**
 * Pre-scan a source file to collect all unique state access paths
 * referenced by reactive accessors (arrow functions in props and text() calls).
 * Returns a Map<path, bitPosition> where each path gets a unique power-of-two bit.
 */
export function collectDeps(source: string): Map<string, number> {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Check if file imports from @llui/core
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

  // Assign bit positions
  const fieldBits = new Map<string, number>()
  let bit = 1
  for (const path of paths) {
    fieldBits.set(path, bit)
    bit <<= 1
  }

  return fieldBits
}

function hasLluiImport(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/core'
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
    return true
  }

  // div({ title: s => s.title }) — value in a property assignment inside an object literal
  if (ts.isPropertyAssignment(parent)) {
    const key = parent.name
    if (ts.isIdentifier(key)) {
      // Skip event handlers (onClick, onInput, etc.)
      if (/^on[A-Z]/.test(key.text)) {
        return false
      }
      return true
    }
  }

  return false
}

/**
 * Extract state access paths from an expression body.
 * Handles:
 * - Direct property access: param.field, param.field.subfield
 * - Bracket notation with string literal: param['field']
 */
function extractPaths(
  node: ts.Node,
  paramName: string,
  _prefix: string,
  paths: Set<string>,
): void {
  if (ts.isPropertyAccessExpression(node)) {
    // Only record if this is a leaf — not the expression of another property access
    if (!ts.isPropertyAccessExpression(node.parent)) {
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
function resolveElementAccess(
  node: ts.ElementAccessExpression,
  paramName: string,
): string | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== paramName) {
    return null
  }

  if (ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text
  }

  return null
}
