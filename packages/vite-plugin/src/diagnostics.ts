import ts from 'typescript'

export interface Diagnostic {
  message: string
  line: number
  column: number
}

const INTERACTIVE_ELEMENTS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
])

const ELEMENT_HELPERS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
  'video',
])

export function diagnose(source: string): Diagnostic[] {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
  const diagnostics: Diagnostic[] = []

  // Collect Msg type variants for exhaustive update() check
  const msgVariants = collectMsgVariants(sf)

  // Collect state access paths for bitmask warning
  const statePaths = collectStatePaths(sf)

  function visit(node: ts.Node): void {
    checkMapOnState(node, sf, diagnostics)
    checkExhaustiveUpdate(node, sf, diagnostics, msgVariants)
    checkAccessibility(node, sf, diagnostics)
    checkControlledInput(node, sf, diagnostics)
    checkChildStaticProps(node, sf, diagnostics)
    checkBitmaskOverflow(node, sf, diagnostics, statePaths)
    checkNamespaceImport(node, sf, diagnostics)
    checkSpreadChildren(node, sf, diagnostics)
    checkEmptyProps(node, sf, diagnostics)

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return diagnostics
}

// ── "Almost-optimized" diagnostics ───────────────────────────────

// Warns when a user writes `import * as L from '@llui/dom'` — the compiler
// can only recognize named-import helpers, so namespace imports disable
// template cloning/elSplit for every element call in the file.
function checkNamespaceImport(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isImportDeclaration(node)) return
  if (!ts.isStringLiteral(node.moduleSpecifier)) return
  if (node.moduleSpecifier.text !== '@llui/dom') return
  const clause = node.importClause
  if (!clause?.namedBindings) return
  if (!ts.isNamespaceImport(clause.namedBindings)) return
  const name = clause.namedBindings.name.text
  const { line, column } = pos(clause.namedBindings, sf)
  diagnostics.push({
    message: `Namespace import '${name}' from '@llui/dom' at line ${line} disables compiler optimizations. Use named imports instead: import { div, text, ... } from '@llui/dom'.`,
    line,
    column,
  })
}

// Warns when a children array contains a spread — the compiler can't
// analyze variable-length children, so it bails on template cloning and
// falls back to runtime elSplit. Not fatal, but silent.
function checkSpreadChildren(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression)) return
  if (!ELEMENT_HELPERS.has(node.expression.text)) return
  // Children could be at arguments[0] (children-only overload) or arguments[1]
  for (const arg of node.arguments) {
    if (!ts.isArrayLiteralExpression(arg)) continue
    // Look for "suspicious" spreads — ones that aren't obviously returning
    // Node[] from a structural primitive or user-defined view helper.
    for (const el of arg.elements) {
      if (!ts.isSpreadElement(el)) continue
      if (isStructuralSpread(el.expression)) continue
      const { line, column } = pos(arg, sf)
      diagnostics.push({
        message: `Spread in children array of '${node.expression.text}()' at line ${line} disables template-clone compilation. For dynamic child counts, use each() instead.`,
        line,
        column,
      })
      return
    }
  }
}

// Array iteration methods whose result spreads are the red flag we want
// to catch — users should use each() instead. Function calls generally
// return Node[] from structural primitives or user view helpers and are
// the legitimate way to compose output.
const ARRAY_ITERATION_METHODS = new Set([
  'map',
  'filter',
  'flatMap',
  'slice',
  'concat',
  'reverse',
  'sort',
])

function isStructuralSpread(expr: ts.Expression): boolean {
  // Only keep the warning for suspect patterns: identifier spreads and
  // array-iteration method calls. Everything else is presumed to be a
  // structural primitive or user helper returning Node[].
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
      // `...arr.map(...)`, `...arr.filter(...)` — suspect
      return !ARRAY_ITERATION_METHODS.has(callee.name.text)
    }
    // Plain function call `...fn()` — presume structural/helper
    return true
  }
  // Identifier spread (`...arr`) — suspect
  return false
}

