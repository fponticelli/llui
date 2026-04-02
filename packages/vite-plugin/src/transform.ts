import ts from 'typescript'
import { collectDeps } from './collect-deps.js'
import { extractMsgSchema } from './msg-schema.js'

function createMaskLiteral(f: ts.NodeFactory, mask: number): ts.Expression {
  if (mask >= 0) return f.createNumericLiteral(mask)
  // -1 (0xFFFFFFFF | 0) — emit as bitwise OR: 0xFFFFFFFF | 0
  return f.createBinaryExpression(
    f.createNumericLiteral(0xffffffff),
    ts.SyntaxKind.BarToken,
    f.createNumericLiteral(0),
  )
}

// HTML element helper names that the compiler can transform
const ELEMENT_HELPERS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'button',
  'canvas', 'code', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'em',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'iframe',
  'img', 'input', 'label', 'legend', 'li', 'main', 'mark', 'nav', 'ol',
  'optgroup', 'option', 'output', 'p', 'pre', 'progress',
  'section', 'select', 'small', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead',
  'time', 'tr', 'ul', 'video',
])

const PROP_KEYS = new Set([
  'value', 'checked', 'selected', 'disabled', 'readOnly', 'multiple',
  'indeterminate', 'defaultValue', 'defaultChecked', 'innerHTML', 'textContent',
])

type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style'

function classifyKind(key: string): BindingKind {
  if (key === 'class' || key === 'className') return 'class'
  if (key.startsWith('style.')) return 'style'
  if (PROP_KEYS.has(key)) return 'prop'
  return 'attr'
}

function resolveKey(key: string, kind: BindingKind): string {
  if (kind === 'class') return 'class'
  if (kind === 'style') return key.slice(6)
  if (kind === 'prop') return key
  if (key === 'className') return 'class'
  return key
}

/**
 * Transform a source file containing @llui/core imports.
 * Returns the transformed source or null if no transformation needed.
 */
export function transformLlui(source: string, _filename: string, devMode = false): string | null {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Find the @llui/core import
  const imp = findLluiImport(sourceFile)
  if (!imp) return null
  const lluiImport = imp

  // Collect imported element helper names (local → original)
  const importedHelpers = getImportedHelpers(lluiImport)
  if (importedHelpers.size === 0 && !hasReactiveAccessors(sourceFile)) return null

  // Pass 2 pre-scan: collect all state access paths
  const fieldBits = collectDeps(source)

  // Track which helpers were compiled vs bailed out
  const compiledHelpers = new Set<string>()
  const bailedHelpers = new Set<string>()

  // Apply transforms
  const f = ts.factory

  function visitor(node: ts.Node): ts.Node {
    // Pass 1: Transform element helper calls to elSplit
    if (ts.isCallExpression(node)) {
      const transformed = tryTransformElementCall(node, importedHelpers, fieldBits, compiledHelpers, bailedHelpers, f)
      if (transformed) {
        return ts.visitEachChild(transformed, visitor, undefined!)
      }

      // Pass 2: Inject mask into text() calls
      const textTransformed = tryInjectTextMask(node, lluiImport, fieldBits, f)
      if (textTransformed) {
        return textTransformed
      }
    }

    // Pass 2: Inject __dirty and __msgSchema into component() calls
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      let result = tryInjectDirty(node, fieldBits, f)
      if (devMode) {
        const schema = extractMsgSchema(source)
        if (schema) {
          result = injectMsgSchema(result ?? node, schema, f)
        }
      }
      if (result) {
        return ts.visitEachChild(result, visitor, undefined!)
      }
    }

    return ts.visitEachChild(node, visitor, undefined!)
  }

  let transformed = ts.visitNode(sourceFile, visitor) as ts.SourceFile

  // Pass 3: Clean up imports
  // Only remove helpers that were fully compiled (no bail-outs)
  const safeToRemove = new Set([...compiledHelpers].filter((h) => !bailedHelpers.has(h)))
  transformed = cleanupImports(transformed, lluiImport, importedHelpers, safeToRemove, f)

  // Print
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  let output = printer.printFile(transformed)

  // HMR: append self-accept code in dev mode
  if (devMode) {
    output += '\n' + generateHmrCode(_filename)
  }

  return output
}

// ── HMR ──────────────────────────────────────────────────────────

function generateHmrCode(_filename: string): string {
  return `
if (import.meta.hot) {
  import.meta.hot.accept()
}
`.trim()
}

