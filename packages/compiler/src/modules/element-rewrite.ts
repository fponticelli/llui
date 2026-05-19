// `element-rewrite` — transforms `div(...)` / `button(...)` / etc.
// (every helper in `ELEMENT_HELPERS`) into `elSplit(...)` /
// `elTemplate(...)` / `__cloneStaticTemplate(...)` calls.
//
// The transform classifies each prop of the element call:
//   - Static literals → emit as a one-time `__e.prop = X` setter
//   - Event handlers (`onClick`, `onInput`, ...) → emit as
//     `[eventName, handler]` tuples
//   - Reactive accessors (arrows / `memo(arrow)` / identifier-bound
//     forms) → emit as `[mask, kind, key, accessor]` binding tuples
//   - Per-item shapes (`item.field`, `item((r) => r.x)`) inside
//     each() render callbacks → emit with `FULL_MASK` since the
//     accessor closes over a per-row argument the runtime supplies
//
// When the element has only static + event content, the rewrite
// further specializes into `__cloneStaticTemplate(...)` (prerendered
// HTML clone). When the element's subtree has multiple nested
// elements, `analyzeSubtree` + `emitSubtreeTemplate` collapse the
// whole subtree into a single `elTemplate(...)` call with a
// patch-by-walk function.
//
// Owned by this module since v2c/decomp-22. The thin-wrapper
// migration (decomp-17) put the registry on the call path; the
// helpers (and `tryTransformElementCall` itself) moved here in this
// commit so the module is self-contained.
//
// Fires top-down (`transformCallEnter`). Sets module-level state
// via `ELEMENT_REWRITE_SLOT` for the umbrella's `cleanupImports`
// to decide whether `elSplit` / `elTemplate` / `__cloneStaticTemplate`
// need their runtime imports.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { resolveLocalConstInitializer, isMemoCallWithArrowArg } from '../accessor-resolver.js'
import { computeAccessorMask, createMaskLiteral } from '../transform.js'

// ─── Module wiring ────────────────────────────────────────────────

export interface ElementRewriteModuleOptions {
  /** localName → originalName for element-helper imports (alias-aware). */
  importedHelpers: Map<string, string>
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
}

export interface ElementRewriteSlot {
  /** Helpers whose call sites the module successfully rewrote. */
  compiled: Set<string>
  /** Helpers that bailed (kept their import — runtime falls back). */
  bailed: Set<string>
  /** Module emitted at least one `elSplit(...)` call. */
  usesElSplit: boolean
  /** Module emitted at least one `elTemplate(...)` call. */
  usesElTemplate: boolean
  /** Module emitted at least one `__cloneStaticTemplate(...)` call. */
  usesCloneStaticTemplate: boolean
  /**
   * v0.4 size-cut — module emitted at least one `__bindUncertain(...)`
   * call for a prop value with unresolvable type (function parameter,
   * etc.). Drives the runtime import addition.
   */
  usesBindUncertain: boolean
}

export const ELEMENT_REWRITE_SLOT = 'element-rewrite:state'

export function elementRewriteModule(options: ElementRewriteModuleOptions): CompilerModule {
  const { importedHelpers, fieldBits, fieldBitsHi } = options
  return {
    name: 'element-rewrite',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      const slot = ctx.analysis.perModule.get(ELEMENT_REWRITE_SLOT) as
        | ElementRewriteSlot
        | undefined
      const state: ElementRewriteSlot = slot ?? {
        compiled: new Set<string>(),
        bailed: new Set<string>(),
        usesElSplit: false,
        usesElTemplate: false,
        usesCloneStaticTemplate: false,
        usesBindUncertain: false,
      }
      if (!slot) ctx.analysis.perModule.set(ELEMENT_REWRITE_SLOT, state)

      const transformed = tryTransformElementCall(
        node,
        importedHelpers,
        fieldBits,
        state.compiled,
        state.bailed,
        ctx.factory,
        fieldBitsHi,
        state,
      )
      if (!transformed) return null

      if (ts.isIdentifier(transformed.expression)) {
        if (transformed.expression.text === 'elTemplate') state.usesElTemplate = true
        else if (transformed.expression.text === 'elSplit') state.usesElSplit = true
        else if (transformed.expression.text === '__cloneStaticTemplate')
          state.usesCloneStaticTemplate = true
      }
      return transformed
    },
  }
}

