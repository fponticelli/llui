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

/**
 * Lower a structural arm/render callback's returned node array to `[node, ...]`
 * source under `armRoots`, collecting binding deps into `collect`, or return null
 * when it can't be SAFELY lowered. Unsafe means either (a) the body isn't a
 * concise array literal — e.g. a block body `(v) => { return [...] }`, which the
 * old code returned verbatim, producing the malformed `() => (v) => {...}` (a
 * function that yields the arrow instead of calling it) — or (b) a bound callback
 * param in `guardParams` survives as a free identifier in the lowered output,
 * meaning it leaked into a verbatim position (a helper call like `row(item)` or an
 * event handler) that the lowered, param-less `() => [...]` arm cannot bind.
 *
 * When this returns null the caller MUST emit the whole structural primitive
 * (each/show/branch) verbatim, so the runtime authoring helper — which binds the
 * real item/index/narrowed signal handle — renders it. Forgoing the lowering
 * optimization is always correct; emitting a free variable is a runtime crash.
 */
function lowerArmArray(
  fn: ts.Expression,
  sf: ts.SourceFile,
  armRoots: Roots,
  guardParams: readonly (string | null)[],
  collect?: Set<string>,
): string | null {
  const arr = arrowReturnArray(fn)
  if (!arr) return null
  const src = `[${arr.elements.map((e) => transformNodeExpr(e, sf, armRoots, collect)).join(', ')}]`
  for (const p of guardParams) if (p !== null && loweredLeaksIdent(src, p)) return null
  return src
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
        let renderFn: ts.Expression | null = null
        let itemParam = 'item'
        let indexParam: string | null = null
        for (const p of opts.properties) {
          if (!ts.isPropertyAssignment(p)) continue
          const name = p.name.getText(sf)
          if (name === 'key') keySrc = p.initializer.getText(sf)
          else if (name === 'render') {
            renderFn = p.initializer
            if (ts.isArrowFunction(renderFn) || ts.isFunctionExpression(renderFn)) {
              if (renderFn.parameters[0] && ts.isIdentifier(renderFn.parameters[0].name))
                itemParam = renderFn.parameters[0].name.text
              if (renderFn.parameters[1] && ts.isIdentifier(renderFn.parameters[1].name))
                indexParam = renderFn.parameters[1].name.text
            }
          }
        }
        // rows read ctx.item.* and ctx.state.* — `eachRoots` rewrites the item
        // param to `ctx.item`; `lowerArmArray` guards against either row param
        // leaking into a verbatim helper call / handler (the dashboard crash) and
        // against a non-array render body. Either case -> verbatim runtime `each`.
        const renderDeps = new Set<string>()
        const body =
          renderFn &&
          lowerArmArray(renderFn, sf, eachRoots(itemParam), [itemParam, indexParam], renderDeps)
        if (body != null) {
          // source: items accessor (component roots) + deps = items deps PLUS the
          // component-state paths the rows read (render `state.*` deps, un-namespaced)
          const itemsLowered = signalToProduce(items, sf, roots)
          const rowStateDeps = [...renderDeps]
            .filter((d) => d === 'state' || d.startsWith('state.'))
            .map((d) => (d === 'state' ? '' : d.slice('state.'.length)))
          const sourceDeps = [...new Set([...itemsLowered.deps, ...rowStateDeps])]
          const source = `{ items: (${paramOf(roots)}) => ${itemsLowered.produce}, deps: ${depsArr(sourceDeps)} }`
          // Nested in an enclosing row: propagate this each's component-state deps
          // (its list accessor + the state.* paths its rows read) to the outer
          // collector so the PARENT each reconciles when any of them change.
          if (collect) {
            for (const d of itemsLowered.deps) collect.add(d)
            for (const d of renderDeps) if (d === 'state' || d.startsWith('state.')) collect.add(d)
          }
          // FAST PATH: if the row is a static element skeleton with only static
          // attrs + text bindings, emit a direct-construction `RowFactory` and
          // `signalEachDirect` — skipping the per-row authoring/Mountable/populate/
          // pathHandle overhead. Falls back to `signalEach` for anything richer
          // (reactive attrs, event handlers, structural children, helper calls).
          const factory = renderFn && lowerRowFactory(renderFn, itemParam, sf)
          if (factory) return `signalEachDirect(${source}, ${keySrc}, ${factory})`
          return `signalEach(${source}, ${keySrc}, () => ${body})`
        }
        // unlowerable render -> fall through to verbatim (runtime authoring each)
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
        // Like `each`, the then-arm's narrowed param is rebased only inside
        // recognized slots — if it leaks into a verbatim helper call / handler (or
        // the cond isn't a simple path, so it isn't rebased at all), or either arm
        // is a non-array body, the lowered `() => [...]` arm can't bind it. Fall
        // back to the runtime authoring `show`, which binds a real narrowed handle.
        const thenBody = lowerArmArray(render, sf, thenRoots, [narrowed], collect)
        const elseBody = orElse
          ? lowerArmArray(orElse, sf, roots, [firstParam(orElse)], collect)
          : null
        if (thenBody != null && (!orElse || elseBody != null)) {
          // Propagate the condition's deps to the enclosing collector so a parent
          // `each` reconciles its rows when this nested show's condition changes
          // (its arms' value deps are collected by the lowerArmArray calls above).
          if (collect) for (const d of condLowered.deps) collect.add(d)
          const elseSrc = orElse ? `, () => ${elseBody}` : ''
          return `signalShow(${specSrc(cond, sf, roots)}, () => ${thenBody}${elseSrc})`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring show)
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
        // An arm is lowerable only if it's a `PropertyAssignment` whose body is a
        // concise array that doesn't leak its narrowed `v` param into a verbatim
        // helper call / handler (or that doesn't use `v` when the value isn't a
        // simple path, so it can't be rebased). If ANY arm — or a spread / accessor
        // property — can't be lowered, emit the WHOLE branch verbatim so the
        // runtime authoring `branch` binds real narrowed handles for every arm.
        const armsSrc: string[] = []
        let armsOk = true
        for (const p of arms.properties) {
          if (!ts.isPropertyAssignment(p)) {
            armsOk = false
            break
          }
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
          const armBody = lowerArmArray(fn, sf, armRoots, [vParam], collect)
          if (armBody == null) {
            armsOk = false
            break
          }
          armsSrc.push(`${p.name.getText(sf)}: () => ${armBody}`)
        }
        if (armsOk) {
          // Propagate the discriminant's deps so a parent `each` reconciles when it
          // changes (arm value deps are collected by the lowerArmArray calls above).
          if (collect)
            for (const d of discDep !== null ? [discDep] : valueLowered.deps) collect.add(d)
          return `signalBranch(${discSpec}, { ${armsSrc.join(', ')} })`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring branch)
      }
      // 2-arg plain form: branch(stringSignal, { arm: () => [...] }) — the value
      // IS the discriminant; arms are keyed by its value, no narrowed param.
      if (value && discArg && ts.isObjectLiteralExpression(discArg) && isSignalExpr(value, roots)) {
        const armsSrc: string[] = []
        let armsOk = true
        for (const p of discArg.properties) {
          if (!ts.isPropertyAssignment(p)) {
            armsOk = false
            break
          }
          const armBody = lowerArmArray(
            p.initializer,
            sf,
            roots,
            [firstParam(p.initializer)],
            collect,
          )
          if (armBody == null) {
            armsOk = false
            break
          }
          armsSrc.push(`${p.name.getText(sf)}: () => ${armBody}`)
        }
        if (armsOk) {
          if (collect) for (const d of signalToProduce(value, sf, roots).deps) collect.add(d)
          return `signalBranch(${specSrc(value, sf, roots)}, { ${armsSrc.join(', ')} })`
        }
        // unlowerable arm -> fall through to verbatim (runtime authoring branch)
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

/** The concise-arrow returned array of a render callback (`(item) => [...]`), or
 * null for a block body / non-array return. */
function rowReturnArray(fn: ts.Expression): ts.ArrayLiteralExpression | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null
  const b = fn.body
  if (ts.isArrayLiteralExpression(b)) return b
  if (ts.isParenthesizedExpression(b) && ts.isArrayLiteralExpression(b.expression))
    return b.expression
  return null
}

