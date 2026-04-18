import ts from 'typescript'
import { collectDeps } from './collect-deps.js'
import { extractMsgSchema, extractEffectSchema } from './msg-schema.js'
import { extractStateSchema, type StateType } from './state-schema.js'

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

const PROP_KEYS = new Set([
  'value',
  'checked',
  'selected',
  'disabled',
  'readOnly',
  'multiple',
  'indeterminate',
  'defaultValue',
  'defaultChecked',
  'innerHTML',
  'textContent',
])

type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style'

/**
 * Walk from `use` outward toward the source file root, looking for a
 * `const <name> = <initializer>` (or `let`/`var`) declaration that binds
 * this identifier in an enclosing scope. Returns the initializer if found.
 *
 * This enables reactive-binding detection for hoisted accessors:
 *
 *   const cls = (s: State) => isActive(item, s.path) ? 'on' : 'off'
 *   return a({ class: cls }, ...)
 *
 * Without resolution, `class: cls` would fall through the static path
 * and emit `__e.className = cls`, coercing the function to its source
 * string. With resolution, we see that `cls` is an arrow and emit a
 * binding exactly as if the arrow had been inlined.
 *
 * Lifetime rules:
 *   - Only single-binding `const`/`let`/`var` declarations with an
 *     initializer are considered. No destructuring, no multi-declarator
 *     statements (too easy to get wrong without a type checker).
 *   - Later reassignments are NOT tracked — if the identifier is `let`
 *     and gets reassigned, the resolution is unreliable. We conservatively
 *     refuse to resolve `let` bindings for now (arrow-valued accessors
 *     are ~always `const` in practice).
 *   - The declaration must dominate the use (same block or an enclosing
 *     one). TypeScript's block semantics mean walking up parent blocks
 *     is sufficient.
 */
function resolveLocalConstInitializer(use: ts.Identifier): ts.Expression | null {
  const name = use.text
  let node: ts.Node = use
  while (node.parent) {
    const parent = node.parent
    // Scan statements of an enclosing block/source-file for a matching declaration
    let statements: readonly ts.Statement[] | null = null
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)) {
      statements = parent.statements
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      statements = parent.statements
    }
    if (statements) {
      for (const stmt of statements) {
        if (!ts.isVariableStatement(stmt)) continue
        // Skip `let` — reassignment would invalidate our resolution
        const flags = stmt.declarationList.flags
        if (!(flags & ts.NodeFlags.Const)) continue
        if (stmt.declarationList.declarations.length !== 1) continue
        const decl = stmt.declarationList.declarations[0]!
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue
        if (!decl.initializer) continue
        return decl.initializer
      }
    }
    node = parent
  }
  return null
}

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
export interface TransformEdit {
  start: number
  end: number
  replacement: string
}

export function transformLlui(
  source: string,
  _filename: string,
  devMode = false,
  mcpPort: number | null = 5200,
  verbose = false,
): { output: string; edits: TransformEdit[] } | null {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)

  // Find the @llui/dom import
  const imp = findLluiImport(sourceFile)
  if (!imp) return null
  const lluiImport = imp

  // Collect imported element helper names (local → original)
  const importedHelpers = getImportedHelpers(lluiImport)
  if (importedHelpers.size === 0 && !hasReactiveAccessors(sourceFile)) return null

  // Pass 2 pre-scan: collect all state access paths
  // Only use precise masks in files that define a component() — the __dirty
  // function is generated per-component, so bit assignments in other files
  // won't match. Files without component() get FULL_MASK on all bindings.
  const fileHasComponent = hasComponentDef(sourceFile, lluiImport)
  const fieldBits = fileHasComponent ? collectDeps(source) : new Map<string, number>()

  if (verbose && fileHasComponent) {
    const pairs = [...fieldBits.entries()]
      .map(([path, bit]) => `${path}=${bit === -1 ? 'FULL' : bit}`)
      .join(', ')
    console.info(
      `[llui] ${_filename}: ${fieldBits.size} reactive path${fieldBits.size === 1 ? '' : 's'}` +
        (pairs.length > 0 ? ` — ${pairs}` : ''),
    )
  }

  // Identifier names bound to the View<S,M> helpers parameter of a `view` callback.
  // When the user writes `h.text(...)` / `h.show(...)` / `h.each(...)`, the
  // compiler treats the call as if it were a bare import call.
  const viewHelperNames = collectViewHelperNames(sourceFile, lluiImport)
  // Destructured aliases: `view: (_, { show, text: t }) => [...]` → { show→show, t→text }.
  const viewHelperAliases = collectViewHelperAliases(sourceFile, lluiImport, viewHelperNames)

  // Track which helpers were compiled vs bailed out
  const compiledHelpers = new Set<string>()
  const bailedHelpers = new Set<string>()
  let usesElTemplate = false
  let usesElSplit = false
  let usesMemo = false
  let usesApplyBinding = false

  const f = ts.factory
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

  // Collect source positions of transformed nodes for source mapping
  const edits: TransformEdit[] = []

  function visitor(node: ts.Node): ts.Node {
    // Synthetic nodes (created by ts.factory) don't have real positions
    const hasPos = node.pos >= 0 && node.end >= 0
    const origStart = hasPos ? node.getStart(sourceFile) : -1
    const origEnd = hasPos ? node.getEnd() : -1

    // Pass 0: each() optimizations — dedup item() selectors + auto-wrap items in memo
    if (
      ts.isCallExpression(node) &&
      isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)
    ) {
      let current: ts.CallExpression = node
      let changed = false
      const memoWrapped = tryWrapEachItemsWithMemo(current, fieldBits, f)
      if (memoWrapped) {
        current = memoWrapped
        changed = true
        usesMemo = true
      }
      const deduped = tryDeduplicateItemSelectors(current, f, printer, sourceFile)
      if (deduped) {
        current = deduped
        changed = true
      }
      // Inject __mask for Phase 1 gating
      const masked = tryInjectStructuralMask(
        current,
        viewHelperNames,
        viewHelperAliases,
        fieldBits,
        f,
      )
      if (masked) {
        current = masked
        changed = true
      }
      if (changed) {
        const result = ts.visitEachChild(current, visitor, undefined!)
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        // Row factory: try after children are transformed
        if (ts.isCallExpression(result)) {
          try {
            const rf = tryEmitRowFactory(result, f, source)
            if (rf) return rf
          } catch (err) {
            const line = ts.getLineAndCharacterOfPosition(sourceFile, result.getStart())
            console.warn(
              `[llui] Row factory failed in ${_filename}:${line.line + 1} — ${(err as Error).message}`,
            )
          }
        }
        return result
      }
    }

    // Pass 1: Transform element helper calls to elSplit or elTemplate
    if (ts.isCallExpression(node)) {
      const transformed = tryTransformElementCall(
        node,
        importedHelpers,
        fieldBits,
        compiledHelpers,
        bailedHelpers,
        f,
      )
      if (transformed) {
        if (ts.isIdentifier(transformed.expression)) {
          if (transformed.expression.text === 'elTemplate') usesElTemplate = true
          else if (transformed.expression.text === 'elSplit') usesElSplit = true
        }
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        return ts.visitEachChild(transformed, visitor, undefined!)
      }

      // Pass 2: Inject mask into text() calls
      const textTransformed = tryInjectTextMask(
        node,
        lluiImport,
        viewHelperNames,
        viewHelperAliases,
        fieldBits,
        f,
      )
      if (textTransformed) {
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        return textTransformed
      }

      // Inject __mask into each()/branch()/show() options for Phase 1 gating
      const structuralMasked = tryInjectStructuralMask(
        node,
        viewHelperNames,
        viewHelperAliases,
        fieldBits,
        f,
      )
      if (structuralMasked) {
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        return ts.visitEachChild(structuralMasked, visitor, undefined!)
      }
    }

    // Pass 2: Inject __dirty, __update, and __msgSchema into component() calls
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      let result = tryInjectDirty(node, fieldBits, f)
      if (result) usesApplyBinding = true
      if (devMode) {
        const schema = extractMsgSchema(source)
        if (schema) {
          result = injectMsgSchema(result ?? node, schema, f)
        }
        const stateSchema = extractStateSchema(source)
        if (stateSchema) {
          result = injectStateSchema(result ?? node, stateSchema.fields, f)
        }
        const effectSchema = extractEffectSchema(source)
        if (effectSchema) {
          result = injectEffectSchema(result ?? node, effectSchema, f)
        }
        result = injectComponentMeta(result ?? node, node, sourceFile, _filename, f)
      }
      if (result) {
        if (hasPos) edits.push({ start: origStart, end: origEnd, replacement: '' })
        return ts.visitEachChild(result, visitor, undefined!)
      }
    }

    return ts.visitEachChild(node, visitor, undefined!)
  }

  let transformed = ts.visitNode(sourceFile, visitor) as ts.SourceFile

  // Pass 3: Clean up imports — use the old cleanupImports approach
  // which operates on the transformed SourceFile safely
  const safeToRemove = new Set([...compiledHelpers].filter((h) => !bailedHelpers.has(h)))
  transformed = cleanupImports(
    transformed,
    lluiImport,
    importedHelpers,
    safeToRemove,
    usesElSplit,
    usesElTemplate,
    usesMemo,
    usesApplyBinding,
    f,
  )

  if (edits.length === 0) return null

  // Find component declarations for HMR
  const componentDecls = devMode ? findComponentDeclarations(sourceFile, lluiImport) : []

  // Build per-statement edits by comparing original vs transformed.
  // Only emit edits for statements that actually changed.
  // Untouched code keeps its original positions → accurate source maps.
  const finalEdits: TransformEdit[] = []
  const origStmts = sourceFile.statements
  const xfStmts = transformed.statements

  for (let i = 0; i < origStmts.length && i < xfStmts.length; i++) {
    const origStart = origStmts[i]!.getStart(sourceFile)
    const origEnd = origStmts[i]!.getEnd()
    const origText = source.slice(origStart, origEnd)

    let xfText: string
    try {
      xfText = printer.printNode(ts.EmitHint.Unspecified, xfStmts[i]!, transformed)
    } catch {
      // Synthetic nodes may fail to print individually — fall back to full reprint
      const { top: _top, bottom: _bottom } = devMode
        ? generateDevCode(componentDecls, mcpPort)
        : { top: '', bottom: '' }
      const output =
        (_top ? _top + '\n' : '') + printer.printFile(transformed) + (_bottom ? '\n' + _bottom : '')
      return { output, edits: [{ start: 0, end: source.length, replacement: output }] }
    }

    // Compare ignoring trailing semicolons and whitespace (printer adds them)
    const origNorm = origText.trim().replace(/;$/, '')
    const xfNorm = xfText.trim().replace(/;$/, '')
    if (origNorm !== xfNorm) {
      // Match the original style: if the original didn't end with a semicolon,
      // strip the one the printer added
      const origHasSemi = origText.trimEnd().endsWith(';')
      const replacement = origHasSemi ? xfText : xfText.replace(/;(\s*)$/, '$1')
      finalEdits.push({ start: origStart, end: origEnd, replacement })
    }
  }

  // Dev setup: enable* must run BEFORE user's mountApp (top of file),
  // but import.meta.hot.accept needs to reference user's component vars
  // (bottom of file). So split the injection.
  if (devMode) {
    const { top, bottom } = generateDevCode(componentDecls, mcpPort)
    if (top) finalEdits.push({ start: 0, end: 0, replacement: top + '\n' })
    if (bottom)
      finalEdits.push({ start: source.length, end: source.length, replacement: '\n' + bottom })
  }

  if (finalEdits.length === 0) return null

  // Build the full output by applying edits (for backward compat)
  const sorted = [...finalEdits].sort((a, b) => b.start - a.start)
  let output = source
  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  }

  return { output, edits: finalEdits }
}

// ── HMR ──────────────────────────────────────────────────────────

