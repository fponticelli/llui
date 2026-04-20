import ts from 'typescript'
import { checkAgentMissingIntent } from './rules/agent-intent.js'
import { checkAgentExclusiveTags } from './rules/agent-exclusive-tags.js'
import { checkAgentHandlerPattern } from './rules/agent-handler-pattern.js'

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
  /** Score from 0 to 17. Starts at 17, -1 per violated rule category. */
  score: number
}

export interface LintOptions {
  /**
   * Rule names to skip. Useful for avoiding duplication when running
   * alongside `@llui/vite-plugin`, which already emits some of these
   * diagnostics from its own `diagnose()` pass.
   */
  exclude?: readonly string[]
}

/**
 * Every rule name emitted by `lintIdiomatic`. Stable list so callers
 * (like the Vite plugin wrapper) can reference them by name to exclude.
 */
export const RULE_NAMES = [
  'state-mutation',
  'missing-memo',
  'each-closure-violation',
  'map-on-state-array',
  'unnecessary-child',
  'form-boilerplate',
  'async-update',
  'direct-state-in-view',
  'exhaustive-effect-handling',
  'effect-without-handler',
  'forgotten-spread',
  'string-effect-callback',
  'nested-send-in-update',
  'imperative-dom-in-view',
  'accessor-side-effect',
  'view-bag-import',
  'spread-in-children',
  'agent-missing-intent',
  'agent-exclusive-annotations',
  'agent-nonextractable-handler',
] as const

export type RuleName = (typeof RULE_NAMES)[number]

/**
 * Lint a single source file for LLui idiomatic anti-patterns.
 * Returns violations and a numeric score (17 = perfect).
 */
export function lintIdiomatic(
  source: string,
  filename = 'input.ts',
  options: LintOptions = {},
): LintResult {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const violations: LintViolation[] = []
  const exclude = new Set(options.exclude ?? [])

  // Each check runs its own visitor; filter by rule name at the end rather
  // than skipping the check entirely, so tests can verify the exclude
  // mechanism without re-plumbing every check function.
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
  checkViewBagImport(sf, filename, violations)
  checkSpreadInChildren(sf, filename, violations)
  checkAgentMissingIntent(sf, filename, violations, source)
  checkAgentExclusiveTags(sf, filename, violations, source)
  checkAgentHandlerPattern(sf, filename, violations)

  const filtered = exclude.size > 0 ? violations.filter((v) => !exclude.has(v.rule)) : violations

  // Score: unique violated rule categories (post-filter)
  const violatedRules = new Set(filtered.map((v) => v.rule))
  const score = Math.max(0, RULE_NAMES.length - violatedRules.size)

  return { violations: filtered, score }
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
  // Only `++` / `--` are mutations. Other prefix unary operators (`!`,
  // `~`, `+`, `-`) are pure reads and must NOT match — flagging them
  // turned `return [{ ...state, flag: !state.flag }, []]` into a false
  // positive during the persistent-layout example work.
  if (
    (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
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
  // Collect arrow functions used as reactive-binding accessors (not
  // arbitrary prop values). Group by printed source text and flag
  // groups with count >= 2 that aren't wrapped in memo().
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

  // Element helpers — any prop assignment on an object passed to one
  // of these counts as a reactive binding site. `child()`, `each()`,
  // `show()`, `branch()`, `memo()`, `selector()` are STRUCTURAL
  // primitives; arrow props there are configuration, not bindings.
  const ELEMENT_HELPER_RECEIVERS = new Set([
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
    'kbd',
    'label',
    'legend',
    'li',
    'main',
    'mark',
    'menu',
    'meter',
    'nav',
    'ol',
    'optgroup',
    'option',
    'output',
    'p',
    'picture',
    'pre',
    'progress',
    'q',
    's',
    'samp',
    'section',
    'select',
    'small',
    'source',
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
    'track',
    'u',
    'ul',
    'var',
    'video',
    'wbr',
  ])

  /**
   * An arrow is a reactive binding if it sits in one of:
   *   - first arg to `text(...)`
   *   - a property value of an object literal passed to an element
   *     helper like `div({ class: (s) => ... }, [...])`
   *
   * Prop values passed to `child()`, `each()`, etc. are configuration,
   * not reactive bindings, and should not be memoized.
   */
  function isReactiveBinding(arrow: ts.ArrowFunction): boolean {
    const parent = arrow.parent
    if (!parent) return false

    // Case 1: first arg to text()
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === 'text' &&
      parent.arguments[0] === arrow
    ) {
      return true
    }

    // Case 2: property in an object literal passed to an element helper
    if (ts.isPropertyAssignment(parent)) {
      const objectLit = parent.parent
      if (!objectLit || !ts.isObjectLiteralExpression(objectLit)) return false
      const call = objectLit.parent
      if (!call || !ts.isCallExpression(call)) return false
      if (!ts.isIdentifier(call.expression)) return false
      return ELEMENT_HELPER_RECEIVERS.has(call.expression.text)
    }

    return false
  }

  function visit(node: ts.Node): void {
    if (ts.isArrowFunction(node) && isInsideViewFunction(node)) {
      // Require at least one parameter: state-accessor convention is
      // `(s) => ...`. Zero-arg arrows like `() => 'static'` or `() => ({})`
      // don't depend on state and memo() doesn't help.
      if (node.parameters.length === 0) {
        ts.forEachChild(node, visit)
        return
      }
      if (isReactiveBinding(node)) {
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

/**
 * Collect every identifier declared at the module (file) level. These
 * are safe to capture inside an each() render callback because they
 * share a single value across all iterations — typical cases are
 * imports, top-level consts, and function declarations.
 *
 * Identifiers declared INSIDE a function (as `let`, `var`, or function
 * parameters) are not collected — those are the genuinely mutable
 * captures the rule is designed to catch.
 */
function collectModuleLevelNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const stmt of sf.statements) {
    // Imports: import { a, b as c } from 'x'  /  import def from 'x'
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause
      if (!clause) continue
      if (clause.name) names.add(clause.name.text) // default import
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add(clause.namedBindings.name.text)
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            names.add(el.name.text)
          }
        }
      }
      continue
    }
    // Top-level function declarations
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      names.add(stmt.name.text)
      continue
    }
    // Top-level class declarations
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      names.add(stmt.name.text)
      continue
    }
    // Top-level variable declarations — any kind, including `let` and
    // `var`. A top-level `let` is still shared across each() iterations
    // because each() runs all renders within one update cycle; the
    // concern is locals inside the ENCLOSING component function, not
    // module-level state.
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        collectBindingIdentifiers(decl.name, names)
      }
    }
  }
  return names
}