// Warns when an element helper is called with an empty props object — the
// attrs argument is optional, so `h1({}, [...])` should be `h1([...])`.
function checkEmptyProps(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression)) return
  if (!ELEMENT_HELPERS.has(node.expression.text)) return
  const firstArg = node.arguments[0]
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return
  if (firstArg.properties.length !== 0) return
  const { line, column } = pos(firstArg, sf)
  diagnostics.push({
    message: `Empty props object passed to '${node.expression.text}()' at line ${line}. The attrs argument is optional — omit it: ${node.expression.text}([...]).`,
    line,
    column,
  })
}

function pos(node: ts.Node, sf: ts.SourceFile): { line: number; column: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return { line: line + 1, column: character + 1 }
}

function _isInsideEachRender(node: ts.Node): boolean {
  let current = node.parent
  while (current) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parameters.length >= 1
    ) {
      const param = current.parameters[0]!
      // Options bag: ({ item, ... }) => ...
      const hasItemParam =
        ts.isObjectBindingPattern(param.name) &&
        param.name.elements.some(
          (el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === 'item',
        )
      if (hasItemParam) {
        const propAssign = current.parent
        if (
          ts.isPropertyAssignment(propAssign) &&
          ts.isIdentifier(propAssign.name) &&
          propAssign.name.text === 'render'
        ) {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

// ── .map() on state arrays ───────────────────────────────────────

function checkMapOnState(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isPropertyAccessExpression(node.expression)) return
  if (node.expression.name.text !== 'map') return

  // Check if receiver involves a state parameter reference
  if (!referencesStateParam(node.expression.expression)) return

  // Check if we're inside a view function
  if (!isInsideViewFunction(node)) return

  const { line, column } = pos(node, sf)
  diagnostics.push({
    message: `Array .map() on state-derived value at line ${line}. Use each() for reactive lists that update when the array changes.`,
    line,
    column,
  })
}

function referencesStateParam(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return referencesStateParam(node.expression)
  }
  if (ts.isIdentifier(node)) {
    // Check if the identifier is a parameter named 'state' or 's' or matches common patterns
    // Simple heuristic: check if it's a parameter of the view function
    const name = node.text
    return name === 'state' || name === 's' || name === '_state'
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

// ── Exhaustive update() ──────────────────────────────────────────

function collectMsgVariants(sf: ts.SourceFile): Set<string> {
  const variants = new Set<string>()

  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (stmt.name.text !== 'Msg') continue

    // Walk the union to find { type: 'literal' } members
    collectUnionVariants(stmt.type, variants)
  }

  return variants
}

function collectUnionVariants(type: ts.TypeNode, variants: Set<string>): void {
  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      collectUnionVariants(member, variants)
    }
    return
  }

  if (ts.isTypeLiteralNode(type)) {
    for (const member of type.members) {
      if (!ts.isPropertySignature(member)) continue
      if (!ts.isIdentifier(member.name!) || member.name.text !== 'type') continue
      if (member.type && ts.isLiteralTypeNode(member.type)) {
        if (ts.isStringLiteral(member.type.literal)) {
          variants.add(member.type.literal.text)
        }
      }
    }
  }
}

function checkExhaustiveUpdate(
  node: ts.Node,
  sf: ts.SourceFile,
  diagnostics: Diagnostic[],
  msgVariants: Set<string>,
): void {
  if (msgVariants.size === 0) return
  if (!ts.isPropertyAssignment(node)) return
  if (!ts.isIdentifier(node.name) || node.name.text !== 'update') return

  // Find the switch statement in the update body
  const fn = node.initializer
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return

  const body = ts.isBlock(fn.body) ? fn.body : null
  if (!body) return

  const handledCases = new Set<string>()
  let hasDefault = false

  function findSwitch(n: ts.Node): void {
    if (ts.isSwitchStatement(n)) {
      for (const clause of n.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) {
          hasDefault = true
        } else if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
          handledCases.add(clause.expression.text)
        }
      }
    }
    ts.forEachChild(n, findSwitch)
  }

  findSwitch(body)

  if (hasDefault) return

  const missing = [...msgVariants].filter((v) => !handledCases.has(v))
  if (missing.length === 0) return

  const { line, column } = pos(node, sf)
  diagnostics.push({
    message: `update() does not handle message type${missing.length > 1 ? 's' : ''} ${missing.map((m) => `'${m}'`).join(', ')} at line ${line}.`,
    line,
    column,
  })
}