// ─── Rewrite implementation (moved verbatim from transform.ts) ─────

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
 * A `value` at a reactive-prop position — classified for the compiler.
 *
 * Element-helper props (`{ disabled: X, class: X, title: X, ... }`) and the
 * driver accessor of structural primitives (`each.items`, `branch.on`,
 * `show.when`) accept any callable that takes the state and returns a
 * value. The compiler must distinguish recognized shapes from values it
 * can't safely classify (imports, parameters, opaque expressions) — the
 * latter must bail to the runtime helper, never to a static assignment.
 *
 * Bailing is load-bearing: emitting `__e.disabled = identifier` statically
 * when the runtime value happens to be a function silently binds the
 * function ref to the boolean DOM property and never re-runs.
 */
type ResolvedReactiveBinding =
  | {
      kind: 'arrow'
      accessor: ts.ArrowFunction | ts.FunctionExpression
      valueForBinding: ts.Expression
    }
  | {
      kind: 'fn-decl'
      accessor: ts.FunctionDeclaration
      valueForBinding: ts.Expression
    }
  | {
      kind: 'memo-call'
      accessor: ts.ArrowFunction | ts.FunctionExpression
      valueForBinding: ts.Expression
    }

type ResolvedReactiveValue =
  | ResolvedReactiveBinding
  | { kind: 'static-literal' }
  | { kind: 'bail' }
  | null

function isStaticPrimitiveLiteral(expr: ts.Expression): boolean {
  return (
    ts.isStringLiteral(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  )
}

/**
 * Classify a reactive-prop value. See `ResolvedReactiveValue` for the
 * contract. Returns `null` only when the value is none of the recognized
 * shapes (caller can fall back to its own branches — currently only
 * `tryTransformElementCall` does this for `isPerItemFieldAccess` /
 * `isHoistedPerItem`).
 */
function classifyReactiveValue(value: ts.Expression): ResolvedReactiveValue {
  // Inline arrow / function expression at the call site
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { kind: 'arrow', accessor: value, valueForBinding: value }
  }

  // Inline `memo(arrow)` at the call site
  if (isMemoCallWithArrowArg(value)) {
    return {
      kind: 'memo-call',
      accessor: value.arguments[0] as ts.ArrowFunction | ts.FunctionExpression,
      valueForBinding: value,
    }
  }

  // Identifier — resolve and classify the resolved declaration
  if (ts.isIdentifier(value)) {
    const resolved = resolveLocalConstInitializer(value)
    if (!resolved) {
      // Imported / parameter / unbound — can't prove it's a primitive,
      // can't prove it's a function. Caller must bail to runtime.
      return { kind: 'bail' }
    }
    if (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved)) {
      return { kind: 'arrow', accessor: resolved, valueForBinding: value }
    }
    if (ts.isFunctionDeclaration(resolved)) {
      return { kind: 'fn-decl', accessor: resolved, valueForBinding: value }
    }
    if (isMemoCallWithArrowArg(resolved)) {
      return {
        kind: 'memo-call',
        accessor: resolved.arguments[0] as ts.ArrowFunction | ts.FunctionExpression,
        valueForBinding: value,
      }
    }
    if (isStaticPrimitiveLiteral(resolved)) {
      return { kind: 'static-literal' }
    }
    // Resolved to something else (object/array/expression) — conservative
    // bail. We don't know if the runtime value is a function; the runtime
    // element helper handles both cases correctly.
    return { kind: 'bail' }
  }

  // Static literals at the call site
  if (isStaticPrimitiveLiteral(value)) {
    return { kind: 'static-literal' }
  }

  // CallExpression — caller decides (per-item, etc.)
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

