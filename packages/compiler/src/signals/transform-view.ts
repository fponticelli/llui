// Signal view transform — rewrite authored reactive slots to the runtime form.
//
// Walks node-producing expressions in a `view` and rewrites:
//   - `text(state.at('count'))`      -> `signalText((s) => s.count, ['count'])`
//   - `text('literal')`              -> `staticText('literal')`
//   - `div({ class: <signal> }, [..])` -> `el('div', { class: react((s) => …, [..]) }, [..])`
// Static props and non-signal values (event handlers, literals) are preserved
// verbatim. Children are transformed recursively.
//
// Source→source (string) output; the surrounding transform (plugin wiring,
// import injection, signal-component detection) consumes it. Structural
// primitives (each/branch/show) and handler peek-lowering are later steps and
// are left verbatim here.
//
// See docs/proposals/signals/README.md.

import ts from 'typescript'
import { signalToProduce } from './lower.js'
import { isSignalExpr, signalPathOf, STATE_ROOTS, type Roots } from './extract-deps.js'

/** The produce-wrapper parameter name for a roots map: `s` for the component
 * view, `ctx` inside an each row (where value prefixes are `ctx.item`/`ctx.state`). */
function paramOf(roots: Roots): string {
  for (const info of roots.values()) return info.value.split('.')[0] ?? 's'
  return 's'
}

/** Roots for an each row: item param -> ctx.item, the component `state` -> ctx.state. */
function eachRoots(itemParam: string): Roots {
  return new Map([
    [itemParam, { value: 'ctx.item', dep: 'item' }],
    ['state', { value: 'ctx.state', dep: 'state' }],
  ])
}

// True if a lowered render string still references `ident` as a free identifier
// (i.e. as a standalone word not reached through a member access and not inside a
// string). The lowering rewrites legitimate row-param reads to `ctx.item` /
// `ctx.index` (the word there is preceded by `.`) and records deps as quoted
// strings like `'item.title'` (preceded by a quote); a bare occurrence elsewhere
// means the param leaked into a verbatim position — an event handler or a helper
// call like `activityItem(item, ...)` — that the lowered `() => [...]` render
// can't bind. Such an `each` must stay verbatim so the runtime authoring `each`
// (which binds real item/index handles) renders it. We exclude `.`/quote-prefixed
// occurrences; any false positive only forgoes the optimization, so this is safe.
function loweredLeaksIdent(src: string, ident: string): boolean {
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![.\\w$'"\`])${escaped}(?![\\w$])`).test(src)
}

const ELEMENT_HELPERS = new Set([
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'label',
  'form',
  'ul',
  'ol',
  'li',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'article',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'svg',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'select',
  'option',
  'textarea',
  'pre',
  'code',
  'small',
  'strong',
  'em',
  'i',
  'b',
  'figure',
  'figcaption',
  'canvas',
  'video',
  'audio',
  'details',
  'summary',
  'dialog',
  'fieldset',
  'legend',
])

function depsArr(deps: readonly string[]): string {
  // dependency paths are dotted property names / numeric indices — no quoting
  // hazards — so single-quote to match the repo's formatting.
  return `[${deps.map((d) => `'${d}'`).join(', ')}]`
}

function unwrap(expr: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expr) ? unwrap(expr.expression) : expr
}

/** The first parameter name of a callback, or null (used to root a render arm's
 * narrowed signal, e.g. show/branch). */
function firstParam(fn: ts.Expression): string | null {
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    fn.parameters[0] &&
    ts.isIdentifier(fn.parameters[0].name)
  ) {
    return fn.parameters[0].name.text
  }
  return null
}

/** The discriminant property name from a key arrow `(u) => u.kind`, or null if
 * the arg isn't a single top-level property access on the parameter. */
function discriminantProp(fn: ts.Expression): string | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  let body: ts.Node | undefined = fn.body
  if (body && ts.isBlock(body)) body = body.statements.find(ts.isReturnStatement)?.expression
  while (body && ts.isParenthesizedExpression(body)) body = body.expression
  if (body && ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression)) {
    return body.name.text
  }
  return null
}