// ── Helpers ──────────────────────────────────────────────────────

function findLluiImport(sf: ts.SourceFile): ts.ImportDeclaration | null {
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/core'
    ) {
      return stmt
    }
  }
  return null
}

function getImportedHelpers(imp: ts.ImportDeclaration): Map<string, string> {
  const map = new Map<string, string>()
  const clause = imp.importClause
  if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return map

  for (const spec of clause.namedBindings.elements) {
    const original = (spec.propertyName ?? spec.name).text
    const local = spec.name.text
    if (ELEMENT_HELPERS.has(original)) {
      map.set(local, original)
    }
  }
  return map
}

function hasReactiveAccessors(sf: ts.SourceFile): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'text' || node.expression.text === 'component') {
        found = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function isComponentCall(node: ts.CallExpression, lluiImport: ts.ImportDeclaration): boolean {
  if (!ts.isIdentifier(node.expression)) return false
  const name = node.expression.text
  if (name !== 'component') return false
  // Verify it's from the llui import
  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false
  return clause.namedBindings.elements.some(
    (s) => s.name.text === 'component' || (s.propertyName && s.propertyName.text === 'component'),
  )
}

function emitStaticProp(
  staticProps: ts.Statement[],
  f: ts.NodeFactory,
  kind: BindingKind,
  resolvedKey: string,
  value: ts.Expression,
): void {
  switch (kind) {
    case 'class':
      staticProps.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), 'className'),
            ts.SyntaxKind.EqualsToken,
            value,
          ),
        ),
      )
      break
    case 'prop':
      staticProps.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), resolvedKey),
            ts.SyntaxKind.EqualsToken,
            value,
          ),
        ),
      )
      break
    case 'style':
      staticProps.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(
              f.createPropertyAccessExpression(f.createIdentifier('__e'), 'style'),
              'setProperty',
            ),
            undefined,
            [f.createStringLiteral(resolvedKey), value],
          ),
        ),
      )
      break
    default: // attr
      staticProps.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier('__e'), 'setAttribute'),
            undefined,
            [f.createStringLiteral(resolvedKey), value],
          ),
        ),
      )
  }
}

// ── Pass 1: Element → elSplit ────────────────────────────────────

function tryTransformElementCall(
  node: ts.CallExpression,
  helpers: Map<string, string>,
  fieldBits: Map<string, number>,
  compiled: Set<string>,
  bailed: Set<string>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  if (!ts.isIdentifier(node.expression)) return null
  const localName = node.expression.text
  const originalName = helpers.get(localName)
  if (!originalName) return null

  // First arg must be an object literal (or absent)
  const propsArg = node.arguments[0]
  if (propsArg && !ts.isObjectLiteralExpression(propsArg)) {
    bailed.add(localName)
    return null
  }

  const tag = f.createStringLiteral(originalName)

  // Classify props
  const staticProps: ts.Statement[] = []
  const events: ts.ArrayLiteralExpression[] = []
  const bindings: ts.ArrayLiteralExpression[] = []

  if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
    for (const prop of propsArg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue

      const key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text
      if (key === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(key)) {
        const eventName = key.slice(2).toLowerCase()
        events.push(
          f.createArrayLiteralExpression([
            f.createStringLiteral(eventName),
            prop.initializer,
          ]),
        )
        continue
      }

      // Reactive binding — value is an arrow function or function expression
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, readsState } = computeAccessorMask(prop.initializer, fieldBits)

        // Zero-mask constant folding: accessor doesn't read state → treat as static
        if (mask === 0 && !readsState) {
          emitStaticProp(staticProps, f, kind, resolvedKey, f.createCallExpression(prop.initializer, undefined, []))
          continue
        }

        bindings.push(
          f.createArrayLiteralExpression([
            createMaskLiteral(f, mask),
            f.createStringLiteral(kind),
            f.createStringLiteral(resolvedKey),
            prop.initializer,
          ]),
        )
        continue
      }

      // Call expression — check if it's a per-item accessor: item(t => t.field)
      if (ts.isCallExpression(prop.initializer)) {
        if (isPerItemCall(prop.initializer)) {
          // Emit as a binding with FULL_MASK — the accessor is the item() call itself
          const kind = classifyKind(key)
          const resolvedKey = resolveKey(key, kind)
          bindings.push(
            f.createArrayLiteralExpression([
              createMaskLiteral(f, 0xffffffff | 0),
              f.createStringLiteral(kind),
              f.createStringLiteral(resolvedKey),
              prop.initializer,
            ]),
          )
          continue
        }
        // Unknown call expression — bail out
        bailed.add(localName)
        return null
      }

      // Static prop
      const kind = classifyKind(key)
      const resolvedKey = resolveKey(key, kind)
      emitStaticProp(staticProps, f, kind, resolvedKey, prop.initializer)
    }
  }

  // Build elSplit args
  const staticFn =
    staticProps.length > 0
      ? f.createArrowFunction(
          undefined,
          undefined,
          [f.createParameterDeclaration(undefined, undefined, '__e')],
          undefined,
          f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          f.createBlock(staticProps, true),
        )
      : f.createNull()

  const eventsArr =
    events.length > 0 ? f.createArrayLiteralExpression(events) : f.createNull()

  const bindingsArr =
    bindings.length > 0 ? f.createArrayLiteralExpression(bindings) : f.createNull()

  const children = node.arguments[1] ?? f.createNull()

  compiled.add(localName)

  // Static subtree prerendering: if no events, no bindings, and children
  // are all static text, emit a <template> clone
  if (events.length === 0 && bindings.length === 0 && isStaticChildren(children)) {
    const html = buildStaticHTML(originalName, staticProps, children, f)
    if (html) {
      return emitTemplateClone(html, f) as ts.CallExpression
    }
  }

  const call = f.createCallExpression(f.createIdentifier('elSplit'), undefined, [
    tag,
    staticFn,
    eventsArr,
    bindingsArr,
    children,
  ])
  ts.addSyntheticLeadingComment(call, ts.SyntaxKind.MultiLineCommentTrivia, '@__PURE__', false)
  return call
}

