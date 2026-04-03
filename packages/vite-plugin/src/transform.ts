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
 * Transform a source file containing @llui/dom imports.
 * Returns the transformed source or null if no transformation needed.
 */
export function transformLlui(source: string, _filename: string, devMode = false): string | null {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Find the @llui/dom import
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
  let usesElTemplate = false
  let usesElSplit = false

  // Apply transforms
  const f = ts.factory

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

  function visitor(node: ts.Node): ts.Node {
    // Pass 0: Deduplicate item() selectors in each() render callbacks
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'each') {
      const rewritten = tryDeduplicateItemSelectors(node, f, printer, sourceFile)
      if (rewritten) {
        return ts.visitEachChild(rewritten, visitor, undefined!)
      }
    }

    // Pass 1: Transform element helper calls to elSplit or elTemplate
    if (ts.isCallExpression(node)) {
      const transformed = tryTransformElementCall(node, importedHelpers, fieldBits, compiledHelpers, bailedHelpers, f)
      if (transformed) {
        // Track which runtime helper was used
        if (ts.isIdentifier(transformed.expression)) {
          if (transformed.expression.text === 'elTemplate') usesElTemplate = true
          else if (transformed.expression.text === 'elSplit') usesElSplit = true
        }
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
  transformed = cleanupImports(transformed, lluiImport, importedHelpers, safeToRemove, usesElSplit, usesElTemplate, f)

  // Print
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
      stmt.moduleSpecifier.text === '@llui/dom'
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
      // Handle both PropertyAssignment (key: value) and ShorthandPropertyAssignment ({ id })
      let key: string
      let value: ts.Expression

      if (ts.isPropertyAssignment(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue
        key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text
        value = prop.initializer
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        key = prop.name.text
        value = prop.name // The identifier itself is the value
      } else {
        continue
      }
      if (key === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(key)) {
        const eventName = key.slice(2).toLowerCase()
        events.push(
          f.createArrayLiteralExpression([
            f.createStringLiteral(eventName),
            value,
          ]),
        )
        continue
      }

      // Reactive binding — value is an arrow function or function expression
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, readsState } = computeAccessorMask(value, fieldBits)

        // Zero-mask constant folding: accessor doesn't read state → treat as static
        if (mask === 0 && !readsState) {
          emitStaticProp(staticProps, f, kind, resolvedKey, f.createCallExpression(value, undefined, []))
          continue
        }

        bindings.push(
          f.createArrayLiteralExpression([
            createMaskLiteral(f, mask),
            f.createStringLiteral(kind),
            f.createStringLiteral(resolvedKey),
            value,
          ]),
        )
        continue
      }

      // Call expression — check if it's a per-item accessor: item(t => t.field)
      if (ts.isCallExpression(value)) {
        if (isPerItemCall(value)) {
          // Emit as a binding with FULL_MASK — the accessor is the item() call itself
          const kind = classifyKind(key)
          const resolvedKey = resolveKey(key, kind)
          bindings.push(
            f.createArrayLiteralExpression([
              createMaskLiteral(f, 0xffffffff | 0),
              f.createStringLiteral(kind),
              f.createStringLiteral(resolvedKey),
              value,
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
      emitStaticProp(staticProps, f, kind, resolvedKey, value)
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

  // Subtree collapse: if children contain nested element helpers,
  // collapse the entire tree into a single elTemplate() call
  const analyzed = analyzeSubtree(node, helpers, fieldBits, [])
  if (analyzed && hasNestedElements(analyzed)) {
    // Mark all descendant helpers as compiled for import cleanup
    collectUsedHelpers(analyzed, compiled)
    const templateCall = emitSubtreeTemplate(analyzed, fieldBits, f)
    return templateCall
  }

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
  // Verify text is from @llui/dom
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
  usesElSplit: boolean,
  usesElTemplate: boolean,
  f: ts.NodeFactory,
): ts.SourceFile {
  if (compiled.size === 0 && !usesElTemplate) return sf

  const statements = sf.statements.map((stmt) => {
    if (stmt !== lluiImport) return stmt

    const clause = lluiImport.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return stmt

    const remaining = clause.namedBindings.elements.filter(
      (spec) => !compiled.has(spec.name.text),
    )

    // Add elSplit if not already imported and it was used
    const hasElSplit = clause.namedBindings.elements.some((s) => s.name.text === 'elSplit')
    if (!hasElSplit && usesElSplit) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elSplit')))
    }

    // Add elTemplate if not already imported and subtree collapse was used
    const hasElTemplate = clause.namedBindings.elements.some((s) => s.name.text === 'elTemplate')
    if (!hasElTemplate && usesElTemplate) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elTemplate')))
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

// ── Item selector deduplication ──────────────────────────────────

/**
 * In each() render callbacks, deduplicate repeated item(selector) calls.
 *
 * Before: item((r) => r.id) appears 4 times → 4 selector closures + 4 accessor closures
 * After:  const __s0 = (r) => r.id; const __a0 = item(__s0); → 1 selector + 1 accessor
 */
function tryDeduplicateItemSelectors(
  eachCall: ts.CallExpression,
  f: ts.NodeFactory,
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
): ts.CallExpression | null {
  // each() takes a single object literal argument
  const arg = eachCall.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null

  // Find the render property
  let renderProp: ts.PropertyAssignment | null = null
  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'render') {
      renderProp = prop
      break
    }
  }
  if (!renderProp) return null

  const renderFn = renderProp.initializer
  if (!ts.isArrowFunction(renderFn) && !ts.isFunctionExpression(renderFn)) return null

  // Get the item parameter name from the options bag: ({ item, ... }) => ...
  const renderParam = renderFn.parameters[0]
  if (!renderParam) return null

  let itemName: string | null = null
  if (ts.isIdentifier(renderParam.name)) {
    // Old style: (item) => ... or (item, index) => ...
    itemName = renderParam.name.text
  } else if (ts.isObjectBindingPattern(renderParam.name)) {
    // New style: ({ item, send, ... }) => ...
    for (const el of renderParam.name.elements) {
      if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === 'item') {
        itemName = 'item'
        break
      }
    }
  }
  if (!itemName) return null

  // Collect all item(selector) calls with their selector source text
  const selectorCalls: Array<{ node: ts.CallExpression; selectorText: string; selector: ts.Expression }> = []

  function collectItemCalls(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === itemName &&
      node.arguments.length === 1
    ) {
      const sel = node.arguments[0]!
      if (ts.isArrowFunction(sel) || ts.isFunctionExpression(sel)) {
        const text = printer.printNode(ts.EmitHint.Expression, sel, sourceFile)
        selectorCalls.push({ node, selectorText: text, selector: sel })
      }
    }
    ts.forEachChild(node, collectItemCalls)
  }
  collectItemCalls(renderFn.body)

  if (selectorCalls.length < 2) return null // nothing to deduplicate

  // Group by selector text
  const groups = new Map<string, typeof selectorCalls>()
  for (const call of selectorCalls) {
    const existing = groups.get(call.selectorText)
    if (existing) existing.push(call)
    else groups.set(call.selectorText, [call])
  }

  // Only proceed if there are duplicates
  const duplicateGroups = [...groups.entries()].filter(([, calls]) => calls.length > 1)
  if (duplicateGroups.length === 0) return null

  // Build hoisted declarations and replacement map
  const hoistedStmts: ts.Statement[] = []
  const replacements = new Map<ts.CallExpression, ts.Identifier>()
  let sIdx = 0

  for (const [, calls] of duplicateGroups) {
    const selVar = `__s${sIdx}`
    const accVar = `__a${sIdx}`
    sIdx++

    // const __s0 = (r) => r.id
    hoistedStmts.push(
      f.createVariableStatement(undefined,
        f.createVariableDeclarationList([
          f.createVariableDeclaration(selVar, undefined, undefined, calls[0]!.selector),
        ], ts.NodeFlags.Const),
      ),
    )
    // const __a0 = item(__s0)
    hoistedStmts.push(
      f.createVariableStatement(undefined,
        f.createVariableDeclarationList([
          f.createVariableDeclaration(accVar, undefined, undefined,
            f.createCallExpression(f.createIdentifier(itemName), undefined, [f.createIdentifier(selVar)]),
          ),
        ], ts.NodeFlags.Const),
      ),
    )

    // Map all occurrences to the cached accessor identifier
    for (const call of calls) {
      replacements.set(call.node, f.createIdentifier(accVar))
    }
  }

  // Rewrite the render function body to replace item(sel) calls with cached refs
  function replaceVisitor(node: ts.Node): ts.Node {
    if (ts.isCallExpression(node) && replacements.has(node)) {
      return replacements.get(node)!
    }
    return ts.visitEachChild(node, replaceVisitor, undefined!)
  }

  const newBody = ts.visitNode(renderFn.body, replaceVisitor)!

  // Prepend hoisted declarations to the body
  let finalBody: ts.ConciseBody
  if (ts.isBlock(newBody)) {
    finalBody = f.createBlock([...hoistedStmts, ...(newBody as ts.Block).statements], true)
  } else {
    // Arrow with expression body → convert to block with return
    finalBody = f.createBlock([
      ...hoistedStmts,
      f.createReturnStatement(newBody as ts.Expression),
    ], true)
  }

  // Build new render function
  const newRenderFn = ts.isArrowFunction(renderFn)
    ? f.createArrowFunction(
        renderFn.modifiers, renderFn.typeParameters, renderFn.parameters,
        renderFn.type, f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), finalBody,
      )
    : f.createFunctionExpression(
        renderFn.modifiers, renderFn.asteriskToken, renderFn.name,
        renderFn.typeParameters, renderFn.parameters, renderFn.type, finalBody as ts.Block,
      )

  // Rebuild the each() call with the new render property
  const newProps = arg.properties.map((prop) =>
    prop === renderProp ? f.createPropertyAssignment('render', newRenderFn) : prop,
  )
  const newArg = f.createObjectLiteralExpression(newProps, true)

  return f.createCallExpression(eachCall.expression, eachCall.typeArguments, [
    newArg, ...eachCall.arguments.slice(1),
  ])
}

// ── Subtree collapse: nested elements → elTemplate ──────────────

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

interface AnalyzedNode {
  tag: string
  localName: string
  /** Static HTML attributes (class, id, etc.) */
  staticAttrs: Array<[string, string]>
  /** Event handlers: [eventName, handlerExpression] */
  events: Array<[string, ts.Expression]>
  /** Reactive bindings: [mask, kind, key, accessor] */
  bindings: Array<[number, string, string, ts.Expression]>
  /** Children: analyzed elements, static text, or reactive text */
  children: AnalyzedChild[]
  /** Path from template root as childNodes indices */
  path: number[]
}

type AnalyzedChild =
  | { type: 'element'; node: AnalyzedNode }
  | { type: 'staticText'; value: string }
  | { type: 'reactiveText'; accessor: ts.Expression; mask: number; childIdx: number }

/**
 * Try to analyze an element call and all its descendants as a collapsible subtree.
 * Returns null if any part of the tree is not eligible for collapse.
 */
function analyzeSubtree(
  node: ts.CallExpression,
  helpers: Map<string, string>,
  fieldBits: Map<string, number>,
  path: number[],
): AnalyzedNode | null {
  if (!ts.isIdentifier(node.expression)) return null
  const localName = node.expression.text
  const tag = helpers.get(localName)
  if (!tag) return null

  const propsArg = node.arguments[0]
  if (propsArg && !ts.isObjectLiteralExpression(propsArg)) return null

  const staticAttrs: Array<[string, string]> = []
  const events: Array<[string, ts.Expression]> = []
  const bindings: Array<[number, string, string, ts.Expression]> = []

  if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
    for (const prop of propsArg.properties) {
      let key: string
      let value: ts.Expression

      if (ts.isPropertyAssignment(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) return null
        key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text
        value = prop.initializer
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        key = prop.name.text
        value = prop.name
      } else {
        return null
      }
      if (key === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(key)) {
        events.push([key.slice(2).toLowerCase(), value])
        continue
      }

      // Reactive binding
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, readsState } = computeAccessorMask(value, fieldBits)
        if (mask === 0 && !readsState) {
          // Constant fold — treat as static if we can extract a string
          const staticVal = tryExtractStaticString(value)
          if (staticVal !== null) {
            const attrKey = kind === 'class' ? 'class' : resolvedKey
            staticAttrs.push([attrKey, staticVal])
            continue
          }
        }
        bindings.push([mask === 0 && readsState ? 0xffffffff | 0 : mask, kind, resolvedKey, value])
        continue
      }

      // Per-item accessor call
      if (ts.isCallExpression(value) && isPerItemCall(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push([0xffffffff | 0, kind, resolvedKey, value])
        continue
      }

      // Static literal prop
      if (ts.isStringLiteral(value)) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, value.text])
        continue
      }
      if (ts.isNumericLiteral(value)) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, value.text])
        continue
      }
      if (value.kind === ts.SyntaxKind.TrueKeyword) {
        const kind = classifyKind(key)
        const attrKey = kind === 'class' ? 'class' : resolveKey(key, kind)
        staticAttrs.push([attrKey, ''])
        continue
      }

      // Non-literal prop — can't collapse
      return null
    }
  }

  // Analyze children
  const childrenArg = node.arguments[1]
  const children: AnalyzedChild[] = []

  if (childrenArg && ts.isArrayLiteralExpression(childrenArg)) {
    let childIdx = 0
    for (const child of childrenArg.elements) {
      // text('literal') — static text
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'text') {
        if (child.arguments.length >= 1 && ts.isStringLiteral(child.arguments[0]!)) {
          children.push({ type: 'staticText', value: child.arguments[0]!.text })
          childIdx++ // static text creates a text node in the template DOM
          continue
        }
        // Reactive text — accessor is first arg
        const accessor = child.arguments[0]!
        if (ts.isArrowFunction(accessor) || ts.isFunctionExpression(accessor)) {
          const { mask, readsState } = computeAccessorMask(accessor, fieldBits)
          children.push({
            type: 'reactiveText',
            accessor,
            mask: mask === 0 && readsState ? 0xffffffff | 0 : mask,
            childIdx,
          })
          childIdx++ // placeholder text node in template
          continue
        }
        // Per-item text: text(item(t => t.label))
        if (ts.isCallExpression(accessor) && isPerItemCall(accessor)) {
          children.push({
            type: 'reactiveText',
            accessor,
            mask: 0xffffffff | 0,
            childIdx,
          })
          childIdx++ // placeholder text node in template
          continue
        }
        return null // unsupported text() form
      }

      // Element helper call — recurse
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && helpers.has(child.expression.text)) {
        const childNode = analyzeSubtree(child, helpers, fieldBits, [...path, childIdx])
        if (!childNode) return null
        children.push({ type: 'element', node: childNode })
        childIdx++
        continue
      }

      // Anything else (each, branch, show, arbitrary expressions) — bail
      return null
    }

    // Bail if mixed static + reactive text in same parent — HTML parser
    // merges adjacent text nodes, making childIdx indices unreliable
    const hasStatic = children.some((c) => c.type === 'staticText')
    const hasReactive = children.some((c) => c.type === 'reactiveText')
    if (hasStatic && hasReactive) return null
  } else if (childrenArg && childrenArg.kind !== ts.SyntaxKind.NullKeyword) {
    // Non-array children (e.g., spread, variable) — bail
    return null
  }

  return { tag, localName, staticAttrs, events, bindings, children, path }
}