// ── Accessibility ────────────────────────────────────────────────

function checkAccessibility(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression)) return

  const tag = node.expression.text
  if (!ELEMENT_HELPERS.has(tag)) return

  const propsArg = node.arguments[0]
  if (!propsArg || !ts.isObjectLiteralExpression(propsArg)) return

  const props = getStaticPropKeys(propsArg)

  // img without alt
  if (tag === 'img' && !props.has('alt')) {
    const { line, column } = pos(node, sf)
    diagnostics.push({
      message: `<img> at line ${line} has no 'alt' attribute. Add alt text for screen readers, or alt='' for decorative images.`,
      line,
      column,
    })
  }

  // onClick on non-interactive element without role
  if (props.has('onClick') && !INTERACTIVE_ELEMENTS.has(tag) && !props.has('role')) {
    const { line, column } = pos(node, sf)
    diagnostics.push({
      message: `onClick on <${tag}> at line ${line} without role and tabIndex. Non-interactive elements with click handlers are not keyboard-accessible. Add role='button' and tabIndex={0}, or use <button>.`,
      line,
      column,
    })
  }
}

// ── Controlled input ─────────────────────────────────────────────

function checkControlledInput(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression)) return

  const tag = node.expression.text
  if (tag !== 'input' && tag !== 'textarea') return

  const propsArg = node.arguments[0]
  if (!propsArg || !ts.isObjectLiteralExpression(propsArg)) return

  const props = getProps(propsArg)

  // Check if value is a reactive binding (arrow function)
  const valueProp = props.get('value')
  if (!valueProp) return
  if (!ts.isArrowFunction(valueProp) && !ts.isFunctionExpression(valueProp)) return

  // Must have onInput
  if (!props.has('onInput') && !props.has('onChange')) {
    const { line, column } = pos(node, sf)
    diagnostics.push({
      message: `Controlled input at line ${line}: reactive 'value' binding without 'onInput' handler. The binding will overwrite user input on every state update.`,
      line,
      column,
    })
  }
}

function getStaticPropKeys(obj: ts.ObjectLiteralExpression): Set<string> {
  const keys = new Set<string>()
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      keys.add(prop.name.text)
    }
  }
  return keys
}

function getProps(obj: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>()
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      map.set(prop.name.text, prop.initializer)
    }
  }
  return map
}

// ── child() static props ────────────────────────────────────────

function checkChildStaticProps(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'child') return

  const arg = node.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    if (!ts.isIdentifier(prop.name) || prop.name.text !== 'props') continue

    // props must be a function, not an object literal
    if (ts.isObjectLiteralExpression(prop.initializer)) {
      const { line, column } = pos(node, sf)
      diagnostics.push({
        message: `child() at line ${line}: 'props' is a static object literal. It must be a reactive accessor function (s => ({ ... })) so props update when parent state changes.`,
        line,
        column,
      })
      continue
    }

    // props accessor: warn when the returned object contains fresh
    // object/array literals. The prop-diff in `child()` compares by
    // reference per top-level key (Object.is), so a freshly-constructed
    // nested value reports changed on every parent update — propsMsg
    // fires every render, which is wasted work at best and an infinite
    // loop vector when combined with a naive `onMsg` forwarder.
    if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
      const returned = getReturnedObjectLiteral(prop.initializer)
      if (!returned) continue
      for (const keyProp of returned.properties) {
        if (!ts.isPropertyAssignment(keyProp)) continue
        const init = keyProp.initializer
        if (!ts.isObjectLiteralExpression(init) && !ts.isArrayLiteralExpression(init)) continue
        const keyName = ts.isIdentifier(keyProp.name)
          ? keyProp.name.text
          : ts.isStringLiteral(keyProp.name)
            ? keyProp.name.text
            : '<?>'
        const kind = ts.isArrayLiteralExpression(init) ? 'array' : 'object'
        const { line, column } = pos(keyProp, sf)
        diagnostics.push({
          message: `child() at line ${line}: the 'props' accessor returns a fresh ${kind} literal for '${keyName}'. Prop diffing uses Object.is per key, so a freshly-constructed reference reports changed every render — propsMsg will fire on every parent update. Hoist to a module-level constant, reuse a reference from state, or return null from propsMsg when the value is unchanged.`,
          line,
          column,
        })
      }
    }
  }
}