// ─── emitStaticProp + tryTransformElementCall ────────────────────

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
  fieldBitsHi: Map<string, number> = new Map(),
  state?: ElementRewriteSlot,
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

      // Per-item shapes — handled before the general classifier because
      // they appear inside `each().render` callbacks where `item` is a
      // closed-over per-row accessor (zero-arg). The resolver above can't
      // see them; they're shape-matched syntactically.
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
      if (ts.isCallExpression(value) && isPerItemCall(value)) {
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

      // Classify the value at a reactive-prop position:
      //   - inline arrow / fn-expr at the call site
      //   - inline `memo(arrow)` at the call site
      //   - Identifier referencing a const-bound arrow/fn-expr in scope
      //   - Identifier referencing a hoisted function declaration in scope
      //   - Identifier referencing `const x = memo(arrow)` in scope
      //   - Identifier referencing a static primitive literal
      //   - Anything else (imports, parameters, opaque expressions) — bail
      //     to runtime; the runtime helper handles `typeof v === 'function'`
      //     correctly for both function and primitive values.
      const classified = classifyReactiveValue(value)
      if (classified === null) {
        // Unknown shape (a CallExpression that isn't memo/per-item, etc.)
        // — historically bailed to runtime. Preserve that.
        bailed.add(localName)
        return null
      }
      if (classified.kind === 'bail') {
        // v0.4 size-cut: instead of bailing the whole element call to the
        // runtime element-helper (which keeps `createElement` + ~1.8 kB of
        // elements.ts alive), emit a `__bindUncertain` call in the static-
        // fn that dispatches at mount time on `typeof value`. Function
        // values become reactive bindings (FULL_MASK gating — the
        // compiler couldn't analyze the accessor); non-function values
        // apply directly via the regular applyBinding path. Net effect:
        // we keep the elSplit compilation and lose the elements.ts
        // fallback.
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        staticProps.push(
          f.createExpressionStatement(
            f.createCallExpression(f.createIdentifier('__bindUncertain'), undefined, [
              f.createIdentifier('__e'),
              f.createStringLiteral(kind),
              resolvedKey === undefined
                ? f.createIdentifier('undefined')
                : f.createStringLiteral(resolvedKey),
              value,
            ]),
          ),
        )
        if (state) state.usesBindUncertain = true
        continue
      }
      if (classified.kind === 'static-literal') {
        // Fall through to emitStaticProp (`__e.disabled = X`). Safe because
        // we proved X is a primitive.
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        emitStaticProp(staticProps, f, kind, resolvedKey, value)
        continue
      }
      // 'arrow' | 'fn-decl' | 'memo-call' — emit as a binding tuple. Mask is
      // analyzed from the resolved accessor body (or the inner arrow inside
      // a memo() call); the value emitted into the binding tuple is what the
      // runtime calls as `accessor(state)` — for inline arrows we keep the
      // arrow itself (preserves the historical inlining behavior), for
      // identifier-bound forms we keep the identifier so consumers see
      // a single canonical reference (and `memo()` proxies aren't rebuilt
      // per render).
      {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        const { mask, maskHi, readsState } = computeAccessorMask(
          classified.accessor,
          fieldBits,
          undefined,
          fieldBitsHi,
        )

        // Zero-mask constant folding only applies to inline arrows whose body
        // we can safely call at compile time. For identifier-bound forms
        // (`accessor !== value`) we skip the fold — calling the identifier's
        // declaration at compile time would be unsafe (different scope) and
        // calling the identifier in the emitted output would defeat the point.
        if (
          classified.kind === 'arrow' &&
          classified.accessor === value &&
          mask === 0 &&
          maskHi === 0 &&
          !readsState
        ) {
          emitStaticProp(
            staticProps,
            f,
            kind,
            resolvedKey,
            f.createCallExpression(classified.accessor, undefined, []),
          )
          continue
        }

        const effectiveMask = mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask
        // Emit a 5-tuple only when the accessor reads a high-word
        // prefix (positions 31..61). For the common ≤31-prefix case
        // the emit stays byte-identical to the pre-multi-word baseline,
        // and stale runtime bundles ignore the 5th slot.
        const tupleEls = [
          createMaskLiteral(f, effectiveMask),
          f.createStringLiteral(kind),
          f.createStringLiteral(resolvedKey),
          classified.valueForBinding,
        ]
        if (maskHi !== 0) tupleEls.push(createMaskLiteral(f, maskHi))
        bindings.push(f.createArrayLiteralExpression(tupleEls))
      }
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
  const analyzed = analyzeSubtree(node, helpers, fieldBits, [], fieldBitsHi)
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

// ─── Analysis + per-item heuristics ───────────────────────────────

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
  /** Reactive bindings: [mask, maskHi, kind, key, accessor]. `maskHi` is
   *  0 for low-word-only bindings (the common case) and a non-zero
   *  high-word mask when the accessor reads a prefix at bit position
   *  31..61. Emit serializes maskHi as a 5th tuple slot only when
   *  non-zero — see `__bind` / elSplit's tuple-length detection. */
  bindings: Array<[number, number, string, string, ts.Expression]>
  /** Children: analyzed elements, static text, or reactive text */
  children: AnalyzedChild[]
  /** Path from template root as childNodes indices */
  path: number[]
}