function generateDevCode(
  components: Array<{ varName: string; componentName: string }>,
  mcpPort: number | null,
): { top: string; bottom: string } {
  if (components.length === 0) {
    return {
      top: '',
      bottom: `if (import.meta.hot) {\n  import.meta.hot.accept()\n}`,
    }
  }

  const relayImport = mcpPort !== null ? ', startRelay as __startRelay' : ''
  const relayCall = mcpPort !== null ? `\n__startRelay(${mcpPort})` : ''

  const top = `
import { enableHmr as __enableHmr, replaceComponent as __replaceComponent } from '@llui/dom/hmr'
import { enableDevTools as __enableDevTools${relayImport} } from '@llui/dom/devtools'
__enableHmr()
__enableDevTools()${relayCall}
`.trim()

  const replaceCalls = components
    .map(({ varName, componentName }) => `      __replaceComponent("${componentName}", ${varName})`)
    .join('\n')

  // HMR auto-connect: when the Vite plugin detects that @llui/mcp's
  // active marker file exists or appears, it sends `llui:mcp-ready`
  // with the MCP bridge port. We forward that to __lluiConnect so the
  // browser connects automatically — no console gymnastics, no retry
  // spam, regardless of whether MCP or Vite started first.
  const mcpHmrHandler =
    mcpPort !== null
      ? `
  import.meta.hot.on('llui:mcp-ready', (data) => {
    if (typeof globalThis.__lluiConnect === 'function') {
      globalThis.__lluiConnect(data?.port)
    }
  })`
      : ''

  const bottom = `
if (import.meta.hot) {
  import.meta.hot.accept(() => {
${replaceCalls}
  })${mcpHmrHandler}
}
`.trim()

  return { top, bottom }
}

/** Find all component() calls and extract the variable name and component name */
function findComponentDeclarations(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
): Array<{ varName: string; componentName: string }> {
  const result: Array<{ varName: string; componentName: string }> = []

  function visit(node: ts.Node): void {
    // Match: const Foo = component({ name: 'Foo', ... })
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isComponentCall(node.initializer, lluiImport)
    ) {
      const varName = node.name.text
      const config = node.initializer.arguments[0]
      if (config && ts.isObjectLiteralExpression(config)) {
        for (const prop of config.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'name' &&
            ts.isStringLiteral(prop.initializer)
          ) {
            result.push({ varName, componentName: prop.initializer.text })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return result
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

function hasComponentDef(sf: ts.SourceFile, lluiImport: ts.ImportDeclaration): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/**
 * Scan for `component({ view: (h) => ... })` arrow functions and collect
 * the identifier name used as the View-bundle parameter. When the user
 * writes `h.show(...)` / `h.text(...)` inside the view, the compiler treats
 * it the same as bare `show(...)` / `text(...)` for mask injection.
 */
function collectViewHelperNames(sf: ts.SourceFile, lluiImport: ts.ImportDeclaration): Set<string> {
  const names = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'view' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            const params = prop.initializer.parameters
            if (params.length >= 1) {
              const first = params[0]!
              if (ts.isIdentifier(first.name)) {
                names.add(first.name.text)
              }
            }
          }
        }
      }
    }
    // Also: any function parameter annotated as `View<...>` — covers extracted
    // view-functions like `function repoPage(h: View<State, Msg>, ...)`.
    if (
      ts.isParameter(node) &&
      node.type &&
      isViewTypeReference(node.type) &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function isViewTypeReference(t: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === 'View'
}

/**
 * Scan for `component({ view: ({ show, each, text, ... }) => ... })`
 * destructured parameters and return a map from the locally-bound name to
 * the primitive name it aliases. This lets users write the bare `show(...)` /
 * `text(...)` forms without importing them, while the compiler still
 * applies mask injection etc.
 *
 *     view: ({ show, text: t }) => [...]
 *     // returns { show → "show", t → "text" }
 */
const VIEW_HELPER_PRIMITIVES = new Set([
  'show',
  'branch',
  'scope',
  'each',
  'text',
  'memo',
  'sample',
  'selector',
  'ctx',
  'slice',
  'send',
])

function collectViewHelperAliases(
  sf: ts.SourceFile,
  lluiImport: ts.ImportDeclaration,
  helperNames: Set<string>,
): Map<string, string> {
  const aliases = new Map<string, string>()
  function addFromBindingPattern(pattern: ts.ObjectBindingPattern): void {
    for (const elem of pattern.elements) {
      // { show } → propertyName=undefined, name=show
      // { show: mySh } → propertyName=show, name=mySh
      const sourceName =
        elem.propertyName && ts.isIdentifier(elem.propertyName)
          ? elem.propertyName.text
          : ts.isIdentifier(elem.name)
            ? elem.name.text
            : null
      const localName = ts.isIdentifier(elem.name) ? elem.name.text : null
      if (sourceName && localName && VIEW_HELPER_PRIMITIVES.has(sourceName)) {
        aliases.set(localName, sourceName)
      }
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isComponentCall(node, lluiImport)) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'view' &&
            (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
          ) {
            const params = prop.initializer.parameters
            if (params.length >= 1) {
              const first = params[0]!
              if (ts.isObjectBindingPattern(first.name)) {
                addFromBindingPattern(first.name)
              }
            }
          }
        }
      }
    }
    // Also: function parameters like `(…, { show, text }: View<State, Msg>) => …`
    // on extracted helpers — allow the same destructuring ergonomics.
    if (
      ts.isParameter(node) &&
      node.type &&
      isViewTypeReference(node.type) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      addFromBindingPattern(node.name)
    }
    // Also: `const { show, text } = h` assignments where `h` is a known
    // helper binding — lets helpers destructure once at the top of the
    // function body.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      helperNames.has(node.initializer.text)
    ) {
      addFromBindingPattern(node.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return aliases
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

  // Handle children-only overload: `div([...])` — first arg is the children array.
  // Normalize to props=undefined, children=firstArg so downstream logic works.
  const firstArg = node.arguments[0]
  const usesChildrenOnlyOverload = firstArg && ts.isArrayLiteralExpression(firstArg)
  const propsArg = usesChildrenOnlyOverload ? undefined : firstArg
  if (propsArg && !ts.isObjectLiteralExpression(propsArg)) {
    bailed.add(localName)
    return null
  }
  // Bail on spread assignments (`...parts.root`) — the compiler cannot
  // statically classify spread contents, and silently dropping them would
  // break consumers (e.g. @llui/components parts spreading). Fall back to
  // the runtime element helper so spreads are applied normally.
  if (
    propsArg &&
    ts.isObjectLiteralExpression(propsArg) &&
    propsArg.properties.some((p) => ts.isSpreadAssignment(p))
  ) {
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
        events.push(f.createArrayLiteralExpression([f.createStringLiteral(eventName), value]))
        continue
      }

      // If the value is an Identifier that refers to a local const-bound
      // arrow/function, resolve it and treat it as if the arrow had been
      // inlined. Without this, `class: cls` where `const cls = (s) => ...`
      // falls through to the static path and emits `.className = cls`,
      // coercing the function to its source string in the DOM.
      if (ts.isIdentifier(value)) {
        const resolved = resolveLocalConstInitializer(value)
        if (resolved && (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved))) {
          value = resolved
        }
      }

      // Reactive binding — value is an arrow function or function expression
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, readsState } = computeAccessorMask(value, fieldBits)

        // Zero-mask constant folding: accessor doesn't read state → treat as static
        if (mask === 0 && !readsState) {
          emitStaticProp(
            staticProps,
            f,
            kind,
            resolvedKey,
            f.createCallExpression(value, undefined, []),
          )
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

      // Per-item property access: item.field — equivalent to item(t => t.field)
      // Also matches hoisted __a0/__a1/… identifiers produced by dedup pass.
      if (isPerItemFieldAccess(value) || isHoistedPerItem(value)) {
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

  const eventsArr = events.length > 0 ? f.createArrayLiteralExpression(events) : f.createNull()

  const bindingsArr =
    bindings.length > 0 ? f.createArrayLiteralExpression(bindings) : f.createNull()

  const children = usesChildrenOnlyOverload
    ? node.arguments[0]!
    : (node.arguments[1] ?? f.createNull())

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

/**
 * Match a call expression against a primitive name across all three binding
 * forms:
 *   - bare imported identifier: `name(...)` where `name` was imported from @llui/dom
 *   - destructured alias: `name(...)` where `name` is bound via
 *     `view: (_, { name }) => ...` (or `{ name: alias }`)
 *   - member call: `<h>.name(...)` where `<h>` is the 2nd view parameter
 *
 * The compiler treats all three identically for mask injection / each()
 * optimization purposes.
 */
function isHelperCall(
  expr: ts.Expression,
  name: string,
  helperNames: Set<string>,
  aliases?: Map<string, string>,
): boolean {
  if (ts.isIdentifier(expr)) {
    if (expr.text === name) return true
    if (aliases && aliases.get(expr.text) === name) return true
    return false
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    helperNames.has(expr.expression.text) &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === name
  ) {
    return true
  }
  return false
}

function tryInjectTextMask(
  node: ts.CallExpression,
  lluiImport: ts.ImportDeclaration,
  viewHelperNames: Set<string>,
  viewHelperAliases: Map<string, string>,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  if (!isHelperCall(node.expression, 'text', viewHelperNames, viewHelperAliases)) {
    return null
  }

  // For a bare identifier `text`, verify it actually resolves to the @llui/dom
  // import (otherwise a user-defined `text` in scope would be rewritten).
  // Destructured-alias and member-expression forms are already provenance-safe.
  if (ts.isIdentifier(node.expression) && !viewHelperAliases.has(node.expression.text)) {
    const clause = lluiImport.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return null
    const hasText = clause.namedBindings.elements.some(
      (s) => s.name.text === 'text' || s.propertyName?.text === 'text',
    )
    if (!hasText) return null
  }

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

/**
 * Inject `__mask` into the options object of each()/branch()/show() calls.
 *
 * Analyzes the driving accessor (`items` for each, `on` for branch, `when`
 * for show) and computes the bitmask of state fields it reads. The runtime
 * uses this to skip Phase 1 reconciliation when irrelevant state changed
 * (e.g., each() that reads `rows` is skipped when only `selected` changed).
 */
function tryInjectStructuralMask(
  node: ts.CallExpression,
  viewHelperNames: Set<string>,
  viewHelperAliases: Map<string, string>,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  if (fieldBits.size === 0) return null

  // Match each(), branch(), scope(), show() — bare, aliased, or member-call
  const isEach = isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)
  const isBranch = isHelperCall(node.expression, 'branch', viewHelperNames, viewHelperAliases)
  const isScope = isHelperCall(node.expression, 'scope', viewHelperNames, viewHelperAliases)
  const isShow = isHelperCall(node.expression, 'show', viewHelperNames, viewHelperAliases)
  if (!isEach && !isBranch && !isScope && !isShow) return null

  const optsArg = node.arguments[0]
  if (!optsArg || !ts.isObjectLiteralExpression(optsArg)) return null

  // Already has __mask
  for (const prop of optsArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__mask'
    ) {
      return null
    }
  }

  // Find the driving accessor property: items / on / when
  //   each → 'items', branch/scope → 'on', show → 'when'
  const driverProp = isEach ? 'items' : isBranch || isScope ? 'on' : 'when'
  let driverAccessor: ts.ArrowFunction | ts.FunctionExpression | null = null
  for (const prop of optsArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === driverProp
    ) {
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        driverAccessor = prop.initializer
      }
      break
    }
  }

  if (!driverAccessor) return null

  const { mask } = computeAccessorMask(driverAccessor, fieldBits)
  if (mask === 0 || mask === (0xffffffff | 0)) return null // no benefit

  // Inject __mask into the options object
  const maskProp = f.createPropertyAssignment('__mask', createMaskLiteral(f, mask))
  const newProps = [...optsArg.properties, maskProp]
  const newOpts = f.createObjectLiteralExpression(newProps, optsArg.properties.hasTrailingComma)
  return f.createCallExpression(node.expression, node.typeArguments, [
    newOpts,
    ...node.arguments.slice(1),
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
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__dirty'
    ) {
      return null
    }
  }

  // Build __dirty: (o, n) => (Object.is(o.field, n.field) ? 0 : bit) | ...
  // Compare at top-level field (depth 1) — nested path changes within a
  // field must trigger the bit even if the specific sub-path isn't tracked.
  // e.g., route.page tracked but route.data changes → must fire.
  const topLevelBits = new Map<string, number>()
  for (const [path, bit] of fieldBits) {
    const topField = path.split('.')[0]!
    topLevelBits.set(topField, (topLevelBits.get(topField) ?? 0) | bit)
  }

  const comparisons: ts.Expression[] = []
  for (const [field, bit] of topLevelBits) {
    const oAccess = buildAccess(f, 'o', [field])
    const nAccess = buildAccess(f, 'n', [field])

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
          createMaskLiteral(f, bit),
        ),
      ),
    )
  }

  let dirtyBody: ts.Expression = comparisons[0]!
  for (let i = 1; i < comparisons.length; i++) {
    dirtyBody = f.createBinaryExpression(dirtyBody, ts.SyntaxKind.BarToken, comparisons[i]!)
  }

  // Fallback: if no tracked bit fired but the state reference changed, some
  // untracked field must have changed — return FULL_MASK so bindings whose
  // accessors came from external modules (spread parts) still fire.
  //   tracked || (Object.is(o, n) ? 0 : FULL_MASK)
  const fallback = f.createParenthesizedExpression(
    f.createConditionalExpression(
      f.createCallExpression(
        f.createPropertyAccessExpression(f.createIdentifier('Object'), 'is'),
        undefined,
        [f.createIdentifier('o'), f.createIdentifier('n')],
      ),
      f.createToken(ts.SyntaxKind.QuestionToken),
      f.createNumericLiteral(0),
      f.createToken(ts.SyntaxKind.ColonToken),
      createMaskLiteral(f, -1),
    ),
  )
  dirtyBody = f.createBinaryExpression(
    f.createParenthesizedExpression(dirtyBody),
    ts.SyntaxKind.BarBarToken,
    fallback,
  )

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

  // __maskLegend: maps each top-level state field to the bit(s) that fire when
  // it changes. Lets introspection tools decode runtime dirty masks to field names.
  const legendProps: ts.PropertyAssignment[] = []
  for (const [field, bit] of topLevelBits) {
    legendProps.push(f.createPropertyAssignment(field, createMaskLiteral(f, bit)))
  }
  const legendProp = f.createPropertyAssignment(
    '__maskLegend',
    f.createObjectLiteralExpression(legendProps, false),
  )

  // Structural mask — used by both __update and __handlers
  const structuralMask = computeStructuralMask(configArg, fieldBits)
  const phase2Mask = computePhase2Mask(configArg, fieldBits)

  const updateBody = buildUpdateBody(f, structuralMask, phase2Mask)
  const updateFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 's'),
      f.createParameterDeclaration(undefined, undefined, 'd'),
      f.createParameterDeclaration(undefined, undefined, 'b'),
      f.createParameterDeclaration(undefined, undefined, 'bl'),
      f.createParameterDeclaration(undefined, undefined, 'p'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    updateBody,
  )
  const updateProp = f.createPropertyAssignment('__update', updateFn)

  // __handlers: per-message-type specialized update functions.
  // Analyzes the update() switch/case and generates direct handlers
  // that bypass the generic Phase 1/2 pipeline for single-message updates.
  const handlersProp = tryBuildHandlers(configArg, topLevelBits, structuralMask, f)

  // Keep __update even when __handlers is present — it provides Phase 1
  // mask gating for multi-message batches that bypass __handlers.
  const extraProps = [dirtyProp, legendProp, updateProp]
  if (handlersProp) extraProps.push(handlersProp)

  const newConfig = f.createObjectLiteralExpression([...configArg.properties, ...extraProps], true)

  return f.createCallExpression(node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

/**
 * Analyze update() switch/case and generate per-message-type handlers.
 *
 * Each handler receives (inst, msg) and returns [newState, effects].
 * The handler calls update() to get the new state, then directly invokes
 * the appropriate runtime primitives (reconcileItems, __directUpdate, etc.)
 * instead of going through the generic Phase 1/2 pipeline.
 *
 * Conservative: only generates handlers for cases where the field
 * modifications are statically determinable. Complex cases are skipped.
 */
function tryBuildHandlers(
  configArg: ts.ObjectLiteralExpression,
  topLevelBits: Map<string, number>,
  structuralMask: number,
  f: ts.NodeFactory,
): ts.PropertyAssignment | null {
  if (topLevelBits.size === 0) return null

  // Find the update function in the component config
  let updateFn: ts.ArrowFunction | ts.FunctionExpression | null = null
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'update'
    ) {
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        updateFn = prop.initializer
      }
      break
    }
  }
  if (!updateFn) return null

  // Find the switch statement in the update body
  const body = ts.isBlock(updateFn.body) ? updateFn.body : null
  if (!body) return null

  let switchStmt: ts.SwitchStatement | null = null
  for (const stmt of body.statements) {
    if (ts.isSwitchStatement(stmt)) {
      switchStmt = stmt
      break
    }
  }
  if (!switchStmt) return null

  // Check the switch discriminant is msg.type pattern
  const stateParam = updateFn.parameters[0]?.name
  const msgParam = updateFn.parameters[1]?.name
  if (!stateParam || !msgParam || !ts.isIdentifier(stateParam) || !ts.isIdentifier(msgParam))
    return null
  const stateName = stateParam.text
  const _msgName = msgParam.text

  // Analyze each case clause
  const handlers: ts.PropertyAssignment[] = []

  for (const clause of switchStmt.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue

    // Extract the case label — must be a string literal like 'select'
    if (!ts.isStringLiteral(clause.expression)) continue
    const msgType = clause.expression.text

    // Collect ALL return [newState, effects] statements recursively from the
    // case body. Multiple returns (from if/else branches) must all be analyzed
    // so the handler's dirty mask covers every possible modified field.
    const returnExprs: ts.ArrayLiteralExpression[] = []
    const collectReturns = (node: ts.Node): void => {
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        ts.isArrayLiteralExpression(node.expression) &&
        node.expression.elements.length >= 2
      ) {
        returnExprs.push(node.expression)
        return
      }
      // Don't descend into nested functions — their returns are unrelated.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return
      }
      ts.forEachChild(node, collectReturns)
    }
    for (const stmt of clause.statements) {
      collectReturns(stmt)
    }
    if (returnExprs.length === 0) continue

    // Union modified fields across all return paths.
    const allModified = new Set<string>()
    let bailOut = false
    for (const returnExpr of returnExprs) {
      const stateExpr = returnExpr.elements[0]!
      const fields = analyzeModifiedFields(stateExpr, stateName, topLevelBits)
      if (!fields) {
        bailOut = true
        break
      }
      for (const f of fields) allModified.add(f)
    }
    if (bailOut) continue // at least one return path was too complex

    const modifiedFields = Array.from(allModified)

    // Compute the dirty mask for this case
    let caseDirty = 0
    for (const field of modifiedFields) {
      caseDirty |= topLevelBits.get(field) ?? 0xffffffff | 0
    }

    // Detect array operation pattern for structural block optimization
    const arrayOp = detectArrayOp(clause, stateName, modifiedFields, structuralMask, caseDirty)

    const handler = buildCaseHandler(f, caseDirty, arrayOp)
    handlers.push(f.createPropertyAssignment(f.createStringLiteral(msgType), handler))
  }

  if (handlers.length === 0) return null

  return f.createPropertyAssignment('__handlers', f.createObjectLiteralExpression(handlers, true))
}