// ── Pass 2: Mask injection ───────────────────────────────────────

function tryInjectTextMask(
  node: ts.CallExpression,
  lluiImport: ts.ImportDeclaration,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'text') return null
  // Verify text is from @llui/core
  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return null
  const hasText = clause.namedBindings.elements.some(
    (s) => s.name.text === 'text' || s.propertyName?.text === 'text',
  )
  if (!hasText) return null

  const firstArg = node.arguments[0]
  if (!firstArg) return null
  // Only inject mask for accessor functions, not static strings
  if (!ts.isArrowFunction(firstArg) && !ts.isFunctionExpression(firstArg)) return null
  // Don't inject if mask already provided
  if (node.arguments.length >= 2) return null

  const { mask } = computeAccessorMask(firstArg, fieldBits)

  return f.createCallExpression(node.expression, node.typeArguments, [
    firstArg,
    createMaskLiteral(f, mask === 0 ? 0xffffffff | 0 : mask),
  ])
}

function tryInjectDirty(
  node: ts.CallExpression,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  if (fieldBits.size === 0) return null
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return null

  // Check if __dirty already exists
  for (const prop of configArg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === '__dirty') {
      return null
    }
  }

  // Build __dirty: (o, n) => (Object.is(o.path, n.path) ? 0 : bit) | ...
  const comparisons: ts.Expression[] = []
  for (const [path, bit] of fieldBits) {
    const parts = path.split('.')
    const oAccess = buildAccess(f, 'o', parts)
    const nAccess = buildAccess(f, 'n', parts)

    comparisons.push(
      f.createParenthesizedExpression(
        f.createConditionalExpression(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier('Object'), 'is'),
            undefined,
            [oAccess, nAccess],
          ),
          f.createToken(ts.SyntaxKind.QuestionToken),
          f.createNumericLiteral(0),
          f.createToken(ts.SyntaxKind.ColonToken),
          f.createNumericLiteral(bit),
        ),
      ),
    )
  }

  let dirtyBody: ts.Expression = comparisons[0]!
  for (let i = 1; i < comparisons.length; i++) {
    dirtyBody = f.createBinaryExpression(dirtyBody, ts.SyntaxKind.BarToken, comparisons[i]!)
  }

  const dirtyFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'o'),
      f.createParameterDeclaration(undefined, undefined, 'n'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    dirtyBody,
  )

  const dirtyProp = f.createPropertyAssignment('__dirty', dirtyFn)

  const newConfig = f.createObjectLiteralExpression(
    [...configArg.properties, dirtyProp],
    true,
  )

  return f.createCallExpression(node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

function buildAccess(f: ts.NodeFactory, root: string, parts: string[]): ts.Expression {
  let expr: ts.Expression = f.createIdentifier(root)
  for (const part of parts) {
    // Use optional chaining for nested paths
    if (parts.length > 1) {
      expr = f.createPropertyAccessChain(
        expr,
        f.createToken(ts.SyntaxKind.QuestionDotToken),
        part,
      )
    } else {
      expr = f.createPropertyAccessExpression(expr, part)
    }
  }
  return expr
}

// ── Pass 3: Import cleanup ───────────────────────────────────────

function cleanupImports(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
  _helpers: Map<string, string>,
  compiled: Set<string>,
  f: ts.NodeFactory,
): ts.SourceFile {
  if (compiled.size === 0) return sf

  const statements = sf.statements.map((stmt) => {
    if (stmt !== lluiImport) return stmt

    const clause = lluiImport.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return stmt

    const remaining = clause.namedBindings.elements.filter(
      (spec) => !compiled.has(spec.name.text),
    )

    // Add elSplit if not already imported
    const hasElSplit = clause.namedBindings.elements.some((s) => s.name.text === 'elSplit')
    if (!hasElSplit) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elSplit')))
    }

    const newBindings = f.createNamedImports(remaining)
    const newClause = f.createImportClause(false, undefined, newBindings)
    return f.createImportDeclaration(undefined, newClause, lluiImport.moduleSpecifier)
  })

  return f.updateSourceFile(sf, statements as unknown as ts.Statement[])
}