function tryExtractStaticString(accessor: ts.ArrowFunction | ts.FunctionExpression): string | null {
  const body = ts.isArrowFunction(accessor) ? accessor.body : null
  if (body && ts.isStringLiteral(body)) return body.text
  return null
}

/**
 * Check if a subtree has any nested element children (worth collapsing).
 */
function hasNestedElements(node: AnalyzedNode): boolean {
  return node.children.some((c) => c.type === 'element')
}

/**
 * Collect all local helper names used in the subtree for import cleanup.
 */
function collectUsedHelpers(node: AnalyzedNode, out: Set<string>): void {
  out.add(node.localName)
  for (const child of node.children) {
    if (child.type === 'element') collectUsedHelpers(child.node, out)
  }
}

/**
 * Build the static HTML string from an analyzed subtree.
 */
function buildTemplateHTML(node: AnalyzedNode): string {
  let html = `<${node.tag}`
  for (const [key, value] of node.staticAttrs) {
    html += ` ${key}="${escapeAttr(value)}"`
  }
  html += '>'

  if (VOID_ELEMENTS.has(node.tag)) return html

  for (const child of node.children) {
    if (child.type === 'staticText') {
      html += escapeHTML(child.value)
    } else if (child.type === 'element') {
      html += buildTemplateHTML(child.node)
    } else if (child.type === 'reactiveText') {
      // Placeholder text node — patch sets nodeValue instead of createTextNode
      html += ' '
    }
  }

  html += `</${node.tag}>`
  return html
}