function collectBindingIdentifiers(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text)
  } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) collectBindingIdentifiers(el.name, out)
    }
  }
}

function checkEachClosureViolation(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Pre-compute module-level declarations so checkClosureCaptures can
  // skip any identifier that resolves to one of them. Built once per
  // file regardless of how many each() calls the file contains.
  const moduleScopeNames = collectModuleLevelNames(sf)

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
              checkClosureCaptures(renderFn, sf, filename, violations, moduleScopeNames)
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
  moduleScopeNames: Set<string>,
): void {
  // Collect parameter names of the render callback (including destructured ones)
  const paramNames = new Set<string>()
  function collectBindingNames(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      paramNames.add(name.text)
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) collectBindingNames(el.name)
      }
    }
  }
  for (const param of renderFn.parameters) {
    collectBindingNames(param.name)
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

  // Built-in JS globals that are always safe to reference. Everything
  // else we might need to skip (imports, element helpers, custom
  // utilities) is already in `moduleScopeNames` from the file pre-scan.
  const jsGlobals = new Set([
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
    'NaN',
    'Infinity',
    'document',
    'window',
    'globalThis',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'Error',
    'TypeError',
    'RangeError',
    'Set',
    'Map',
    'WeakSet',
    'WeakMap',
    'Symbol',
    'Reflect',
    'Proxy',
  ])

  // LLui-specific names that are stable function references across
  // renders. `send` in particular is the same function inside and
  // outside the each() render callback, so capturing the outer one is
  // equivalent to destructuring it. No correctness risk.
  const lluiSafeNames = new Set(['send'])

  // Find identifiers in binding positions that reference parent scope
  function checkBindings(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const name = node.text
      // Skip if it's a parameter, local, JS global, LLui stable name,
      // or module-scope name. Module-scope names include imports,
      // top-level consts, and function declarations — all shared
      // across each() iterations, so capturing them is harmless.
      if (
        paramNames.has(name) ||
        localNames.has(name) ||
        jsGlobals.has(name) ||
        lluiSafeNames.has(name) ||
        moduleScopeNames.has(name)
      ) {
        return
      }
      // Skip if it's a property name in a property access (rhs of dot)
      if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        return
      // Skip if it's a property name in a property assignment
      if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node) return
      // Skip type references
      if (node.parent && ts.isTypeReferenceNode(node.parent)) return

      // Check if this identifier is used in a binding context (arrow fn arg to text(), prop value)
      // — but only nested arrow functions inside the render body, not the render itself.
      if (isInBindingContext(node, renderFn)) {
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

function isInBindingContext(
  node: ts.Node,
  boundary: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  // Walk up to find if we're inside an arrow function that's nested inside
  // (not equal to) the render callback — i.e. a genuine reactive binding.
  let current: ts.Node | undefined = node
  while (current && current !== boundary) {
    if (ts.isArrowFunction(current)) {
      const parent: ts.Node | undefined = current.parent
      // First arg to text() — reactive text binding
      if (
        parent &&
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'text' &&
        parent.arguments[0] === current
      ) {
        return true
      }
      // Reactive prop value in object literal (e.g. class: (s) => ...)
      // but only if the property is not a structural callback like 'render', 'items', 'key'
      if (parent && ts.isPropertyAssignment(parent)) {
        const propName =
          ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null
        // Skip structural callbacks — they're not reactive bindings
        if (
          propName !== 'render' &&
          propName !== 'items' &&
          propName !== 'key' &&
          propName !== 'init' &&
          propName !== 'update' &&
          propName !== 'view' &&
          propName !== 'onMsg' &&
          propName !== 'onSuccess' &&
          propName !== 'onError' &&
          propName !== 'on' &&
          propName !== 'when' &&
          propName !== 'cases' &&
          propName !== 'fallback' &&
          propName !== 'props'
        ) {
          return true
        }
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

    for (const [shape, group] of shapeGroups) {
      if (group.length < 3) continue

      // Only flag when the shared shape looks like form field updates.
      // Heuristic: the shape must contain a `value` field AND the variant
      // names must share a common `set*`/`update*`/`change*` prefix.
      // Error variants (`apiError`, `readmeError`, …) and data variants
      // (`userOk`, `repoOk`, …) coincidentally share shapes but aren't
      // form boilerplate — the rule should not flag them.
      const hasValueField = shape.split(',').some((f) => f.startsWith('value:'))
      if (!hasValueField) continue

      const prefixPattern = /^(set|update|change)[A-Z]/
      const allMatchPrefix = group.every((name) => prefixPattern.test(name))
      if (!allMatchPrefix) continue

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

interface MsgVariantShape {
  typeName: string
  shape: string
}

// ── Rule 7: async-update ───────────────────────────────────────────

function checkAsyncUpdate(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void {
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
            message: 'update() must be synchronous and pure. Move async operations to effects.',
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
      message: 'update() must be synchronous and pure. Move async operations to effects.',
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
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'view') {
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
  ts.forEachChild(node, (child) => findStateInEventHandlers(child, sf, filename, violations))
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

function isEmptyFunctionBody(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
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
    if (second && ts.isArrayLiteralExpression(second) && second.elements.length > 0) {
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
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'view') {
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

/**
 * Returns true if the node is inside a function that serves as an
 * event handler (onClick, onInput, onMouseDown…) or a deferred
 * callback (setTimeout, queueMicrotask, requestAnimationFrame,
 * Promise.then, addEventListener). All of these execute imperatively,
 * not reactively — imperative DOM inside them is fine.
 */
function isInsideImperativeCallback(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    // Walk up to the enclosing function, then check what that function
    // is passed to.
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent
      if (parent) {
        // Case 1: prop assignment like `onClick: () => ...`
        if (
          ts.isPropertyAssignment(parent) &&
          ts.isIdentifier(parent.name) &&
          /^on[A-Z]/.test(parent.name.text)
        ) {
          return true
        }
        // Case 2: argument to a known deferred-execution helper
        if (ts.isCallExpression(parent)) {
          const callee = parent.expression
          if (ts.isIdentifier(callee)) {
            if (
              callee.text === 'setTimeout' ||
              callee.text === 'setInterval' ||
              callee.text === 'queueMicrotask' ||
              callee.text === 'requestAnimationFrame' ||
              callee.text === 'requestIdleCallback'
            ) {
              return true
            }
          }
          // addEventListener / Promise.then / etc.
          if (ts.isPropertyAccessExpression(callee)) {
            const method = callee.name.text
            if (
              method === 'addEventListener' ||
              method === 'then' ||
              method === 'catch' ||
              method === 'finally'
            ) {
              return true
            }
          }
        }
      }
      // Keep walking — a nested arrow inside an event handler should
      // still count as "inside an event handler".
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
    // Skip legitimate imperative contexts: onMount() callbacks, event
    // handlers (onClick, onInput, …), and deferred callbacks
    // (setTimeout, queueMicrotask, addEventListener, Promise.then).
    if (!isInsideOnMountCall(node) && !isInsideImperativeCallback(node)) {
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
        findSideEffectsInAccessor(
          node.body,
          sf,
          filename,
          violations,
          sideEffectNames,
          consoleMethods,
        )
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
    if (ts.isIdentifier(node.expression) && sideEffectNames.has(node.expression.text)) {
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

// ── Rule: view-bag-import ──────────────────────────────────────

const VIEW_BAG_NAMES = new Set(['text', 'each', 'show', 'branch', 'memo', 'selector'])

/**
 * Detect whether the file defines a component. Only in that case does
 * a direct `import { text } from '@llui/dom'` compete with the
 * bag-provided form — in standalone helper modules (Level-1 view
 * functions, shared UI utilities), imports are the only way to
 * reference these primitives and are idiomatic.
 *
 * A `component()` call is sufficient on its own — even if the `view:`
 * callback currently has no parameter, the developer can add one and
 * destructure, so the direct import is still redundant.
 */
function fileDefinesComponent(sf: ts.SourceFile): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component' &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0]!)
    ) {
      const obj = node.arguments[0] as ts.ObjectLiteralExpression
      for (const prop of obj.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'view'
        ) {
          found = true
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function checkViewBagImport(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  // Only applies to files that define a component. Helper modules
  // (Level-1 view functions, shared UI utilities) legitimately need
  // to import these names because they have no view bag to destructure.
  if (!fileDefinesComponent(sf)) return

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const moduleSpec = stmt.moduleSpecifier
    if (!ts.isStringLiteral(moduleSpec)) continue
    if (moduleSpec.text !== '@llui/dom') continue

    const clause = stmt.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue

    for (const spec of clause.namedBindings.elements) {
      const name = spec.name.text
      if (VIEW_BAG_NAMES.has(name)) {
        const { line } = sf.getLineAndCharacterOfPosition(spec.getStart())
        violations.push({
          rule: 'view-bag-import',
          message: `Do not import '${name}' from '@llui/dom'. Use the view bag instead: view: ({ ${name}, ... }) => [...]. The view bag version is typed to your component's State.`,
          file: filename,
          line: line + 1,
          column: 0,
          suggestion: `Destructure '${name}' from the view() parameter and pass it to helper functions.`,
        })
      }
    }
  }
}

// ── Rule: spread-in-children ───────────────────────────────────

function checkSpreadInChildren(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  const ELEMENT_HELPERS = new Set([
    'div',
    'span',
    'button',
    'p',
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
    'nav',
    'main',
    'section',
    'article',
    'header',
    'footer',
    'form',
    'fieldset',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'label',
    'details',
    'summary',
  ])

  function walk(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ELEMENT_HELPERS.has(node.expression.text)
    ) {
      // Check children argument (last array literal).
      // Spread is allowed when the argument is a structural primitive
      // or a context provider — those return Node[] and MUST be spread.
      // Flag only spreads over .map(), .filter(), or arrays.
      //
      // `provide` and `pageSlot` return Node[] the same way each/show/
      // branch do, and the idiomatic pattern is
      // `...provide(Ctx, accessor, () => [...])` as a child. Without
      // this exemption the rule trips on every context-provider use
      // inside a layout's view tree.
      const STRUCTURAL = new Set([
        'each',
        'show',
        'branch',
        'virtualEach',
        'onMount',
        'provide',
        'pageSlot',
      ])
      for (const arg of node.arguments) {
        if (!ts.isArrayLiteralExpression(arg)) continue
        for (const el of arg.elements) {
          if (!ts.isSpreadElement(el)) continue
          // Allowed: ...each(...), ...show(...), ...branch(...), ...virtualEach(...)
          const inner = el.expression
          if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
            if (STRUCTURAL.has(inner.expression.text)) continue
          }
          const { line } = sf.getLineAndCharacterOfPosition(el.getStart())
          violations.push({
            rule: 'spread-in-children',
            message: `Spread in children of '${node.expression.text}()' prevents template-clone optimization. Use each() for lists.`,
            file: filename,
            line: line + 1,
            column: 0,
            suggestion: `Replace '...array.map(...)' with each({ items: () => array, key: ..., render: ... }).`,
          })
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  ts.forEachChild(sf, walk)
}