// ── __msgSchema injection ────────────────────────────────────────

function injectMsgSchema(
  node: ts.CallExpression,
  schema: { discriminant: string; variants: Record<string, Record<string, string | { enum: string[] }>> },
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return node

  // Don't inject if already present
  for (const prop of configArg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === '__msgSchema') {
      return node
    }
  }

  // Build the schema object literal
  const variantProps: ts.PropertyAssignment[] = []
  for (const [variant, fields] of Object.entries(schema.variants)) {
    const fieldProps: ts.PropertyAssignment[] = []
    for (const [field, type] of Object.entries(fields)) {
      if (typeof type === 'string') {
        fieldProps.push(f.createPropertyAssignment(field, f.createStringLiteral(type)))
      } else {
        fieldProps.push(
          f.createPropertyAssignment(
            field,
            f.createObjectLiteralExpression([
              f.createPropertyAssignment(
                'enum',
                f.createArrayLiteralExpression(type.enum.map((v) => f.createStringLiteral(v))),
              ),
            ]),
          ),
        )
      }
    }
    variantProps.push(
      f.createPropertyAssignment(
        f.createStringLiteral(variant),
        f.createObjectLiteralExpression(fieldProps),
      ),
    )
  }

  const schemaObj = f.createObjectLiteralExpression([
    f.createPropertyAssignment('discriminant', f.createStringLiteral(schema.discriminant)),
    f.createPropertyAssignment('variants', f.createObjectLiteralExpression(variantProps, true)),
  ], true)

  const schemaProp = f.createPropertyAssignment('__msgSchema', schemaObj)

  const newConfig = f.createObjectLiteralExpression(
    [...configArg.properties, schemaProp],
    true,
  )

  return f.createCallExpression(node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

// ── Per-item accessor detection ──────────────────────────────────

// ── Static subtree detection ─────────────────────────────────────

function isStaticChildren(children: ts.Expression): boolean {
  if (children.kind === ts.SyntaxKind.NullKeyword) return true
  if (!ts.isArrayLiteralExpression(children)) return false
  return children.elements.every((child) => {
    // text('literal') — static text
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'text') {
      return child.arguments.length === 1 && ts.isStringLiteral(child.arguments[0]!)
    }
    // Another elSplit or element helper that was already determined static
    // For now, only handle text() children
    return false
  })
}