type AnalyzedChild =
  | { type: 'element'; node: AnalyzedNode }
  | { type: 'staticText'; value: string }
  | {
      type: 'reactiveText'
      accessor: ts.Expression
      mask: number
      maskHi: number
      childIdx: number
    }

/**
 * Try to analyze an element call and all its descendants as a collapsible subtree.
 * Returns null if any part of the tree is not eligible for collapse.
 */
function analyzeSubtree(
  node: ts.CallExpression,
  helpers: Map<string, string>,
  fieldBits: Map<string, number>,
  path: number[],
  fieldBitsHi: Map<string, number> = new Map(),
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
  const bindings: Array<[number, number, string, string, ts.Expression]> = []

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
        const { mask, maskHi, readsState } = computeAccessorMask(
          value,
          fieldBits,
          undefined,
          fieldBitsHi,
        )
        if (mask === 0 && maskHi === 0 && !readsState) {
          // Constant fold — treat as static if we can extract a string
          const staticVal = tryExtractStaticString(value)
          if (staticVal !== null) {
            const attrKey = kind === 'class' ? 'class' : resolvedKey
            staticAttrs.push([attrKey, staticVal])
            continue
          }
        }
        const finalMask = mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask
        bindings.push([finalMask, maskHi, kind, resolvedKey, value])
        continue
      }

      // Per-item accessor call
      if (ts.isCallExpression(value) && isPerItemCall(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push([0xffffffff | 0, 0, kind, resolvedKey, value])
        continue
      }

      // Per-item property access: item.field (or hoisted __a0/__a1/…)
      if (isPerItemFieldAccess(value) || isHoistedPerItem(value)) {
        const kind = classifyKind(key)
        const resolvedKey = resolveKey(key, kind)
        bindings.push([0xffffffff | 0, 0, kind, resolvedKey, value])
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
          const { mask, maskHi, readsState } = computeAccessorMask(
            accessor,
            fieldBits,
            undefined,
            fieldBitsHi,
          )
          children.push({
            type: 'reactiveText',
            accessor,
            mask: mask === 0 && maskHi === 0 && readsState ? 0xffffffff | 0 : mask,
            maskHi,
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
            maskHi: 0,
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
            maskHi: 0,
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
        const childNode = analyzeSubtree(
          child,
          helpers,
          fieldBits,
          [...path, childIdx],
          fieldBitsHi,
        )
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
  /** Bindings to register via __bind: [mask, maskHi, kind, key, accessor] */
  bindings: Array<[number, number, string, string, ts.Expression]>
  /** Reactive text children — reference existing placeholder text nodes */
  reactiveTexts: Array<{
    accessor: ts.Expression
    mask: number
    maskHi: number
    childIdx: number
  }>
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
                    f.createPropertyAccessExpression(f.createIdentifier('__dom'), 'createTextNode'),
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
      // __bind(__t0, mask, 'text', undefined, accessor, [maskHi])
      const rtArgs: ts.Expression[] = [
        f.createIdentifier(tVar),
        createMaskLiteral(f, rt.mask),
        f.createStringLiteral('text'),
        f.createIdentifier('undefined'),
        rt.accessor,
      ]
      // Only pass the 6th positional arg when the accessor reads a
      // high-word prefix. Keeps the emit byte-identical to the
      // pre-multi-word baseline for the common case.
      if (rt.maskHi !== 0) rtArgs.push(createMaskLiteral(f, rt.maskHi))
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, rtArgs),
        ),
      )
    }

    // Reactive bindings — __bind(node, mask, kind, key, accessor, [maskHi])
    for (const [mask, maskHi, kind, key, accessor] of op.bindings) {
      const args: ts.Expression[] = [
        nodeRef,
        createMaskLiteral(f, mask),
        f.createStringLiteral(kind),
        key ? f.createStringLiteral(key) : f.createIdentifier('undefined'),
        accessor,
      ]
      if (maskHi !== 0) args.push(createMaskLiteral(f, maskHi))
      stmts.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier('__bind'), undefined, args),
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

  // (root, __bind, __dom) => { ... }
  const patchFn = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'root'),
      f.createParameterDeclaration(undefined, undefined, '__bind'),
      f.createParameterDeclaration(undefined, undefined, '__dom'),
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
  // Extract static attributes from staticFn statements. Any statement that
  // doesn't match the recognized "static prop assignment" shapes forces a
  // bail to the runtime elSplit path — silently skipping would drop the
  // statement's effect (e.g. `__bindUncertain(__e, ...)` calls that bind
  // unresolvable values at mount).
  let attrs = ''
  for (const stmt of staticProps) {
    if (!ts.isExpressionStatement(stmt)) return null
    const expr = stmt.expression
    // __e.className = 'value'
    if (ts.isBinaryExpression(expr) && ts.isPropertyAccessExpression(expr.left)) {
      const prop = expr.left.name.text
      if (prop === 'className' && ts.isStringLiteral(expr.right)) {
        attrs += ` class="${escapeAttr(expr.right.text)}"`
        continue
      }
      return null
    }
    // __e.setAttribute('key', 'value')
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      if (expr.expression.name.text === 'setAttribute' && expr.arguments.length === 2) {
        const key = expr.arguments[0]
        const val = expr.arguments[1]
        if (key && val && ts.isStringLiteral(key) && ts.isStringLiteral(val)) {
          attrs += ` ${key.text}="${escapeAttr(val.text)}"`
          continue
        }
        return null // non-literal attribute
      }
      return null
    }
    // Unrecognized statement shape — bail to elSplit. This catches
    // `__bindUncertain(...)` and any future emission added to staticProps
    // that the static-HTML extractor doesn't know how to serialise.
    return null
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

function emitTemplateClone(html: string, f: ts.NodeFactory): ts.Expression {
  // Emits: __cloneStaticTemplate("<html>")
  //
  // The helper lives in `@llui/dom` and threads through `ctx.dom` so SSR
  // under jsdom/linkedom works without touching globalThis. The import
  // cleanup pass (see cleanupImports) auto-injects the import when this
  // emission fires.
  return f.createCallExpression(f.createIdentifier('__cloneStaticTemplate'), undefined, [
    f.createStringLiteral(html),
  ])
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
// See `NON_DELEGATION_HELPERS` in collect-deps.ts — same set of names
// that aren't followed when scanning for `helper(s)` delegation calls.
