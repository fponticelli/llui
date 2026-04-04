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
  const statePathCount = countStateAccessPaths(sf)

  function visit(node: ts.Node): void {
    checkEachMisuse(node, sf, diagnostics)
    checkMapOnState(node, sf, diagnostics)
    checkExhaustiveUpdate(node, sf, diagnostics, msgVariants)
    checkAccessibility(node, sf, diagnostics)
    checkControlledInput(node, sf, diagnostics)
    checkChildStaticProps(node, sf, diagnostics)
    checkBitmaskTierWarning(node, sf, diagnostics, statePathCount)

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return diagnostics
}

function pos(node: ts.Node, sf: ts.SourceFile): { line: number; column: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return { line: line + 1, column: character + 1 }
}

// ── each() scoped accessor misuse ────────────────────────────────

function checkEachMisuse(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isPropertyAccessExpression(node)) return

  // Check if the expression is 'item' (the scoped accessor param from each render)
  if (!ts.isIdentifier(node.expression)) return
  const name = node.expression.text
  if (name !== 'item') return

  // Check if we're inside an each() render callback
  if (!isInsideEachRender(node)) return

  const prop = node.name.text
  const { line, column } = pos(node, sf)
  diagnostics.push({
    message: `Direct property access '${name}.${prop}' on each() scoped accessor at line ${line}. Use 'item(t => t.${prop})' to read the item's property reactively.`,
    line,
    column,
  })
}

function isInsideEachRender(node: ts.Node): boolean {
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
    }
  }
}

// ── Bitmask tier boundary warning ───────────────────────────────

function countStateAccessPaths(sf: ts.SourceFile): number {
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
  return paths.size
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

function checkBitmaskTierWarning(
  node: ts.Node,
  sf: ts.SourceFile,
  diagnostics: Diagnostic[],
  pathCount: number,
): void {
  // Only emit once, on the component() call
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'component') return

  if (pathCount >= 28 && pathCount <= 31) {
    const { line, column } = pos(node, sf)
    diagnostics.push({
      message: `Component at line ${line} has ${pathCount} unique state access paths, approaching the 31-path single-mask tier limit. Consider decomposing into child components.`,
      line,
      column,
    })
  } else if (pathCount > 31) {
    const { line, column } = pos(node, sf)
    diagnostics.push({
      message: `Component at line ${line} has ${pathCount} unique state access paths, exceeding the 31-path single-mask tier. Decompose into child components for optimal performance.`,
      line,
      column,
    })
  }
}