type ArrayOp =
  | 'none'
  | 'clear'
  | 'mutate'
  | 'remove'
  | 'general'
  | { type: 'strided'; stride: number } // for (i = 0; i < len; i += stride) pattern

/**
 * Detect the array operation pattern in a case body.
 * - 'none': no array field modified (e.g., only `selected` changes)
 * - 'clear': array set to empty literal `[]`
 * - 'mutate': array created via `.slice()` then mutated in place (same keys)
 * - 'general': unknown pattern, use generic reconcile
 */
function detectArrayOp(
  clause: ts.CaseClause,
  stateName: string,
  modifiedFields: string[],
  _structuralMask?: number,
  _caseDirty?: number,
): ArrayOp {
  // No fields modified → no Phase 1 needed (no bindings can care if no
  // state field changed). Safe to return 'none' here because it's a
  // tautology: every binding mask ANDed with zero is zero.
  if (modifiedFields.length === 0) return 'none'

  // Previously: if `(structuralMask & caseDirty) === 0`, return 'none'
  // on the theory that no structural block's mask could intersect this
  // case's dirty bits. That optimization was UNSAFE: `computeStructuralMask`
  // only walks the view function's lexical AST and does not descend into
  // helper function calls. A view like
  //
  //     view: () => [
  //       ...show({ when: s => s.mode === 'signin', render: () => [signinFormBody()] }),
  //     ]
  //
  // where `signinFormBody()` is a helper that internally does
  //     ...show({ when: s => s.errors.email !== undefined, ... })
  //
  // produces a `structuralMask` that covers `mode` but MISSES
  // `errors.email`. At runtime the inner show block is still registered
  // in `inst.structuralBlocks`, and it legitimately needs to reconcile
  // when `errors` changes — but the compiler was emitting `method = -1`
  // (skip blocks entirely) for cases that only touch `errors`, and the
  // error paragraphs would never mount.
  //
  // The fix is to remove this short-circuit. Phase 1 runs unconditionally
  // when any field is modified; `_handleMsg`'s per-block check
  // `if (!(block.mask & dirty)) continue` filters out uninterested
  // blocks at near-zero cost. We lose a micro-optimization but gain
  // correctness for every component that factors view helpers into
  // functions — which is the idiomatic pattern.

  // Look at the return expression's array field values
  for (const stmt of clause.statements) {
    const returnExpr = findReturnArray(stmt)
    if (!returnExpr) continue

    const stateExpr = returnExpr.elements[0]
    if (!stateExpr || !ts.isObjectLiteralExpression(stateExpr)) continue

    for (const prop of stateExpr.properties) {
      const name =
        ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isShorthandPropertyAssignment(prop)
            ? prop.name.text
            : null
      if (!name) continue

      // Check for empty array literal: `field: []`
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isArrayLiteralExpression(prop.initializer) &&
        prop.initializer.elements.length === 0
      ) {
        return 'clear'
      }

      // Check for shorthand `field` where field was assigned via `.slice()` earlier
      // This catches: `const rows = state.rows.slice(); rows[i] = ...; return { ...state, rows }`
      if (ts.isShorthandPropertyAssignment(prop)) {
        const varName = prop.name.text
        if (hasSliceAssignment(clause, stateName, varName)) {
          // Check for strided for-loop: for (let i = 0; i < arr.length; i += STRIDE)
          const stride = detectStrideLoop(clause, varName)
          if (stride > 1) return { type: 'strided', stride }
          return 'mutate'
        }
      }

      // Check for property assignment with filter: `field: state.field.filter(...)`
      if (ts.isPropertyAssignment(prop) && ts.isCallExpression(prop.initializer)) {
        const call = prop.initializer
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === 'filter'
        ) {
          return 'remove'
        }
      }
    }
  }

  return 'general'
}

function findReturnArray(stmt: ts.Statement): ts.ArrayLiteralExpression | null {
  if (ts.isReturnStatement(stmt) && stmt.expression && ts.isArrayLiteralExpression(stmt.expression))
    return stmt.expression
  if (ts.isBlock(stmt)) {
    for (const inner of stmt.statements) {
      const result = findReturnArray(inner)
      if (result) return result
    }
  }
  return null
}

/**
 * Detect a strided for-loop: `for (let i = 0; i < arr.length; i += STRIDE)`
 * where `arr` is the named variable. Returns the stride or 0 if not found.
 */
function detectStrideLoop(clause: ts.CaseClause, _arrName: string): number {
  function walk(node: ts.Node): number {
    if (ts.isForStatement(node) && node.incrementor) {
      // Check incrementor: i += STRIDE
      const inc = node.incrementor
      if (
        ts.isBinaryExpression(inc) &&
        inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
        ts.isNumericLiteral(inc.right)
      ) {
        const stride = parseInt(inc.right.text, 10)
        if (stride > 1) return stride
      }
    }
    return ts.forEachChild(node, walk) ?? 0
  }
  for (const stmt of clause.statements) {
    const result = walk(stmt)
    if (result > 0) return result
  }
  return 0
}

function hasSliceAssignment(clause: ts.CaseClause, stateName: string, varName: string): boolean {
  function walk(node: ts.Node): boolean {
    // Look for: const varName = stateName.field.slice()
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer
    ) {
      const init = node.initializer
      if (
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === 'slice'
      ) {
        return true
      }
    }
    return ts.forEachChild(node, walk) ?? false
  }
  for (const stmt of clause.statements) {
    if (walk(stmt)) return true
  }
  return false
}