/** Source for a `{ produce, deps }` SignalSpec from a signal expression. */
function specSrc(expr: ts.Expression, sf: ts.SourceFile, roots: Roots): string {
  const { produce, deps } = signalToProduce(expr, sf, roots)
  return `{ produce: (${paramOf(roots)}) => ${produce}, deps: ${depsArr(deps)} }`
}

/** The returned node array of a concise arrow body (`() => [...]`), or null. */
function arrowReturnArray(fn: ts.Expression): ts.ArrayLiteralExpression | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const body = fn.body
  if (body && ts.isArrayLiteralExpression(body)) return body
  if (body && ts.isParenthesizedExpression(body) && ts.isArrayLiteralExpression(body.expression)) {
    return body.expression
  }
  return null
}

/** Transform a render arrow's returned node array under the given roots,
 * collecting the bindings' deps into `collect` if provided. */
function renderArraySrc(
  fn: ts.Expression,
  sf: ts.SourceFile,
  roots: Roots,
  collect?: Set<string>,
): string {
  const arr = arrowReturnArray(fn)
  if (!arr) return fn.getText(sf) // non-array body — leave verbatim
  return `[${arr.elements.map((e) => transformNodeExpr(e, sf, roots, collect)).join(', ')}]`
}

/** Rewrite a node-producing expression to its signal-runtime source. */
export function transformNodeExpr(
  expr: ts.Expression,
  sf: ts.SourceFile,
  roots: Roots = STATE_ROOTS,
  collect?: Set<string>,
): string {
  const node = unwrap(expr)

  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const callee = node.expression.text

    if (callee === 'text') {
      const arg = node.arguments[0]
      if (!arg) return node.getText(sf)
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        return `staticText(${arg.getText(sf)})`
      }
      // Only lower when the arg is rooted in the bag signal. A signal-bound LOCAL
      // (e.g. `const n = state.at('n'); … text(n)` in a block-body view) is opaque
      // to the static tracer — leave the call verbatim so the runtime `text`
      // helper consumes the handle. Same fall-through the props path already uses.
      if (!isSignalExpr(arg, roots)) return node.getText(sf)
      const { produce, deps } = signalToProduce(arg, sf, roots)
      if (collect) for (const d of deps) collect.add(d)
      return `signalText((${paramOf(roots)}) => ${produce}, ${depsArr(deps)})`
    }

    if (callee === 'each') {
      // each(items, { key, render: (item, index) => [...] }) -> combined-ctx rows.
      const items = node.arguments[0]
      const opts = node.arguments[1]
      if (items && opts && ts.isObjectLiteralExpression(opts) && isSignalExpr(items, roots)) {
        let keySrc = '(x) => x'
        let renderSrc = '() => []'
        let itemParam = 'item'
        let indexParam: string | null = null
        const renderDeps = new Set<string>()
        for (const p of opts.properties) {
          if (!ts.isPropertyAssignment(p)) continue
          const name = p.name.getText(sf)
          if (name === 'key') keySrc = p.initializer.getText(sf)
          else if (name === 'render') {
            const fn = p.initializer
            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
              if (fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name))
                itemParam = fn.parameters[0].name.text
              if (fn.parameters[1] && ts.isIdentifier(fn.parameters[1].name))
                indexParam = fn.parameters[1].name.text
            }
            // rows read ctx.item.* and ctx.state.*; collect their deps
            renderSrc = `() => ${renderArraySrc(fn, sf, eachRoots(itemParam), renderDeps)}`
          }
        }
        // The lowering rewrites the row param to `ctx.item` only inside RECOGNIZED
        // signal slots (text/element props/each/show/branch). If the render passes
        // the param to a helper call or reads it in an event handler — e.g.
        // `render: (item) => [activityItem(item, ...)]` — that reference stays
        // verbatim while the lowered render `() => [...]` has no `item` binding, so
        // it would throw `item is not defined` at runtime. Detect a leaked param
        // and leave the WHOLE `each(...)` verbatim — the runtime authoring `each`
        // binds real item/index handles and renders correctly. (False positives,
        // e.g. the word in a string literal, only forgo the optimization.)
        const leaks =
          loweredLeaksIdent(renderSrc, itemParam) ||
          (indexParam !== null && loweredLeaksIdent(renderSrc, indexParam))
        if (!leaks) {
          // source: items accessor (component roots) + deps = items deps PLUS the
          // component-state paths the rows read (render `state.*` deps, un-namespaced)
          const itemsLowered = signalToProduce(items, sf, roots)
          const rowStateDeps = [...renderDeps]
            .filter((d) => d === 'state' || d.startsWith('state.'))
            .map((d) => (d === 'state' ? '' : d.slice('state.'.length)))
          const sourceDeps = [...new Set([...itemsLowered.deps, ...rowStateDeps])]
          const source = `{ items: (${paramOf(roots)}) => ${itemsLowered.produce}, deps: ${depsArr(sourceDeps)} }`
          return `signalEach(${source}, ${keySrc}, ${renderSrc})`
        }
        // leaked row param -> fall through to verbatim (runtime authoring each)
      }
    }

    if (callee === 'show') {
      // show(cond, (narrowed) => [...], orElse?) — the then-arm's param is the
      // NARROWED signal (rebased onto the cond's path, like a branch arm); the
      // optional 3rd arm renders when the cond is falsy.
      const cond = node.arguments[0]
      const render = node.arguments[1]
      const orElse = node.arguments[2]
      if (cond && render && isSignalExpr(cond, roots)) {
        const condLowered = signalToProduce(cond, sf, roots)
        const condPath = signalPathOf(cond, roots)
        const narrowed = firstParam(render)
        const thenRoots =
          narrowed !== null && condPath !== null
            ? (new Map([
                ...roots,
                [narrowed, { value: condLowered.produce, dep: condPath }],
              ]) as Roots)
            : roots
        const thenSrc = `() => ${renderArraySrc(render, sf, thenRoots)}`
        const elseSrc = orElse ? `, () => ${renderArraySrc(orElse, sf, roots)}` : ''
        return `signalShow(${specSrc(cond, sf, roots)}, ${thenSrc}${elseSrc})`
      }
    }

    if (callee === 'branch') {
      // branch(value, 'disc', { arm: (v) => [...], ... }) — each arm receives the
      // NARROWED variant signal `v`, rebased onto the value's path (v.at('x') ->
      // <value>.x). The discriminant spec reads value.<disc> to pick the arm.
      const value = node.arguments[0]
      const discArg = node.arguments[1]
      const arms = node.arguments[2]
      const disc = discArg ? discriminantProp(discArg) : null
      if (
        value &&
        disc !== null &&
        arms &&
        ts.isObjectLiteralExpression(arms) &&
        isSignalExpr(value, roots)
      ) {
        const valueLowered = signalToProduce(value, sf, roots)
        const valuePath = signalPathOf(value, roots) // 'view', '' (whole), or null
        const discDep = valuePath === null ? null : valuePath === '' ? disc : `${valuePath}.${disc}`
        const discSpec = `{ produce: (${paramOf(roots)}) => (${valueLowered.produce}).${disc}, deps: ${depsArr(
          discDep !== null ? [discDep] : valueLowered.deps,
        )} }`
        const armsSrc = arms.properties
          .map((p) => {
            if (!ts.isPropertyAssignment(p)) return p.getText(sf)
            const fn = p.initializer
            const vParam =
              (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
              fn.parameters[0] &&
              ts.isIdentifier(fn.parameters[0].name)
                ? fn.parameters[0].name.text
                : null
            // narrow only when the value is a simple path; otherwise the arm
            // body falls back to the component roots (no `v` narrowing).
            const armRoots =
              vParam !== null && valuePath !== null
                ? (new Map([
                    ...roots,
                    [vParam, { value: valueLowered.produce, dep: valuePath }],
                  ]) as Roots)
                : roots
            return `${p.name.getText(sf)}: () => ${renderArraySrc(fn, sf, armRoots)}`
          })
          .join(', ')
        return `signalBranch(${discSpec}, { ${armsSrc} })`
      }
      // 2-arg plain form: branch(stringSignal, { arm: () => [...] }) — the value
      // IS the discriminant; arms are keyed by its value, no narrowed param.
      if (value && discArg && ts.isObjectLiteralExpression(discArg) && isSignalExpr(value, roots)) {
        const armsSrc = discArg.properties
          .map((p) =>
            ts.isPropertyAssignment(p)
              ? `${p.name.getText(sf)}: () => ${renderArraySrc(p.initializer, sf, roots)}`
              : p.getText(sf),
          )
          .join(', ')
        return `signalBranch(${specSrc(value, sf, roots)}, { ${armsSrc} })`
      }
    }

    if (callee === 'foreign') {
      // foreign({ tag?, state: { k: <signal> }, mount, unmount })
      const spec = node.arguments[0]
      if (spec && ts.isObjectLiteralExpression(spec)) {
        const props = spec.properties.map((p) => {
          if (
            ts.isPropertyAssignment(p) &&
            p.name.getText(sf) === 'state' &&
            ts.isObjectLiteralExpression(p.initializer)
          ) {
            // lower each declared input signal to a { produce, deps } SignalSpec
            const entries = p.initializer.properties.map((e) =>
              ts.isPropertyAssignment(e)
                ? `${e.name.getText(sf)}: ${specSrc(e.initializer, sf, roots)}`
                : e.getText(sf),
            )
            return `state: { ${entries.join(', ')} }`
          }
          // tag / mount / unmount are imperative — kept verbatim
          return p.getText(sf)
        })
        return `signalForeign({ ${props.join(', ')} })`
      }
    }

    if (ELEMENT_HELPERS.has(callee)) {
      const a0 = node.arguments[0]
      const a1 = node.arguments[1]
      // Statically-lowerable forms: tag() | tag([children]) | tag({props}) |
      // tag({props}, [children]). Anything else — a DYNAMIC children/props
      // expression like `div(section.view(...))` or `div(props, makeRows())` —
      // can't be analyzed at compile time. Leave the WHOLE call verbatim so the
      // runtime authoring helper handles it (its `Array.isArray(a0)` dispatch
      // routes a Node[] arg to children); lowering those would otherwise DROP the
      // dynamic children (emit `el(tag, {}, [])`).
      let propsExpr: ts.ObjectLiteralExpression | undefined
      let childrenExpr: ts.ArrayLiteralExpression | undefined
      let analyzable = false
      if (!a0) {
        analyzable = true // tag()
      } else if (ts.isArrayLiteralExpression(a0)) {
        childrenExpr = a0
        analyzable = true
      } else if (ts.isObjectLiteralExpression(a0)) {
        propsExpr = a0
        if (!a1) analyzable = true
        else if (ts.isArrayLiteralExpression(a1)) {
          childrenExpr = a1
          analyzable = true
        }
        // a1 present but not an array literal -> dynamic children -> not analyzable
      }
      if (!analyzable) return node.getText(sf)
      const propsSrc = propsExpr ? transformProps(propsExpr, sf, roots, collect) : '{}'
      const childrenSrc = childrenExpr
        ? `[${childrenExpr.elements.map((c) => transformNodeExpr(c, sf, roots, collect)).join(', ')}]`
        : '[]'
      return `el(${JSON.stringify(callee)}, ${propsSrc}, ${childrenSrc})`
    }
  }

  // Unrecognized node form (helper call, each/branch/show, ...) — verbatim.
  return node.getText(sf)
}

function transformProps(
  obj: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
  roots: Roots,
  collect?: Set<string>,
): string {
  if (obj.properties.length === 0) return '{}'
  const parts = obj.properties.map((p) => {
    if (ts.isPropertyAssignment(p)) {
      const name = p.name.getText(sf)
      if (isSignalExpr(p.initializer, roots)) {
        const { produce, deps } = signalToProduce(p.initializer, sf, roots)
        if (collect) for (const d of deps) collect.add(d)
        return `${name}: react((${paramOf(roots)}) => ${produce}, ${depsArr(deps)})`
      }
      return `${name}: ${p.initializer.getText(sf)}`
    }
    return p.getText(sf) // shorthand / spread / method — verbatim
  })
  return `{ ${parts.join(', ')} }`
}