function getReturnedObjectLiteral(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ObjectLiteralExpression | null {
  const body = fn.body
  if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
    return body.expression
  }
  if (ts.isObjectLiteralExpression(body)) return body
  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (!ts.isReturnStatement(stmt) || !stmt.expression) continue
      const expr = stmt.expression
      if (ts.isObjectLiteralExpression(expr)) return expr
      if (ts.isParenthesizedExpression(expr) && ts.isObjectLiteralExpression(expr.expression)) {
        return expr.expression
      }
    }
  }
  return null
}

// ── Bitmask overflow warning ────────────────────────────────────

function collectStatePaths(sf: ts.SourceFile): Set<string> {
  const paths = new Set<string>()

  function visit(node: ts.Node): void {
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parameters.length === 1
    ) {
      const param = node.parameters[0]!.name
      if (ts.isIdentifier(param)) {
        // Check if this looks like a reactive accessor
        const parent = node.parent
        if (ts.isPropertyAssignment(parent)) {
          const key = parent.name
          if (ts.isIdentifier(key) && !/^on[A-Z]/.test(key.text)) {
            extractAccessPaths(node.body, param.text, paths)
          }
        } else if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
          extractAccessPaths(node.body, param.text, paths)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return paths
}

function extractAccessPaths(node: ts.Node, paramName: string, paths: Set<string>): void {
  if (ts.isPropertyAccessExpression(node)) {
    const chain = resolveSimpleChain(node, paramName)
    if (chain) paths.add(chain)
  }
  ts.forEachChild(node, (child) => extractAccessPaths(child, paramName, paths))
}

function resolveSimpleChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
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

function checkBitmaskOverflow(
  node: ts.Node,
  sf: ts.SourceFile,
  diagnostics: Diagnostic[],
  paths: Set<string>,
): void {
  // Only emit once, on the component() call
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'component') return

  const pathCount = paths.size
  if (pathCount <= 31) return

  const overflow = pathCount - 31
  const { line, column } = pos(node, sf)

  // Group paths by top-level field so authors know which slice to extract.
  // `resolveSimpleChain` already truncates to depth 2 (e.g. "user.name"),
  // so splitting on "." gives us the top-level field.
  const byTopLevel = new Map<string, number>()
  for (const p of paths) {
    const top = p.split('.', 1)[0]!
    byTopLevel.set(top, (byTopLevel.get(top) ?? 0) + 1)
  }
  const sorted = [...byTopLevel.entries()].sort((a, b) => b[1] - a[1])

  // Pick the top fields whose combined path count would bring us under
  // the 31 limit. These are the best candidates to extract.
  const candidates: string[] = []
  let saved = 0
  for (const [field, n] of sorted) {
    if (pathCount - saved <= 31) break
    candidates.push(field)
    saved += n
  }
  const breakdown = sorted.map(([field, n]) => `${field} (${n})`).join(', ')
  const candidateList = candidates.map((f) => `\`${f}\``).join(', ')

  diagnostics.push({
    message:
      `Component at line ${line} has ${pathCount} unique state access paths ` +
      `(${overflow} past the 31-path limit). Paths 32..${pathCount} fall back to ` +
      `FULL_MASK — their changes re-evaluate every binding in the component, ` +
      `negating the bitmask optimization for those updates.\n\n` +
      `Top-level fields by path count: ${breakdown}.\n\n` +
      `Recommended fix: extract ${candidateList} into ${candidates.length === 1 ? 'a' : ''} ` +
      `child component${candidates.length === 1 ? '' : 's'} via \`child()\` ` +
      `(see /api/dom#child). Each child gets its own 31-path bitmask, so the ` +
      `extracted paths no longer count against the parent's limit. ` +
      `Alternative: use \`sliceHandler\` to embed a state machine that owns ` +
      `the field's reducer.`,
    line,
    column,
  })
}