/**
 * Analyze which top-level state fields are modified in a return expression.
 * Returns the set of field names, or null if too complex to determine.
 */
function analyzeModifiedFields(
  stateExpr: ts.Expression,
  stateName: string,
  topLevelBits: Map<string, number>,
): string[] | null {
  // Pattern: { ...state, field1: ..., field2: ... } or { field1: ..., field2: ... }
  if (ts.isObjectLiteralExpression(stateExpr)) {
    const modified: string[] = []
    for (const prop of stateExpr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        // Only `...state` is safe to ignore — re-spreading state back into
        // state doesn't change any field's identity. ANY other spread
        // (e.g. `...msg.props`, `...someObj`) can overwrite arbitrary
        // top-level fields with new references, and we cannot know which
        // ones statically. Bail out so the generic Phase 2 path runs
        // `__dirty` at runtime and produces a correct mask.
        if (ts.isIdentifier(prop.expression) && prop.expression.text === stateName) {
          continue
        }
        return null
      }
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const fieldName = prop.name.text
        if (topLevelBits.has(fieldName)) {
          modified.push(fieldName)
        }
      }
      // Handle shorthand: { ...state, rows } where rows is a local variable
      if (ts.isShorthandPropertyAssignment(prop)) {
        const fieldName = prop.name.text
        if (topLevelBits.has(fieldName)) {
          modified.push(fieldName)
        }
      }
    }
    return modified.length > 0 ? modified : null
  }

  // Pattern: state (no change — early return)
  if (ts.isIdentifier(stateExpr) && stateExpr.text === stateName) {
    return [] // no fields modified
  }

  return null // too complex
}

/**
 * Build a handler function for a specific message type case.
 *
 * Generated: (inst, msg) => {
 *   const [s, e] = inst.def.update(inst.state, msg)
 *   inst.state = s
 *   const bl = inst.structuralBlocks, b = inst.allBindings, p = b.length
 *   // Phase 1: gated by caseDirty
 *   for (let i = 0; i < bl.length; i++) {
 *     if (bl[i].mask & caseDirty) bl[i].reconcile(s, caseDirty)
 *   }
 *   // Phase 2
 *   __runPhase2(s, caseDirty, b, p)
 *   return [s, e]
 * }
 */
/**
 * Build a handler that delegates to __handleMsg(inst, msg, dirty, method).
 * method: 0=reconcile, 1=reconcileItems, 2=reconcileClear, 3=reconcileRemove, -1=skip blocks
 */
function buildCaseHandler(
  f: ts.NodeFactory,
  caseDirty: number,
  arrayOp: ArrayOp,
): ts.ArrowFunction {
  const method =
    typeof arrayOp === 'object' && arrayOp.type === 'strided'
      ? 10 + arrayOp.stride // reconcileChanged with stride
      : arrayOp === 'none'
        ? -1
        : arrayOp === 'mutate'
          ? 1
          : arrayOp === 'clear'
            ? 2
            : arrayOp === 'remove'
              ? 3
              : 0 // general

  // (inst, msg) => __handleMsg(inst, msg, dirty, method)
  return f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'inst'),
      f.createParameterDeclaration(undefined, undefined, 'msg'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createCallExpression(f.createIdentifier('__handleMsg'), undefined, [
      f.createIdentifier('inst'),
      f.createIdentifier('msg'),
      createMaskLiteral(f, caseDirty),
      method >= 0
        ? f.createNumericLiteral(method)
        : f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(1)),
    ]),
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _deadCode_legacyCaseHandler(
  f: ts.NodeFactory,
  caseDirty: number,
  arrayOp: ArrayOp,
): ts.ArrowFunction {
  const stmts: ts.Statement[] = []

  // const [s, e] = inst.def.update(inst.state, msg)
  stmts.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            f.createArrayBindingPattern([
              f.createBindingElement(undefined, undefined, 's'),
              f.createBindingElement(undefined, undefined, 'e'),
            ]),
            undefined,
            undefined,
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(f.createIdentifier('inst'), 'def'),
                'update',
              ),
              undefined,
              [
                f.createPropertyAccessExpression(f.createIdentifier('inst'), 'state'),
                f.createIdentifier('msg'),
              ],
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  // inst.state = s
  stmts.push(
    f.createExpressionStatement(
      f.createBinaryExpression(
        f.createPropertyAccessExpression(f.createIdentifier('inst'), 'state'),
        ts.SyntaxKind.EqualsToken,
        f.createIdentifier('s'),
      ),
    ),
  )

  // Phase 1 + Phase 2, specialized by array operation pattern
  if (caseDirty !== 0) {
    // Determine the reconcile method based on array operation
    const reconcileMethod =
      arrayOp === 'clear'
        ? 'reconcileClear'
        : arrayOp === 'mutate'
          ? 'reconcileItems'
          : arrayOp === 'remove'
            ? 'reconcileRemove'
            : 'reconcile'

    if (arrayOp === 'none') {
      // No structural changes — skip Phase 1, only run Phase 2
      // (e.g., select: only selector binding needs updating)
    } else {
      // Phase 1: call specialized reconciler on matching blocks
      // const bl = inst.structuralBlocks
      stmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                'bl',
                undefined,
                undefined,
                f.createPropertyAccessExpression(f.createIdentifier('inst'), 'structuralBlocks'),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
      )

      // for (let i = 0; i < bl.length; i++) { if (bl[i].mask & dirty) bl[i].METHOD(s, dirty) }
      const blockEl = f.createElementAccessExpression(
        f.createIdentifier('bl'),
        f.createIdentifier('i'),
      )
      const reconcileArgs =
        reconcileMethod === 'reconcileClear'
          ? []
          : [
              f.createIdentifier('s'),
              ...(reconcileMethod === 'reconcile' ? [createMaskLiteral(f, caseDirty)] : []),
            ]

      stmts.push(
        f.createForStatement(
          f.createVariableDeclarationList(
            [f.createVariableDeclaration('i', undefined, undefined, f.createNumericLiteral(0))],
            ts.NodeFlags.Let,
          ),
          f.createBinaryExpression(
            f.createIdentifier('i'),
            ts.SyntaxKind.LessThanToken,
            f.createPropertyAccessExpression(f.createIdentifier('bl'), 'length'),
          ),
          f.createPostfixUnaryExpression(f.createIdentifier('i'), ts.SyntaxKind.PlusPlusToken),
          f.createBlock(
            [
              f.createIfStatement(
                f.createBinaryExpression(
                  f.createPropertyAccessExpression(blockEl, 'mask'),
                  ts.SyntaxKind.AmpersandToken,
                  createMaskLiteral(f, caseDirty),
                ),
                f.createExpressionStatement(
                  f.createCallExpression(
                    // Use specialized method if available, fall back to reconcile
                    // bl[i].reconcileItems?.(s) ?? bl[i].reconcile(s, dirty)
                    // Simplified: just call the method — it exists on each() blocks
                    f.createPropertyAccessExpression(blockEl, reconcileMethod),
                    undefined,
                    reconcileArgs as ts.Expression[],
                  ),
                ),
              ),
            ],
            true,
          ),
        ),
      )
    }

    // Phase 2: compact + update bindings
    // const b = inst.allBindings, p = b.length
    stmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              'b',
              undefined,
              undefined,
              f.createPropertyAccessExpression(f.createIdentifier('inst'), 'allBindings'),
            ),
            f.createVariableDeclaration(
              'p',
              undefined,
              undefined,
              f.createPropertyAccessExpression(f.createIdentifier('b'), 'length'),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )

    // __runPhase2(s, caseDirty, b, p)
    stmts.push(
      f.createExpressionStatement(
        f.createCallExpression(f.createIdentifier('__runPhase2'), undefined, [
          f.createIdentifier('s'),
          createMaskLiteral(f, caseDirty),
          f.createIdentifier('b'),
          f.createIdentifier('p'),
        ]),
      ),
    )
  }

  // return [s, e]
  stmts.push(
    f.createReturnStatement(
      f.createArrayLiteralExpression([f.createIdentifier('s'), f.createIdentifier('e')]),
    ),
  )

  return f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'inst'),
      f.createParameterDeclaration(undefined, undefined, 'msg'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(stmts, true),
  )
}

// ── Row Factory ─────────────────────────────────────────────────

/**
 * Transform an eligible each() render to use a row factory — shared update
 * function with zero per-row closures for bindings.
 *
 * Runs AFTER the element transform pass has converted tr/td/text() calls
 * into elTemplate() calls, so we can analyze the template structure.
 */