interface PatchOp {
  /** Variable name for this node (e.g., __n0) */
  varName: string
  /** Expression to walk to this node from root */
  walkExpr: ts.Expression
  /** Event listeners to attach */
  events: Array<[string, ts.Expression]>
  /** Bindings to register via __bind */
  bindings: Array<[number, string, string, ts.Expression]>
  /** Reactive text children — reference existing placeholder text nodes */
  reactiveTexts: Array<{ accessor: ts.Expression; mask: number; childIdx: number }>
}

/**
 * Collect all patch operations from an analyzed subtree.
 */
function collectPatchOps(
  node: AnalyzedNode,
  f: ts.NodeFactory,
  rootExpr: ts.Expression,
  ops: PatchOp[],
  counter: { n: number; t: number },
): void {
  const hasDynamic =
    node.events.length > 0 ||
    node.bindings.length > 0 ||
    node.children.some((c) => c.type === 'reactiveText')

  let nodeExpr = rootExpr

  if (hasDynamic) {
    const varName = `__n${counter.n++}`
    // Build walk expression: root.childNodes[i].childNodes[j]...
    nodeExpr = f.createIdentifier(varName)
    ops.push({
      varName,
      walkExpr: buildWalkExpr(node.path, f),
      events: node.events,
      bindings: node.bindings,
      reactiveTexts: node.children
        .filter((c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText'),
    })
  }

  // Recurse into element children
  for (const child of node.children) {
    if (child.type === 'element') {
      collectPatchOps(child.node, f, nodeExpr, ops, counter)
    }
  }
}

function buildWalkExpr(path: number[], f: ts.NodeFactory): ts.Expression {
  let expr: ts.Expression = f.createIdentifier('root')
  for (const idx of path) {
    expr = f.createElementAccessExpression(
      f.createPropertyAccessExpression(expr, 'childNodes'),
      f.createNumericLiteral(idx),
    )
  }
  return expr
}

/**
 * Emit elTemplate(htmlString, (root, __bind) => { ... }) call.
 */
function emitSubtreeTemplate(
  analyzed: AnalyzedNode,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression {
  const html = buildTemplateHTML(analyzed)
  const ops: PatchOp[] = []
  const counter = { n: 0, t: 0 }

  // Collect root-level patches
  const rootHasDynamic =
    analyzed.events.length > 0 ||
    analyzed.bindings.length > 0 ||
    analyzed.children.some((c) => c.type === 'reactiveText')

  if (rootHasDynamic) {
    ops.push({
      varName: '',  // use 'root' directly
      walkExpr: f.createIdentifier('root'),
      events: analyzed.events,
      bindings: analyzed.bindings,
      reactiveTexts: analyzed.children
        .filter((c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText'),
    })
  }

  // Collect child patches
  for (const child of analyzed.children) {
    if (child.type === 'element') {
      collectPatchOps(child.node, f, f.createIdentifier('root'), ops, counter)
    }
  }

  // Collect delegatable events: group by event type across all ops
  // Events on child nodes with the same type are delegated to the root
  const delegatableEvents = new Map<string, Array<{ nodeVar: string; handler: ts.Expression }>>()
  for (const op of ops) {
    for (const [eventName, handler] of op.events) {
      if (!op.varName) {
        // Root-level events — can't delegate further up
        continue
      }
      const list = delegatableEvents.get(eventName)
      if (list) list.push({ nodeVar: op.varName, handler })
      else delegatableEvents.set(eventName, [{ nodeVar: op.varName, handler }])
    }
  }

  // Build patch function body
  const stmts: ts.Statement[] = []

  for (const op of ops) {
    const nodeRef = op.varName
      ? f.createIdentifier(op.varName)
      : f.createIdentifier('root')

    // Variable declaration for walking to node
    if (op.varName) {
      stmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList([
            f.createVariableDeclaration(op.varName, undefined, undefined, op.walkExpr),
          ], ts.NodeFlags.Const),
        ),
      )
    }

    // Non-delegatable events (root-level or single-use event types)
    for (const [eventName, handler] of op.events) {
      const delegated = delegatableEvents.get(eventName)
      if (op.varName && delegated && delegated.length >= 2) continue // handled below
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(nodeRef, 'addEventListener'),
            undefined,
            [f.createStringLiteral(eventName), handler],
          ),
        ),
      )
    }

    // Reactive text children — reference placeholder text nodes from template
    for (const rt of op.reactiveTexts) {
      const tVar = `__t${counter.t++}`
      // const __t0 = nodeRef.childNodes[idx]  (placeholder text node from template)
      stmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList([
            f.createVariableDeclaration(tVar, undefined, undefined,
              f.createElementAccessExpression(
                f.createPropertyAccessExpression(nodeRef, 'childNodes'),
                f.createNumericLiteral(rt.childIdx),
              ),
            ),
          ], ts.NodeFlags.Const),
        ),
      )
      // __bind(__t0, mask, 'text', undefined, accessor)
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, [
            f.createIdentifier(tVar),
            createMaskLiteral(f, rt.mask),
            f.createStringLiteral('text'),
            f.createIdentifier('undefined'),
            rt.accessor,
          ]),
        ),
      )
    }

    // Reactive bindings — __bind(node, mask, kind, key, accessor)
    for (const [mask, kind, key, accessor] of op.bindings) {
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, [
            nodeRef,
            createMaskLiteral(f, mask),
            f.createStringLiteral(kind),
            key ? f.createStringLiteral(key) : f.createIdentifier('undefined'),
            accessor,
          ]),
        ),
      )
    }
  }

  // Emit delegated event listeners on root
  for (const [eventName, entries] of delegatableEvents) {
    if (entries.length < 2) continue
    // root.onclick = (e) => { if (n1.contains(e.target)) { h1(); return } if (n2.contains(e.target)) { h2(); return } }
    const eParam = f.createIdentifier('__e')
    const eTarget = f.createPropertyAccessExpression(eParam, 'target')

    const ifStmts: ts.Statement[] = []
    for (const { nodeVar, handler } of entries) {
      // if (nodeVar.contains(e.target)) { handler(e); return }
      ifStmts.push(
        f.createIfStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier(nodeVar), 'contains'),
            undefined,
            [eTarget],
          ),
          f.createBlock([
            f.createExpressionStatement(
              f.createCallExpression(handler, undefined, [eParam]),
            ),
            f.createReturnStatement(),
          ], true),
        ),
      )
    }

    const delegateHandler = f.createArrowFunction(
      undefined, undefined,
      [f.createParameterDeclaration(undefined, undefined, '__e')],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock(ifStmts, true),
    )

    // root.addEventListener(eventName, handler)
    stmts.push(
      f.createExpressionStatement(
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier('root'), 'addEventListener'),
          undefined,
          [f.createStringLiteral(eventName), delegateHandler],
        ),
      ),
    )
  }

  // (root, __bind) => { ... }
  const patchFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'root'),
      f.createParameterDeclaration(undefined, undefined, '__bind'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(stmts, true),
  )

  const call = f.createCallExpression(
    f.createIdentifier('elTemplate'),
    undefined,
    [f.createStringLiteral(html), patchFn],
  )

  return call
}

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