/** Generate a direct-construction `RowFactory` source for a static-skeleton row
 * (elements with static attrs + static/signal `text` children only). Returns the
 * `(doc) => { … return { nodes, bindings } }` source, or null to fall back to
 * `signalEach` — for reactive attrs, `on*` handlers, spreads, dynamic args,
 * structural children, helper calls, or `index`/opaque reads it can't wire.
 * See docs/proposals/v2-compiler/compiled-row-construction.md. */
function lowerRowFactory(fn: ts.Expression, itemParam: string, sf: ts.SourceFile): string | null {
  const arr = rowReturnArray(fn)
  if (!arr || arr.elements.length === 0) return null
  const roots = eachRoots(itemParam)
  const stmts: string[] = []
  const bindings: string[] = []
  let counter = 0
  const fresh = (): string => `_n${counter++}`

  const calleeName = (c: ts.CallExpression): string | null =>
    ts.isIdentifier(c.expression) ? c.expression.text : null

  // Append a child to `parentVar`; returns false to bail the whole row.
  const buildChild = (child: ts.Expression, parentVar: string): boolean => {
    if (ts.isStringLiteralLike(child) || ts.isNumericLiteral(child)) {
      stmts.push(`${parentVar}.appendChild(doc.createTextNode(${JSON.stringify(child.text)}))`)
      return true
    }
    if (!ts.isCallExpression(child)) return false
    const callee = calleeName(child)
    if (callee === 'text') {
      const arg = child.arguments[0]
      if (!arg) return false
      if (ts.isStringLiteralLike(arg)) {
        stmts.push(`${parentVar}.appendChild(doc.createTextNode(${arg.getText(sf)}))`)
        return true
      }
      if (!isSignalExpr(arg, roots)) return false
      const { produce, deps } = signalToProduce(arg, sf, roots)
      const tv = fresh()
      stmts.push(`const ${tv} = doc.createTextNode('')`)
      stmts.push(`${parentVar}.appendChild(${tv})`)
      bindings.push(
        `{ deps: ${depsArr(deps)}, produce: (ctx) => ${produce}, commit: (v) => { ${tv}.data = v == null ? '' : String(v) } }`,
      )
      return true
    }
    if (callee && ELEMENT_HELPERS.has(callee)) {
      const cv = buildElement(child)
      if (cv === null) return false
      stmts.push(`${parentVar}.appendChild(${cv})`)
      return true
    }
    return false // structural / helper / unknown -> bail
  }

  // Emit construction for an element-helper call; returns its var, or null to bail.
  function buildElement(call: ts.CallExpression): string | null {
    const callee = calleeName(call)
    if (!callee || !ELEMENT_HELPERS.has(callee)) return null
    const a0 = call.arguments[0]
    const a1 = call.arguments[1]
    let propsExpr: ts.ObjectLiteralExpression | undefined
    let childrenExpr: ts.ArrayLiteralExpression | undefined
    if (!a0) {
      // tag()
    } else if (ts.isArrayLiteralExpression(a0)) {
      childrenExpr = a0
    } else if (ts.isObjectLiteralExpression(a0)) {
      propsExpr = a0
      if (a1) {
        if (ts.isArrayLiteralExpression(a1)) childrenExpr = a1
        else return null // dynamic children
      }
    } else {
      return null // dynamic args
    }
    const v = fresh()
    stmts.push(`const ${v} = doc.createElement(${JSON.stringify(callee)})`)
    if (propsExpr) {
      for (const p of propsExpr.properties) {
        if (!ts.isPropertyAssignment(p)) return null // spread / shorthand / method
        const name = p.name.getText(sf)
        if (/^on[A-Z]/.test(name)) return null // event handler (v1: bail)
        if (name.startsWith('style.') || DIRECT_SKIP_ATTRS.has(name)) return null // IDL/style
        if (isSignalExpr(p.initializer, roots)) return null // reactive attr (v1: bail)
        const init = p.initializer
        if (ts.isStringLiteralLike(init) || ts.isNumericLiteral(init)) {
          stmts.push(`${v}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(init.text)})`)
        } else if (init.kind === ts.SyntaxKind.TrueKeyword) {
          stmts.push(`${v}.setAttribute(${JSON.stringify(name)}, "")`)
        } else if (init.kind === ts.SyntaxKind.FalseKeyword) {
          // falsy boolean attr -> absent; nothing to emit
        } else {
          return null // non-literal static value
        }
      }
    }
    if (childrenExpr) {
      for (const child of childrenExpr.elements) {
        if (!buildChild(child, v)) return null
      }
    }
    return v
  }

  const topVars: string[] = []
  for (const el of arr.elements) {
    // A keyed row's top-level node must be a stable ELEMENT (buildSignalEach
    // rejects a bare structural fragment as a row root).
    if (!ts.isCallExpression(el)) return null
    const callee = calleeName(el)
    if (!callee || !ELEMENT_HELPERS.has(callee)) return null
    const v = buildElement(el)
    if (v === null) return null
    topVars.push(v)
  }

  return `(doc) => { ${stmts.join('; ')}; return { nodes: [${topVars.join(', ')}], bindings: [${bindings.join(', ')}] } }`
}

/** Attribute names the runtime applies as live IDL properties (not `setAttribute`);
 * the direct fast path bails on static occurrences so the slow path's `applyAttr`
 * handles them. Mirrors the runtime's `DOM_PROPERTIES`. */
const DIRECT_SKIP_ATTRS = new Set(['value', 'checked', 'selected', 'indeterminate'])

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