function tryEmitRowFactory(
  eachCall: ts.CallExpression,
  f: ts.NodeFactory,
  _originalSource: string,
): ts.CallExpression | null {
  const arg = eachCall.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null

  // Find render property
  let renderProp: ts.PropertyAssignment | null = null
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'render'
    ) {
      renderProp = prop
      break
    }
  }
  if (!renderProp) return null

  const renderFn = renderProp.initializer
  if (!ts.isArrowFunction(renderFn) && !ts.isFunctionExpression(renderFn)) return null
  const body = ts.isBlock(renderFn.body) ? renderFn.body : null
  if (!body) return null

  // Find the elTemplate call in the transformed render body
  let templateCall: ts.CallExpression | null = null
  let templateVarName: string | null = null

  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer)
        ) {
          if (
            ts.isIdentifier(decl.initializer.expression) &&
            decl.initializer.expression.text === 'elTemplate'
          ) {
            if (templateCall) return null // multiple templates — bail
            templateCall = decl.initializer
            templateVarName = decl.name.text
          }
        }
      }
    }
    // Check for nested structural primitives — bail
    if (containsStructuralCall(stmt)) return null
    // Bail on selector.bind() — row factory + selector causes V8 deopt
    // even without per-row disposers (selector fn declarations per render)
    if (_containsSelectorBind(stmt)) return null
  }

  if (!templateCall || templateCall.arguments.length < 2) return null

  // Extract HTML string
  const htmlArg = templateCall.arguments[0]
  if (!htmlArg || !ts.isStringLiteral(htmlArg)) return null
  const html = htmlArg.text

  // Extract patch function
  const patchFn = templateCall.arguments[1]
  if (!patchFn || (!ts.isArrowFunction(patchFn) && !ts.isFunctionExpression(patchFn))) return null
  const patchBody = ts.isBlock(patchFn.body) ? patchFn.body : null
  if (!patchBody) return null

  const rootParam = patchFn.parameters[0]
  const bindParam = patchFn.parameters[1]
  if (!rootParam || !bindParam) return null
  const rootName = ts.isIdentifier(rootParam.name) ? rootParam.name.text : null
  const bindName = ts.isIdentifier(bindParam.name) ? bindParam.name.text : null
  if (!rootName || !bindName) return null

  // Extract bindings from patch function
  interface RowBinding {
    nodeInitializer: ts.Expression // the node path expression (e.g., root.firstChild)
    kind: string
    key: string | undefined
    accessor: ts.Expression
  }
  const bindings: RowBinding[] = []
  const nodeVarInitializers = new Map<string, ts.Expression>()

  for (const stmt of patchBody.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          nodeVarInitializers.set(decl.name.text, decl.initializer)
        }
      }
    }

    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === bindName &&
        call.arguments.length >= 5
      ) {
        const nodeArg = call.arguments[0]!
        const maskArg = call.arguments[1]!
        const kindArg = call.arguments[2]!
        const keyArg = call.arguments[3]!
        const accessorArg = call.arguments[4]!

        // Must be per-item (mask -1)
        if (ts.isPrefixUnaryExpression(maskArg) && maskArg.operator === ts.SyntaxKind.MinusToken) {
          // -1 → per-item ✓
        } else if (ts.isBinaryExpression(maskArg)) {
          // -1 | 0 or 4294967295 | 0 → per-item ✓
        } else {
          return null // state-level binding — bail
        }

        const kind = ts.isStringLiteral(kindArg) ? kindArg.text : ''
        const key = ts.isStringLiteral(keyArg) ? keyArg.text : undefined

        // Resolve node path — recursively expand variable references to get
        // the full path from root, then create fresh factory nodes
        function resolveNodePath(expr: ts.Expression): ts.Expression {
          if (ts.isIdentifier(expr)) {
            if (expr.text === rootName) return f.createIdentifier(rootName)
            const init = nodeVarInitializers.get(expr.text)
            if (init) return resolveNodePath(init)
            return f.createIdentifier(expr.text)
          }
          if (ts.isPropertyAccessExpression(expr)) {
            return f.createPropertyAccessExpression(
              resolveNodePath(expr.expression),
              expr.name.text,
            )
          }
          if (ts.isElementAccessExpression(expr)) {
            return f.createElementAccessExpression(
              resolveNodePath(expr.expression),
              expr.argumentExpression,
            )
          }
          return expr
        }
        const nodeInit = resolveNodePath(nodeArg)

        // Clone accessor to strip source position — prevents mixed-position errors
        const clonedAccessor = ts.isIdentifier(accessorArg)
          ? f.createIdentifier(accessorArg.text)
          : accessorArg
        bindings.push({ nodeInitializer: nodeInit, kind, key, accessor: clonedAccessor })
      }
    }
  }

  if (bindings.length === 0) return null

  // Build map of __a{N} → __s{N} for rewriting accessor references.
  // After dedup, `__a{N} = acc(__s{N})`. In the row factory, __a{N} declarations
  // are eliminated, so all references must be rewritten to __s{N}.
  const accToSelector = new Map<string, string>()
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.name.text.startsWith('__a')) continue
      if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
      const callArg0 = decl.initializer.arguments[0]
      if (callArg0 && ts.isIdentifier(callArg0) && callArg0.text.startsWith('__s')) {
        accToSelector.set(decl.name.text, callArg0.text)
      }
    }
  }

  // Rewrite binding accessors: __a{N} → __s{N}
  for (const b of bindings) {
    if (ts.isIdentifier(b.accessor) && accToSelector.has(b.accessor.text)) {
      b.accessor = f.createIdentifier(accToSelector.get(b.accessor.text)!)
    }
  }

  // Collect __s{N} selector definitions — needed by __rowUpd and render init.
  // These are currently scoped to the render body; we'll hoist them into the
  // __rowUpd IIFE so they're accessible.
  const selectorDefs = new Map<string, ts.Expression>()
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text.startsWith('__s') && decl.initializer) {
        selectorDefs.set(decl.name.text, decl.initializer)
      }
    }
  }

  // === Generate the row factory ===

  // 1. __tpl: IIFE that creates + caches the template element
  const tplInit = f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock(
          [
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    't',
                    undefined,
                    undefined,
                    f.createCallExpression(
                      f.createPropertyAccessExpression(
                        f.createIdentifier('document'),
                        'createElement',
                      ),
                      undefined,
                      [f.createStringLiteral('template')],
                    ),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
            f.createExpressionStatement(
              f.createBinaryExpression(
                f.createPropertyAccessExpression(f.createIdentifier('t'), 'innerHTML'),
                ts.SyntaxKind.EqualsToken,
                f.createStringLiteral(html),
              ),
            ),
            f.createReturnStatement(f.createIdentifier('t')),
          ],
          true,
        ),
      ),
    ),
    undefined,
    [],
  )

  // 2. __rowUpd: (e) => { const t = e.current; for each binding: check + write }
  const updStmts: ts.Statement[] = []
  updStmts.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            't',
            undefined,
            undefined,
            f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!
    const vId = f.createIdentifier(`v${i}`)
    const cachedProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_v${i}`),
    )
    const nodeProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_n${i}`),
    )

    // const v{i} = accessor(t)
    updStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              vId,
              undefined,
              undefined,
              f.createCallExpression(b.accessor, undefined, [f.createIdentifier('t')]),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )

    // DOM write expression
    const domWrite =
      b.kind === 'text'
        ? f.createBinaryExpression(
            f.createPropertyAccessExpression(nodeProp, 'nodeValue'),
            ts.SyntaxKind.EqualsToken,
            vId,
          )
        : b.kind === 'class'
          ? f.createBinaryExpression(
              f.createPropertyAccessExpression(nodeProp, 'className'),
              ts.SyntaxKind.EqualsToken,
              vId,
            )
          : f.createBinaryExpression(
              f.createPropertyAccessExpression(nodeProp, 'nodeValue'),
              ts.SyntaxKind.EqualsToken,
              vId,
            )

    // if (v{i} !== e['_v{i}']) { e['_v{i}'] = v{i}; DOM_WRITE }
    updStmts.push(
      f.createIfStatement(
        f.createBinaryExpression(vId, ts.SyntaxKind.ExclamationEqualsEqualsToken, cachedProp),
        f.createBlock(
          [
            f.createExpressionStatement(
              f.createBinaryExpression(cachedProp, ts.SyntaxKind.EqualsToken, vId),
            ),
            f.createExpressionStatement(domWrite),
          ],
          true,
        ),
      ),
    )
  }

  // Wrap __rowUpd in IIFE that declares selectors (they're scoped to the
  // render body but __rowUpd lives on the options object outside render).
  const rawUpdFn = f.createArrowFunction(
    undefined,
    undefined,
    [f.createParameterDeclaration(undefined, undefined, 'e')],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(updStmts, true),
  )

  // Build: (() => { const __s0 = ...; const __s1 = ...; return (e) => { ... } })()
  const selectorDecls: ts.Statement[] = []
  for (const [name, init] of selectorDefs) {
    selectorDecls.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(name, undefined, undefined, init)],
          ts.NodeFlags.Const,
        ),
      ),
    )
  }
  selectorDecls.push(f.createReturnStatement(rawUpdFn))

  const rowUpdFn = f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock(selectorDecls, true),
      ),
    ),
    undefined,
    [],
  )

  // 3. New render callback: ({ entry: e, __tpl, __rowUpd }) => { ... }
  const renderStmts: ts.Statement[] = []

  // Declare selectors at the top of render body (they're used for initial values)
  for (const [name, init] of selectorDefs) {
    renderStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(name, undefined, undefined, init)],
          ts.NodeFlags.Const,
        ),
      ),
    )
  }

  // const r = __tpl.content.firstElementChild.cloneNode(true)
  renderStmts.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            'r',
            undefined,
            undefined,
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(
                  f.createPropertyAccessExpression(f.createIdentifier('__tpl'), 'content'),
                  'firstElementChild',
                ),
                'cloneNode',
              ),
              undefined,
              [f.createTrue()],
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  // For each binding: store node ref, compute initial, apply
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!
    const nProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_n${i}`),
    )
    const vProp = f.createElementAccessExpression(
      f.createIdentifier('e'),
      f.createStringLiteral(`_v${i}`),
    )

    // Rewrite node path: replace root param name with 'r'
    const rewrittenPath = rewriteRoot(b.nodeInitializer, rootName, 'r', f)

    // e['_n{i}'] = rewrittenPath
    renderStmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(nProp, ts.SyntaxKind.EqualsToken, rewrittenPath),
      ),
    )

    // e['_v{i}'] = accessor(e.current)
    renderStmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          vProp,
          ts.SyntaxKind.EqualsToken,
          f.createCallExpression(b.accessor, undefined, [
            f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
          ]),
        ),
      ),
    )

    // DOM write: e['_n{i}'].nodeValue = e['_v{i}']
    const initWrite =
      b.kind === 'text'
        ? f.createBinaryExpression(
            f.createPropertyAccessExpression(nProp, 'nodeValue'),
            ts.SyntaxKind.EqualsToken,
            vProp,
          )
        : b.kind === 'class'
          ? f.createBinaryExpression(
              f.createPropertyAccessExpression(nProp, 'className'),
              ts.SyntaxKind.EqualsToken,
              vProp,
            )
          : f.createBinaryExpression(
              f.createPropertyAccessExpression(nProp, 'nodeValue'),
              ts.SyntaxKind.EqualsToken,
              vProp,
            )
    renderStmts.push(f.createExpressionStatement(initWrite))
  }

  // e.__rowUpdate = __rowUpd
  renderStmts.push(
    f.createExpressionStatement(
      f.createBinaryExpression(
        f.createPropertyAccessExpression(f.createIdentifier('e'), '__rowUpdate'),
        ts.SyntaxKind.EqualsToken,
        f.createIdentifier('__rowUpd'),
      ),
    ),
  )

  // Rewrite a statement: replace __a{N}() → __s{N}(e.current),
  // replace template var → r, strip positions via deep clone.
  function rewriteStmt(stmt: ts.Statement): ts.Statement {
    function visit(node: ts.Node): ts.Node {
      // Rewrite __a{N}() → __s{N}(e.current)
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        accToSelector.has(node.expression.text) &&
        node.arguments.length === 0
      ) {
        const selectorName = accToSelector.get(node.expression.text)!
        return f.createCallExpression(f.createIdentifier(selectorName), undefined, [
          f.createPropertyAccessExpression(f.createIdentifier('e'), 'current'),
        ])
      }
      // Rewrite template variable → r
      if (ts.isIdentifier(node) && templateVarName && node.text === templateVarName) {
        return f.createIdentifier('r')
      }
      // Clone identifiers to strip positions
      if (ts.isIdentifier(node)) {
        return f.createIdentifier(node.text)
      }
      return ts.visitEachChild(node, visit, undefined!)
    }
    return ts.visitEachChild(stmt, visit, undefined!) as ts.Statement
  }

  // Preserve non-template, non-compiler-generated, non-return statements.
  for (const stmt of body.statements) {
    if (ts.isReturnStatement(stmt)) continue

    if (ts.isVariableStatement(stmt)) {
      // Skip template declaration
      const isTemplate = stmt.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === templateVarName,
      )
      if (isTemplate) continue
      // Skip __a{N} and __s{N} declarations (compiler-generated acc/selector)
      const isCompilerOnly = stmt.declarationList.declarations.every(
        (d) =>
          ts.isIdentifier(d.name) &&
          (d.name.text.startsWith('__a') || d.name.text.startsWith('__s')),
      )
      if (isCompilerOnly) continue
    }

    // Rewrite and include
    renderStmts.push(rewriteStmt(stmt))
  }

  // return [r]
  renderStmts.push(
    f.createReturnStatement(f.createArrayLiteralExpression([f.createIdentifier('r')])),
  )

  const newRenderFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(
        undefined,
        undefined,
        f.createObjectBindingPattern([
          f.createBindingElement(undefined, 'entry', 'e'),
          f.createBindingElement(undefined, undefined, '__tpl'),
          f.createBindingElement(undefined, undefined, '__rowUpd'),
        ]),
      ),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(renderStmts, true),
  )

  // 4. Build new each options. To avoid mixed-position AST issues, we keep
  // original properties unchanged and only ADD __tpl, __rowUpd, and replace render.
  // The trick: return the original node structure but with the render property
  // swapped. Use ts.factory.updateObjectLiteralExpression which preserves positions.
  const updatedProps = arg.properties.map(
    (p): ts.ObjectLiteralElementLike =>
      p === renderProp ? f.createPropertyAssignment('render', newRenderFn) : p,
  )
  updatedProps.push(f.createPropertyAssignment('__tpl', tplInit))
  updatedProps.push(f.createPropertyAssignment('__rowUpd', rowUpdFn))

  const newOpts = f.updateObjectLiteralExpression(arg, updatedProps)

  return f.updateCallExpression(eachCall, eachCall.expression, eachCall.typeArguments, [
    newOpts,
    ...eachCall.arguments.slice(1),
  ])
}

function _containsSelectorBind(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'bind'
  ) {
    return true
  }
  return ts.forEachChild(node, _containsSelectorBind) ?? false
}

function containsStructuralCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    if (['each', 'branch', 'scope', 'show', 'child', 'foreign'].includes(node.expression.text))
      return true
  }
  return ts.forEachChild(node, containsStructuralCall) ?? false
}

/** Rewrite property access chains replacing oldRoot identifier with newRoot */
function rewriteRoot(
  expr: ts.Expression,
  oldRoot: string,
  newRoot: string,
  f: ts.NodeFactory,
): ts.Expression {
  if (ts.isIdentifier(expr) && expr.text === oldRoot) return f.createIdentifier(newRoot)
  if (ts.isPropertyAccessExpression(expr)) {
    return f.createPropertyAccessExpression(
      rewriteRoot(expr.expression, oldRoot, newRoot, f),
      expr.name.text,
    )
  }
  if (ts.isElementAccessExpression(expr)) {
    return f.createElementAccessExpression(
      rewriteRoot(expr.expression, oldRoot, newRoot, f),
      expr.argumentExpression,
    )
  }
  return expr
}

/** Parse a statement string into a fresh AST node (no source positions) */
function _parseStmt(code: string): ts.Statement | null {
  const sf = ts.createSourceFile('__gen.ts', code, ts.ScriptTarget.Latest, false)
  return (sf.statements[0] as ts.Statement | undefined) ?? null
}

/**
 * Compute the OR of all structural block masks found in the view function.
 * Returns FULL_MASK if any structural block uses FULL_MASK or if no blocks found.
 */
function computeStructuralMask(
  configArg: ts.ObjectLiteralExpression,
  fieldBits: Map<string, number>,
): number {
  const viewProp = configArg.properties.find(
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'view',
  )
  if (!viewProp || !ts.isPropertyAssignment(viewProp)) return 0xffffffff | 0

  let mask = 0
  let foundStructural = false

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ''
      if (['each', 'branch', 'scope', 'show'].includes(name) && node.arguments[0]) {
        foundStructural = true
        const opts = node.arguments[0]
        if (ts.isObjectLiteralExpression(opts)) {
          // Check for __mask property (already injected by tryInjectStructuralMask)
          for (const prop of opts.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === '__mask'
            ) {
              if (ts.isNumericLiteral(prop.initializer)) {
                mask |= parseInt(prop.initializer.text, 10)
                return
              }
              if (ts.isPrefixUnaryExpression(prop.initializer)) {
                // Handle negative literals like -1
                mask = 0xffffffff | 0
                return
              }
            }
          }
          // No __mask found — use driving accessor mask
          const driverProp = name === 'each' ? 'items' : name === 'branch' ? 'on' : 'when'
          for (const prop of opts.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === driverProp
            ) {
              if (
                ts.isArrowFunction(prop.initializer) ||
                ts.isFunctionExpression(prop.initializer)
              ) {
                const { mask: m } = computeAccessorMask(prop.initializer, fieldBits)
                mask |= m || 0xffffffff | 0
              }
              break
            }
          }
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(viewProp.initializer)
  return foundStructural ? mask || 0xffffffff | 0 : 0
}

/**
 * Compute the OR of all component-level binding masks from text() calls
 * and element bindings in the view. Returns 0 if no component-level bindings.
 */
function computePhase2Mask(
  _configArg: ts.ObjectLiteralExpression,
  _fieldBits: Map<string, number>,
): number {
  // For now, return FULL_MASK — a future pass can analyze all binding sites
  // in the view to compute the precise aggregate. The key optimization is
  // already in Phase 1 gating: when structuralMask doesn't intersect dirty,
  // the entire reconciliation is skipped.
  return 0xffffffff | 0
}

/**
 * Build the __update function body:
 * {
 *   // Phase 1 — structural reconciliation (gated by structuralMask)
 *   if (d & structuralMask) {
 *     for (let i = 0; i < bl.length; i++) {
 *       const bk = bl[i]
 *       if (!bk || (bk.mask & d) === 0) continue
 *       bk.reconcile(s, d)
 *     }
 *     // Compact dead bindings
 *     if (b.length > p || (p > 0 && b[0].dead)) {
 *       let w = 0
 *       for (let r = 0; r < b.length; r++) { if (!b[r].dead) b[w++] = b[r] }
 *       b.length = w
 *       p = Math.min(w, p)
 *     }
 *   }
 *   // Phase 2 — binding updates
 *   if (d !== 0) {
 *     for (let i = 0; i < p; i++) {
 *       const bn = b[i]
 *       if (bn.dead || (bn.mask & d) === 0) continue
 *       const v = bn.accessor(s)
 *       const l = bn.lastValue
 *       if (v === l || (v !== v && l !== l)) continue
 *       bn.lastValue = v
 *       __runPhase2(s, d, b, p)
 *     }
 *   }
 * }
 */
function buildUpdateBody(f: ts.NodeFactory, structuralMask: number, _phase2Mask: number): ts.Block {
  const stmts: ts.Statement[] = []

  // Phase 1: structural block reconciliation, gated by aggregate mask
  if (structuralMask !== 0) {
    const phase1Stmts: ts.Statement[] = []

    // for (let i = 0; i < bl.length; i++) {
    //   const bk = bl[i];
    //   if (!bk || (bk.mask & d) === 0) continue;
    //   bk.reconcile(s, d)
    // }
    // Re-read bl.length each iteration and null-check bk — a branch's
    // reconcile may dispose the old scope, whose disposers splice child
    // structural blocks out of this shared array mid-iteration.
    const blockLoop = f.createForStatement(
      f.createVariableDeclarationList(
        [f.createVariableDeclaration('i', undefined, undefined, f.createNumericLiteral(0))],
        ts.NodeFlags.Let,
      ),
      f.createBinaryExpression(
        f.createIdentifier('i'),
        ts.SyntaxKind.LessThanToken,
        f.createPropertyAccessExpression(f.createIdentifier('bl'), 'length'),
      ),
      f.createPostfixUnaryExpression(f.createIdentifier('i'), ts.SyntaxKind.PlusPlusToken),
      f.createBlock(
        [
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  'bk',
                  undefined,
                  undefined,
                  f.createElementAccessExpression(
                    f.createIdentifier('bl'),
                    f.createIdentifier('i'),
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          f.createIfStatement(
            f.createBinaryExpression(
              f.createPrefixUnaryExpression(
                ts.SyntaxKind.ExclamationToken,
                f.createIdentifier('bk'),
              ),
              ts.SyntaxKind.BarBarToken,
              f.createBinaryExpression(
                f.createParenthesizedExpression(
                  f.createBinaryExpression(
                    f.createPropertyAccessExpression(f.createIdentifier('bk'), 'mask'),
                    ts.SyntaxKind.AmpersandToken,
                    f.createIdentifier('d'),
                  ),
                ),
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                f.createNumericLiteral(0),
              ),
            ),
            f.createContinueStatement(),
          ),
          f.createExpressionStatement(
            f.createCallExpression(
              f.createPropertyAccessExpression(f.createIdentifier('bk'), 'reconcile'),
              undefined,
              [f.createIdentifier('s'), f.createIdentifier('d')],
            ),
          ),
        ],
        true,
      ),
    )
    phase1Stmts.push(blockLoop)

    // Compaction: if (b.length > p || (p > 0 && b[0].dead)) { ... }
    const compactBody = f.createBlock(
      [
        // let w = 0
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration('w', undefined, undefined, f.createNumericLiteral(0))],
            ts.NodeFlags.Let,
          ),
        ),
        // for (let r = 0; r < b.length; r++) { if (!b[r].dead) b[w++] = b[r] }
        f.createForStatement(
          f.createVariableDeclarationList(
            [f.createVariableDeclaration('r', undefined, undefined, f.createNumericLiteral(0))],
            ts.NodeFlags.Let,
          ),
          f.createBinaryExpression(
            f.createIdentifier('r'),
            ts.SyntaxKind.LessThanToken,
            f.createPropertyAccessExpression(f.createIdentifier('b'), 'length'),
          ),
          f.createPostfixUnaryExpression(f.createIdentifier('r'), ts.SyntaxKind.PlusPlusToken),
          f.createBlock(
            [
              f.createIfStatement(
                f.createPrefixUnaryExpression(
                  ts.SyntaxKind.ExclamationToken,
                  f.createPropertyAccessExpression(
                    f.createElementAccessExpression(
                      f.createIdentifier('b'),
                      f.createIdentifier('r'),
                    ),
                    'dead',
                  ),
                ),
                f.createExpressionStatement(
                  f.createBinaryExpression(
                    f.createElementAccessExpression(
                      f.createIdentifier('b'),
                      f.createPostfixUnaryExpression(
                        f.createIdentifier('w'),
                        ts.SyntaxKind.PlusPlusToken,
                      ),
                    ),
                    ts.SyntaxKind.EqualsToken,
                    f.createElementAccessExpression(
                      f.createIdentifier('b'),
                      f.createIdentifier('r'),
                    ),
                  ),
                ),
              ),
            ],
            true,
          ),
        ),
        // b.length = w
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('b'), 'length'),
            ts.SyntaxKind.EqualsToken,
            f.createIdentifier('w'),
          ),
        ),
        // p = Math.min(w, p)
        f.createExpressionStatement(
          f.createBinaryExpression(
            f.createIdentifier('p'),
            ts.SyntaxKind.EqualsToken,
            f.createCallExpression(
              f.createPropertyAccessExpression(f.createIdentifier('Math'), 'min'),
              undefined,
              [f.createIdentifier('w'), f.createIdentifier('p')],
            ),
          ),
        ),
      ],
      true,
    )

    const compactCondition = f.createBinaryExpression(
      f.createBinaryExpression(
        f.createPropertyAccessExpression(f.createIdentifier('b'), 'length'),
        ts.SyntaxKind.GreaterThanToken,
        f.createIdentifier('p'),
      ),
      ts.SyntaxKind.BarBarToken,
      f.createParenthesizedExpression(
        f.createBinaryExpression(
          f.createBinaryExpression(
            f.createIdentifier('p'),
            ts.SyntaxKind.GreaterThanToken,
            f.createNumericLiteral(0),
          ),
          ts.SyntaxKind.AmpersandAmpersandToken,
          f.createPropertyAccessExpression(
            f.createElementAccessExpression(f.createIdentifier('b'), f.createNumericLiteral(0)),
            'dead',
          ),
        ),
      ),
    )
    phase1Stmts.push(f.createIfStatement(compactCondition, compactBody))

    // Wrap Phase 1 in mask gate
    if (structuralMask !== (0xffffffff | 0)) {
      stmts.push(
        f.createIfStatement(
          f.createBinaryExpression(
            f.createParenthesizedExpression(
              f.createBinaryExpression(
                f.createIdentifier('d'),
                ts.SyntaxKind.AmpersandToken,
                createMaskLiteral(f, structuralMask),
              ),
            ),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            f.createNumericLiteral(0),
          ),
          f.createBlock(phase1Stmts, true),
        ),
      )
    } else {
      stmts.push(...phase1Stmts)
    }
  }

  // Phase 2: delegate to shared runtime — __runPhase2(s, d, b, p)
  stmts.push(
    f.createExpressionStatement(
      f.createCallExpression(f.createIdentifier('__runPhase2'), undefined, [
        f.createIdentifier('s'),
        f.createIdentifier('d'),
        f.createIdentifier('b'),
        f.createIdentifier('p'),
      ]),
    ),
  )

  return f.createBlock(stmts, true)
}

function buildAccess(f: ts.NodeFactory, root: string, parts: string[]): ts.Expression {
  let expr: ts.Expression = f.createIdentifier(root)
  for (const part of parts) {
    // Use optional chaining for nested paths
    if (parts.length > 1) {
      expr = f.createPropertyAccessChain(expr, f.createToken(ts.SyntaxKind.QuestionDotToken), part)
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
  usesMemo: boolean,
  usesApplyBinding: boolean,
  f: ts.NodeFactory,
): ts.SourceFile {
  if (compiled.size === 0 && !usesElTemplate && !usesElSplit && !usesMemo && !usesApplyBinding)
    return sf

  const clause = lluiImport.importClause
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return sf

  const remaining = clause.namedBindings.elements.filter((spec) => !compiled.has(spec.name.text))

  const hasElSplit = clause.namedBindings.elements.some((s) => s.name.text === 'elSplit')
  if (!hasElSplit && usesElSplit) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elSplit')))
  }

  const hasElTemplate = clause.namedBindings.elements.some((s) => s.name.text === 'elTemplate')
  if (!hasElTemplate && usesElTemplate) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('elTemplate')))
  }

  const hasMemo = clause.namedBindings.elements.some((s) => s.name.text === 'memo')
  if (!hasMemo && usesMemo) {
    remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('memo')))
  }

  if (usesApplyBinding) {
    if (!clause.namedBindings.elements.some((s) => s.name.text === '__runPhase2')) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('__runPhase2')))
    }
    if (!clause.namedBindings.elements.some((s) => s.name.text === '__handleMsg')) {
      remaining.push(f.createImportSpecifier(false, undefined, f.createIdentifier('__handleMsg')))
    }
  }

  const newBindings = f.createNamedImports(remaining)
  const newClause = f.createImportClause(false, undefined, newBindings)
  const newImportDecl = f.createImportDeclaration(undefined, newClause, lluiImport.moduleSpecifier)

  let replaced = false
  const statements = sf.statements.map((stmt) => {
    if (
      !replaced &&
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@llui/dom' &&
      !stmt.importClause?.isTypeOnly
    ) {
      replaced = true
      return newImportDecl
    }
    return stmt
  })

  return f.updateSourceFile(sf, statements as unknown as ts.Statement[])
}

// ── __msgSchema injection ────────────────────────────────────────

function injectStateSchema(
  node: ts.CallExpression,
  fields: Record<string, StateType>,
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return node

  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__stateSchema'
    ) {
      return node
    }
  }

  const schemaProp = f.createPropertyAssignment(
    '__stateSchema',
    stateTypeToLiteral({ kind: 'object', fields }, f),
  )
  const newConfig = f.createObjectLiteralExpression([...configArg.properties, schemaProp], true)

  return f.createCallExpression(node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

function stateTypeToLiteral(t: StateType, f: ts.NodeFactory): ts.Expression {
  if (typeof t === 'string') return f.createStringLiteral(t)
  if (t.kind === 'enum') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('enum')),
      f.createPropertyAssignment(
        'values',
        f.createArrayLiteralExpression(t.values.map((v) => f.createStringLiteral(v))),
      ),
    ])
  }
  if (t.kind === 'array') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('array')),
      f.createPropertyAssignment('of', stateTypeToLiteral(t.of, f)),
    ])
  }
  if (t.kind === 'optional') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('optional')),
      f.createPropertyAssignment('of', stateTypeToLiteral(t.of, f)),
    ])
  }
  if (t.kind === 'union') {
    return f.createObjectLiteralExpression([
      f.createPropertyAssignment('kind', f.createStringLiteral('union')),
      f.createPropertyAssignment(
        'of',
        f.createArrayLiteralExpression(t.of.map((m) => stateTypeToLiteral(m, f))),
      ),
    ])
  }
  // object
  const fieldProps: ts.PropertyAssignment[] = []
  for (const [k, v] of Object.entries(t.fields)) {
    fieldProps.push(f.createPropertyAssignment(k, stateTypeToLiteral(v, f)))
  }
  return f.createObjectLiteralExpression([
    f.createPropertyAssignment('kind', f.createStringLiteral('object')),
    f.createPropertyAssignment('fields', f.createObjectLiteralExpression(fieldProps, true)),
  ])
}

function injectComponentMeta(
  nodeWithMaybeEdits: ts.CallExpression,
  originalNode: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filename: string,
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = nodeWithMaybeEdits.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return nodeWithMaybeEdits

  // Don't inject if already present
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__componentMeta'
    ) {
      return nodeWithMaybeEdits
    }
  }

  // Line number from the original (real-position) node
  const pos = originalNode.pos >= 0 ? originalNode.getStart(sourceFile) : 0
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos)

  const meta = f.createObjectLiteralExpression(
    [
      f.createPropertyAssignment('file', f.createStringLiteral(filename)),
      f.createPropertyAssignment('line', f.createNumericLiteral(line + 1)),
    ],
    false,
  )

  const metaProp = f.createPropertyAssignment('__componentMeta', meta)
  const newConfig = f.createObjectLiteralExpression([...configArg.properties, metaProp], true)

  return f.createCallExpression(nodeWithMaybeEdits.expression, nodeWithMaybeEdits.typeArguments, [
    newConfig,
    ...nodeWithMaybeEdits.arguments.slice(1),
  ])
}

function injectMsgSchema(
  node: ts.CallExpression,
  schema: {
    discriminant: string
    variants: Record<string, Record<string, string | { enum: string[] }>>
  },
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return node

  // Don't inject if already present
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__msgSchema'
    ) {
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

  const schemaObj = f.createObjectLiteralExpression(
    [
      f.createPropertyAssignment('discriminant', f.createStringLiteral(schema.discriminant)),
      f.createPropertyAssignment('variants', f.createObjectLiteralExpression(variantProps, true)),
    ],
    true,
  )

  const schemaProp = f.createPropertyAssignment('__msgSchema', schemaObj)

  const newConfig = f.createObjectLiteralExpression([...configArg.properties, schemaProp], true)

  return f.createCallExpression(node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

function injectEffectSchema(
  node: ts.CallExpression,
  schema: {
    discriminant: string
    variants: Record<string, Record<string, string | { enum: string[] }>>
  },
  f: ts.NodeFactory,
): ts.CallExpression {
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return node

  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__effectSchema'
    ) {
      return node
    }
  }

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

  const schemaObj = f.createObjectLiteralExpression(
    [
      f.createPropertyAssignment('discriminant', f.createStringLiteral(schema.discriminant)),
      f.createPropertyAssignment('variants', f.createObjectLiteralExpression(variantProps, true)),
    ],
    true,
  )

  const schemaProp = f.createPropertyAssignment('__effectSchema', schemaObj)
  const newConfig = f.createObjectLiteralExpression([...configArg.properties, schemaProp], true)

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
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'render'
    ) {
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

  // Collect all item(selector) calls AND item.FIELD property-access expressions.
  // Both forms produce the same accessor; they dedup together via the field-name key.
  type Occurrence =
    | { kind: 'call'; node: ts.CallExpression; selector: ts.Expression; key: string }
    | { kind: 'access'; node: ts.PropertyAccessExpression; field: string; key: string }

  const occurrences: Occurrence[] = []

  // Try to extract a simple field name from an arrow selector: (t) => t.FIELD → "FIELD"
  function extractSimpleField(sel: ts.ArrowFunction | ts.FunctionExpression): string | null {
    if (sel.parameters.length !== 1) return null
    const paramName = sel.parameters[0]!.name
    if (!ts.isIdentifier(paramName)) return null
    const body = ts.isArrowFunction(sel) ? sel.body : null
    if (!body) return null
    const expr = ts.isBlock(body) ? null : body
    if (!expr || !ts.isPropertyAccessExpression(expr)) return null
    if (!ts.isIdentifier(expr.expression) || expr.expression.text !== paramName.text) return null
    if (!ts.isIdentifier(expr.name)) return null
    return expr.name.text
  }

  function collectItemCalls(node: ts.Node): void {
    // item(selector) calls
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === itemName &&
      node.arguments.length === 1
    ) {
      const sel = node.arguments[0]!
      if (ts.isArrowFunction(sel) || ts.isFunctionExpression(sel)) {
        const field = extractSimpleField(sel)
        const key =
          field !== null
            ? `field:${field}`
            : `expr:${printer.printNode(ts.EmitHint.Expression, sel, sourceFile)}`
        occurrences.push({ kind: 'call', node, selector: sel, key })
      }
    }
    // item.FIELD property access — but NOT when it's the callee of a call expression
    // where we want the original to stay (e.g. item.id() we still replace, because the
    // accessor itself becomes __a0 and we keep the trailing ()).
    else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === itemName &&
      ts.isIdentifier(node.name)
    ) {
      const field = node.name.text
      occurrences.push({ kind: 'access', node, field, key: `field:${field}` })
    }
    ts.forEachChild(node, collectItemCalls)
  }
  collectItemCalls(renderFn.body)

  if (occurrences.length < 2) return null // nothing to deduplicate

  // Group by normalized key (field:name or expr:text)
  const groups = new Map<string, Occurrence[]>()
  for (const occ of occurrences) {
    const existing = groups.get(occ.key)
    if (existing) existing.push(occ)
    else groups.set(occ.key, [occ])
  }

  // Hoist ALL occurrences (even unique ones) so compiled code uses `acc()` (plain
  // function) instead of `item(fn)` (Proxy-wrapped) or `item.FIELD` (Proxy.get trap).
  // Unique accesses get their own __a* var; duplicates share one.
  const allGroups = [...groups.entries()]
  if (allGroups.length === 0) return null

  // Build hoisted declarations and replacement map
  const hoistedStmts: ts.Statement[] = []
  const replacements = new Map<ts.Node, ts.Identifier>()
  let sIdx = 0

  for (const [key, occs] of allGroups) {
    const selVar = `__s${sIdx}`
    const accVar = `__a${sIdx}`
    sIdx++

    // Build the selector expression.
    // For field:FIELD, synthesize (t) => t.FIELD (or reuse an existing call's selector).
    // For expr:..., reuse the existing selector expression.
    let selector: ts.Expression
    const callOccurrence = occs.find((o) => o.kind === 'call')
    if (callOccurrence && callOccurrence.kind === 'call') {
      selector = callOccurrence.selector
    } else {
      // All occurrences are property-access form — synthesize (t) => t.FIELD
      const firstAccess = occs[0]!
      if (firstAccess.kind !== 'access') throw new Error('unreachable')
      selector = f.createArrowFunction(
        undefined,
        undefined,
        [f.createParameterDeclaration(undefined, undefined, 't')],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createPropertyAccessExpression(f.createIdentifier('t'), firstAccess.field),
      )
    }

    // const __s0 = (r) => r.id
    hoistedStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(selVar, undefined, undefined, selector)],
          ts.NodeFlags.Const,
        ),
      ),
    )
    // const __a0 = acc(__s0) — use the plain-function `acc` instead of `item` (which
    // is a Proxy). Adds `acc` to the destructure binding below if not already present.
    hoistedStmts.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              accVar,
              undefined,
              undefined,
              f.createCallExpression(f.createIdentifier('acc'), undefined, [
                f.createIdentifier(selVar),
              ]),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )

    // Map all occurrences to the cached accessor identifier
    void key // silence unused
    for (const occ of occs) {
      replacements.set(occ.node, f.createIdentifier(accVar))
    }
  }

  // Rewrite the render function body to replace item(sel)/item.field with cached refs
  function replaceVisitor(node: ts.Node): ts.Node {
    if (replacements.has(node)) {
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
    finalBody = f.createBlock(
      [...hoistedStmts, f.createReturnStatement(newBody as ts.Expression)],
      true,
    )
  }

  // Ensure `acc` is in the destructure binding pattern of the render param.
  // Hoisted code references it; if user didn't destructure it, add it.
  const newParameters = renderFn.parameters.map((p, idx) => {
    if (idx !== 0) return p
    if (!ts.isObjectBindingPattern(p.name)) return p
    const hasAcc = p.name.elements.some(
      (el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === 'acc',
    )
    if (hasAcc) return p
    const newBinding = f.createObjectBindingPattern([
      ...p.name.elements,
      f.createBindingElement(undefined, undefined, f.createIdentifier('acc')),
    ])
    return f.createParameterDeclaration(
      p.modifiers,
      p.dotDotDotToken,
      newBinding,
      p.questionToken,
      p.type,
      p.initializer,
    )
  })

  // Build new render function
  const newRenderFn = ts.isArrowFunction(renderFn)
    ? f.createArrowFunction(
        renderFn.modifiers,
        renderFn.typeParameters,
        newParameters,
        renderFn.type,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        finalBody,
      )
    : f.createFunctionExpression(
        renderFn.modifiers,
        renderFn.asteriskToken,
        renderFn.name,
        renderFn.typeParameters,
        newParameters,
        renderFn.type,
        finalBody as ts.Block,
      )

  // Rebuild the each() call with the new render property
  const newProps = arg.properties.map((prop) =>
    prop === renderProp ? f.createPropertyAssignment('render', newRenderFn) : prop,
  )
  const newArg = f.createObjectLiteralExpression(newProps, true)

  return f.createCallExpression(eachCall.expression, eachCall.typeArguments, [
    newArg,
    ...eachCall.arguments.slice(1),
  ])
}

// ── Auto-memoize each() items accessor ──────────────────────────

const ALLOCATING_METHODS = new Set([
  'filter',
  'map',
  'slice',
  'sort',
  'reverse',
  'concat',
  'flat',
  'flatMap',
  'reduce',
])

/**
 * Detect whether an expression body contains array-allocating operations
 * that would produce a new array on every call.
 */
function accessorAllocatesArray(body: ts.ConciseBody | ts.Expression): boolean {
  let found = false
  function walk(n: ts.Node): void {
    if (found) return
    // .method() on something — check the method name
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.name) &&
      ALLOCATING_METHODS.has(n.expression.name.text)
    ) {
      found = true
      return
    }
    // Spread in array literal: [...x, y]
    if (ts.isArrayLiteralExpression(n) && n.elements.some((el) => ts.isSpreadElement(el))) {
      found = true
      return
    }
    // Array.from(...)
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Array' &&
      ts.isIdentifier(n.expression.name) &&
      n.expression.name.text === 'from'
    ) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

/**
 * Wrap `each({ items: (s) => s.x.filter(...) })` in `memo()` with a bitmask,
 * so the filter is only re-run when its dependencies change. For items accessors
 * that don't allocate (e.g. `(s) => s.items`), each's built-in same-ref fast
 * path already suffices — no wrap needed.
 *
 * Returns null if no wrapping was applied.
 */
function tryWrapEachItemsWithMemo(
  eachCall: ts.CallExpression,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
): ts.CallExpression | null {
  const arg = eachCall.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null

  let itemsProp: ts.PropertyAssignment | null = null
  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'items') {
      itemsProp = prop
      break
    }
  }
  if (!itemsProp) return null

  const accessor = itemsProp.initializer
  if (!ts.isArrowFunction(accessor) && !ts.isFunctionExpression(accessor)) return null

  // Don't wrap if it's already wrapped (call expression like memo(...) or similar)
  // We only wrap raw arrow functions.

  // Skip if the body doesn't allocate — each's own ref check handles those.
  const body = ts.isArrowFunction(accessor) ? accessor.body : accessor.body
  if (!accessorAllocatesArray(body)) return null

  const { mask, readsState } = computeAccessorMask(accessor, fieldBits)
  if (mask === 0 && !readsState) return null // constant, nothing to memoize
  const finalMask = mask === 0 && readsState ? 0xffffffff | 0 : mask

  // Wrap: memo(accessor, mask)
  const wrapped = f.createCallExpression(f.createIdentifier('memo'), undefined, [
    accessor,
    createMaskLiteral(f, finalMask),
  ])

  const newProps = arg.properties.map((p) =>
    p === itemsProp ? f.createPropertyAssignment('items', wrapped) : p,
  )
  const newArg = f.createObjectLiteralExpression(newProps, true)

  return f.createCallExpression(eachCall.expression, eachCall.typeArguments, [
    newArg,
    ...eachCall.arguments.slice(1),
  ])
}

// ── Subtree collapse: nested elements → elTemplate ──────────────

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
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

  // Handle children-only overload: `div([...])` — first arg is the children array.
  // In that case, treat it as no props + children=firstArg.
  const firstArg = node.arguments[0]
  const usesChildrenOnlyOverload = firstArg && ts.isArrayLiteralExpression(firstArg)
  const propsArg = usesChildrenOnlyOverload ? undefined : firstArg
  const childrenArg = usesChildrenOnlyOverload ? firstArg : node.arguments[1]

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

      // Resolve identifier → local const arrow initializer (see elSplit
      // path for the full rationale).
      if (ts.isIdentifier(value)) {
        const resolved = resolveLocalConstInitializer(value)
        if (resolved && (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved))) {
          value = resolved
        }
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

      // Per-item property access: item.field (or hoisted __a0/__a1/…)
      if (isPerItemFieldAccess(value) || isHoistedPerItem(value)) {
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
  const children: AnalyzedChild[] = []

  if (childrenArg && ts.isArrayLiteralExpression(childrenArg)) {
    let childIdx = 0
    for (const child of childrenArg.elements) {
      // String literal child — static text node
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        children.push({ type: 'staticText', value: child.text })
        childIdx++
        continue
      }

      // text('literal') — static text
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === 'text'
      ) {
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
        // Per-item text via property access: text(item.label)
        // Also matches hoisted __a0/__a1/… identifiers produced by dedup.
        if (isPerItemFieldAccess(accessor) || isHoistedPerItem(accessor)) {
          children.push({
            type: 'reactiveText',
            accessor,
            mask: 0xffffffff | 0,
            childIdx,
          })
          childIdx++
          continue
        }
        return null // unsupported text() form
      }

      // Element helper call — recurse
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        helpers.has(child.expression.text)
      ) {
        const childNode = analyzeSubtree(child, helpers, fieldBits, [...path, childIdx])
        if (!childNode) return null
        children.push({ type: 'element', node: childNode })
        childIdx++
        continue
      }

      // Anything else (each, branch, show, arbitrary expressions) — bail
      return null
    }

    // Note: mixed static + reactive text in the same parent is now supported
    // because reactive text uses <!--$--> comment placeholders that break
    // text-node merging at parse time.
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

  for (let ci = 0; ci < node.children.length; ci++) {
    const child = node.children[ci]!
    if (child.type === 'staticText') {
      html += escapeHTML(child.value)
    } else if (child.type === 'element') {
      html += buildTemplateHTML(child.node)
    } else if (child.type === 'reactiveText') {
      // When the reactive text is not adjacent to another text-type child,
      // we can use a literal text node placeholder instead of a comment.
      // The cloned text node is reused in the patch function — no
      // createTextNode + replaceChild needed. This saves 2 DOM operations
      // per text binding per row.
      //
      // When adjacent text WOULD cause HTML-parser merging (two text nodes
      // collapse into one), we fall back to the comment placeholder.
      const prev = ci > 0 ? node.children[ci - 1]! : null
      const next = ci < node.children.length - 1 ? node.children[ci + 1]! : null
      const adjText =
        prev?.type === 'staticText' ||
        prev?.type === 'reactiveText' ||
        next?.type === 'staticText' ||
        next?.type === 'reactiveText'
      if (adjText) {
        html += '<!--$-->'
      } else {
        // Space character becomes a Text node in the cloned template.
        // Mark the child so the patch codegen knows to skip replaceChild.
        html += ' '
        ;(child as { inlineText?: boolean }).inlineText = true
      }
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
      reactiveTexts: node.children.filter(
        (c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText',
      ),
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
    // Use firstChild + nextSibling chain instead of childNodes[n]
    // firstChild/nextSibling are direct pointer lookups, childNodes is a live NodeList
    expr = f.createPropertyAccessExpression(expr, 'firstChild')
    for (let i = 0; i < idx; i++) {
      expr = f.createPropertyAccessExpression(expr, 'nextSibling')
    }
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
      varName: '', // use 'root' directly
      walkExpr: f.createIdentifier('root'),
      events: analyzed.events,
      bindings: analyzed.bindings,
      reactiveTexts: analyzed.children.filter(
        (c): c is Extract<AnalyzedChild, { type: 'reactiveText' }> => c.type === 'reactiveText',
      ),
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
    const nodeRef = op.varName ? f.createIdentifier(op.varName) : f.createIdentifier('root')

    // Variable declaration for walking to node
    if (op.varName) {
      stmts.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(op.varName, undefined, undefined, op.walkExpr)],
            ts.NodeFlags.Const,
          ),
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

    // Reactive text children — walk to placeholder, create text node, bind
    for (const rt of op.reactiveTexts) {
      const tVar = `__t${counter.t++}`
      const isInline = !!(rt as { inlineText?: boolean }).inlineText

      if (isInline) {
        // Inline text placeholder: the template HTML has a space character
        // that cloneNode already created as a Text node. Walk to it and
        // bind directly — no createTextNode, no replaceChild.
        let walk: ts.Expression = f.createPropertyAccessExpression(nodeRef, 'firstChild')
        for (let i = 0; i < rt.childIdx; i++) {
          walk = f.createPropertyAccessExpression(walk, 'nextSibling')
        }
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(tVar, undefined, undefined, walk)],
              ts.NodeFlags.Const,
            ),
          ),
        )
      } else {
        // Comment placeholder: create a new text node and replace the comment.
        const cVar = `__c${counter.t - 1}`
        let walk: ts.Expression = f.createPropertyAccessExpression(nodeRef, 'firstChild')
        for (let i = 0; i < rt.childIdx; i++) {
          walk = f.createPropertyAccessExpression(walk, 'nextSibling')
        }
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(cVar, undefined, undefined, walk)],
              ts.NodeFlags.Const,
            ),
          ),
        )
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  tVar,
                  undefined,
                  undefined,
                  f.createCallExpression(
                    f.createPropertyAccessExpression(
                      f.createIdentifier('document'),
                      'createTextNode',
                    ),
                    undefined,
                    [f.createStringLiteral('')],
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
        )
        stmts.push(
          f.createExpressionStatement(
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(f.createIdentifier(cVar), 'parentNode'),
                'replaceChild',
              ),
              undefined,
              [f.createIdentifier(tVar), f.createIdentifier(cVar)],
            ),
          ),
        )
      }
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
          f.createBlock(
            [
              f.createExpressionStatement(f.createCallExpression(handler, undefined, [eParam])),
              f.createReturnStatement(),
            ],
            true,
          ),
        ),
      )
    }

    const delegateHandler = f.createArrowFunction(
      undefined,
      undefined,
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

  const call = f.createCallExpression(f.createIdentifier('elTemplate'), undefined, [
    f.createStringLiteral(html),
    patchFn,
  ])

  return call
}

// ── Static subtree detection ─────────────────────────────────────

function isStaticChildren(children: ts.Expression): boolean {
  if (children.kind === ts.SyntaxKind.NullKeyword) return true
  if (!ts.isArrayLiteralExpression(children)) return false
  return children.elements.every((child) => {
    // text('literal') — static text
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'text'
    ) {
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
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === 'text'
      ) {
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
        f.createBlock(
          [
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [f.createVariableDeclaration(varName, undefined, undefined, tmplCreate)],
                ts.NodeFlags.Const,
              ),
            ),
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
          ],
          true,
        ),
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

// Matches: item.FIELD — the item-proxy shorthand equivalent of item(t => t.FIELD).
// Lifetime-checked: the `item` identifier must resolve to a parameter of an
// `each({ render })` callback. Without this check, plain
// `arr.map((item) => item.field)` outside each() would be rewritten as a
// per-item binding and crash at runtime with "accessor is not a function"
// because `item.field` evaluates to a bare value (not a function) when
// treated as an accessor.
function isPerItemFieldAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  if (!ts.isPropertyAccessExpression(node)) return false
  if (!ts.isIdentifier(node.expression)) return false
  if (node.expression.text !== 'item') return false
  if (!ts.isIdentifier(node.name)) return false
  return isItemBoundToEachRender(node)
}

/**
 * Walks up from a node and returns true iff the nearest enclosing function
 * that binds an `item` parameter is the `render` property of an `each()`
 * call. Handles both positional (`(item) => …`) and destructured
 * (`({ item, index }) => …`) parameter bindings.
 */
function isItemBoundToEachRender(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      if (functionParamsBindItem(current)) {
        return isEachRenderCallback(current)
      }
    }
    current = current.parent
  }
  return false
}

function functionParamsBindItem(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  for (const param of fn.parameters) {
    if (bindingNameBindsItem(param.name)) return true
  }
  return false
}

function bindingNameBindsItem(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === 'item'
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el) && bindingNameBindsItem(el.name)) return true
    }
  }
  return false
}

function isEachRenderCallback(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = fn.parent
  if (!parent || !ts.isPropertyAssignment(parent)) return false
  if (!ts.isIdentifier(parent.name) || parent.name.text !== 'render') return false
  const objLit = parent.parent
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return false
  const call = objLit.parent
  if (!call || !ts.isCallExpression(call)) return false
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'each') return false
  return true
}

// Matches the hoisted identifiers produced by tryDeduplicateItemSelectors: __a0, __a1, …
// These represent already-cached per-item accessors.
function isHoistedPerItem(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false
  return /^__a\d+$/.test(node.text)
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
    // `node.parent` can be undefined for synthetic nodes produced by
    // earlier AST-transform passes (the row-factory rewrite and the
    // per-item heuristic both build new sub-trees whose inner nodes
    // have no parent pointers). Guard every parent access below —
    // crashing the whole build on a perfectly valid reactive accessor
    // like `text((_s) => \`$${item.x.toLocaleString()}\`)` was how
    // this bug first surfaced in the persistent-layout example work.
    const parent = node.parent
    if (ts.isIdentifier(node) && node.text === stateParam && (!parent || !ts.isParameter(parent))) {
      readsState = true
    }
    if (ts.isPropertyAccessExpression(node)) {
      // When there's no parent we can't tell if this is the top of a
      // chain, so we resolve from here. That's still correct for mask
      // accounting: `resolveChain` on an inner PAE produces a prefix
      // of the outer chain, which maps to the same `fieldBits` bit
      // via the prefix-match loop below. Worst case we resolve the
      // same chain twice (`|=` is idempotent); best case we'd have
      // resolved once from the real top. Correctness unchanged.
      if (!parent || !ts.isPropertyAccessExpression(parent)) {
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