function buildStaticHTML(
  tag: string,
  staticProps: ts.Statement[],
  children: ts.Expression,
  _f: ts.NodeFactory,
): string | null {
  // Extract static attributes from staticFn statements
  let attrs = ''
  for (const stmt of staticProps) {
    if (!ts.isExpressionStatement(stmt)) return null
    const expr = stmt.expression
    // __e.className = 'value'
    if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
      const prop = expr.left.name.text
      if (prop === 'className' && ts.isStringLiteral(expr.right)) {
        attrs += ` class="${escapeAttr(expr.right.text)}"`
      }
    }
    // __e.setAttribute('key', 'value')
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      if (expr.expression.name.text === 'setAttribute' && expr.arguments.length === 2) {
        const key = expr.arguments[0]
        const val = expr.arguments[1]
        if (key && val && ts.isStringLiteral(key) && ts.isStringLiteral(val)) {
          attrs += ` ${key.text}="${escapeAttr(val.text)}"`
        } else {
          return null // non-literal attribute
        }
      }
    }
  }

  // Extract text children
  let inner = ''
  if (ts.isArrayLiteralExpression(children)) {
    for (const child of children.elements) {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'text') {
        if (ts.isStringLiteral(child.arguments[0]!)) {
          inner += escapeHTML(child.arguments[0]!.text)
        } else {
          return null
        }
      } else {
        return null
      }
    }
  }

  return `<${tag}${attrs}>${inner}</${tag}>`
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

let templateCounter = 0

function emitTemplateClone(html: string, f: ts.NodeFactory): ts.Expression {
  const varName = `__tmpl${templateCounter++}`
  // Emit: (() => { const t = document.createElement('template'); t.innerHTML = 'html'; return t.content.cloneNode(true).firstChild })()
  // Simplified: we use an IIFE that creates and caches a template
  // Actually, for simplicity, just emit the cloneNode inline
  const tmplCreate = f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier('document'), 'createElement'),
    undefined,
    [f.createStringLiteral('template')],
  )
  const iife = f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock([
          f.createVariableStatement(undefined, f.createVariableDeclarationList([
            f.createVariableDeclaration(varName, undefined, undefined, tmplCreate),
          ], ts.NodeFlags.Const)),
          f.createExpressionStatement(
            f.createBinaryExpression(
              f.createPropertyAccessExpression(f.createIdentifier(varName), 'innerHTML'),
              ts.SyntaxKind.EqualsToken,
              f.createStringLiteral(html),
            ),
          ),
          f.createReturnStatement(
            f.createPropertyAccessExpression(
              f.createCallExpression(
                f.createPropertyAccessExpression(
                  f.createPropertyAccessExpression(f.createIdentifier(varName), 'content'),
                  'cloneNode',
                ),
                undefined,
                [f.createTrue()],
              ),
              'firstChild',
            ),
          ),
        ], true),
      ),
    ),
    undefined,
    [],
  )

  return iife
}

function isPerItemCall(node: ts.CallExpression): boolean {
  // Matches: item(t => t.field) or item(t => expr)
  // where item is an identifier (the scoped accessor from each() render)
  if (!ts.isIdentifier(node.expression)) return false
  // Check that the first argument is an arrow function (the selector)
  if (node.arguments.length !== 1) return false
  const arg = node.arguments[0]!
  return ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
}

// ── Mask computation ─────────────────────────────────────────────

// Returns { mask, readsState }
// mask = 0 + readsState = false → constant (can fold to static)
// mask = 0 + readsState = true → unresolvable state access (FULL_MASK)
// mask > 0 → precise mask
function computeAccessorMask(
  accessor: ts.ArrowFunction | ts.FunctionExpression,
  fieldBits: Map<string, number>,
): { mask: number; readsState: boolean } {
  if (accessor.parameters.length === 0) return { mask: 0xffffffff | 0, readsState: false }

  const paramName = accessor.parameters[0]!.name
  if (!ts.isIdentifier(paramName)) return { mask: 0xffffffff | 0, readsState: false }

  const stateParam = paramName.text
  let mask = 0
  let readsState = false

  function walk(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === stateParam && !ts.isParameter(node.parent)) {
      readsState = true
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (!ts.isPropertyAccessExpression(node.parent)) {
        const chain = resolveChain(node, stateParam)
        if (chain) {
          const bit = fieldBits.get(chain)
          if (bit !== undefined) {
            mask |= bit
          } else {
            for (const [path, b] of fieldBits) {
              if (path.startsWith(chain + '.') || path === chain) {
                mask |= b
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(accessor.body)

  if (mask === 0 && readsState) {
    return { mask: 0xffffffff | 0, readsState: true }
  }
  return { mask, readsState }
}

function resolveChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  if (!ts.isIdentifier(current) || current.text !== paramName) return null
  if (parts.length > 2) return parts.slice(0, 2).join('.')
  return parts.join('.')
}
