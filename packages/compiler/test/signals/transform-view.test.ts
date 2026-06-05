import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformNodeExpr } from '../../src/signals/transform-view.js'
import { isSignalExpr } from '../../src/signals/extract-deps.js'

function parse(src: string): { expr: ts.Expression; sf: ts.SourceFile } {
  const sf = ts.createSourceFile('t.ts', `const __e = (${src})`, ts.ScriptTarget.Latest, true)
  let expr: ts.Expression | undefined
  const visit = (n: ts.Node): void => {
    if (expr) return
    if (ts.isVariableDeclaration(n) && n.initializer) {
      expr = ts.isParenthesizedExpression(n.initializer) ? n.initializer.expression : n.initializer
      return
    }
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  if (!expr) throw new Error('no expr')
  return { expr, sf }
}
const tx = (src: string): string => {
  const { expr, sf } = parse(src)
  return transformNodeExpr(expr, sf)
}

describe('isSignalExpr — strict shape (excludes handlers)', () => {
  const sig = (s: string): boolean => isSignalExpr(parse(s).expr)
  it('true for signal chains', () => {
    expect(sig('state')).toBe(true)
    expect(sig("state.at('count')")).toBe(true)
    expect(sig("state.at('user').map((u) => u.name)")).toBe(true)
    expect(sig("derived([state.at('a')], (a) => a)")).toBe(true)
  })
  it('false for handlers/literals even if a signal appears inside', () => {
    expect(sig("() => send({ type: 'X', n: state.at('count').peek() })")).toBe(false)
    expect(sig("'static'")).toBe(false)
    expect(sig('42')).toBe(false)
  })
})

describe('transformNodeExpr — text', () => {
  it('static string -> staticText', () => {
    expect(tx("text('hello')")).toBe("staticText('hello')")
  })
  it('signal -> signalText with produce + deps', () => {
    expect(tx("text(state.at('count'))")).toBe("signalText((s) => s.count, ['count'])")
    expect(tx("text(state.at('user').map((u) => `Hi ${u.name}`))")).toBe(
      "signalText((s) => ((u) => `Hi ${u.name}`)(s.user), ['user.name'])",
    )
  })
})

describe('transformNodeExpr — elements', () => {
  it('static props preserved, children recursed', () => {
    expect(tx("div({ id: 'x' }, [text('a')])")).toBe("el(\"div\", { id: 'x' }, [staticText('a')])")
  })
  it('reactive prop -> react(...)', () => {
    expect(tx("div({ class: state.at('busy') }, [])")).toBe(
      'el("div", { class: react((s) => s.busy, [\'busy\']) }, [])',
    )
  })
  it('mapped reactive prop', () => {
    expect(tx("div({ class: state.at('busy').map((b) => (b ? 'spin' : 'idle')) }, [])")).toBe(
      "el(\"div\", { class: react((s) => ((b) => (b ? 'spin' : 'idle'))(s.busy), ['busy']) }, [])",
    )
  })
  it('event handler preserved verbatim (not treated as reactive)', () => {
    const out = tx("button({ onClick: () => send({ type: 'inc' }) }, [text('+')])")
    expect(out).toBe("el(\"button\", { onClick: () => send({ type: 'inc' }) }, [staticText('+')])")
  })
  it('children-only form (no props)', () => {
    expect(tx("div([text(state.at('n'))])")).toBe(
      'el("div", {}, [signalText((s) => s.n, [\'n\'])])',
    )
  })
  it('nested elements + mixed slots', () => {
    const out = tx("div({}, [span({}, [text(state.at('a'))]), text('lit'), text(state.at('b'))])")
    expect(out).toBe(
      "el(\"div\", {}, [el(\"span\", {}, [signalText((s) => s.a, ['a'])]), staticText('lit'), signalText((s) => s.b, ['b'])])",
    )
  })
})

describe('transformNodeExpr — structural primitives', () => {
  it('lowers each to signalEach (items spec, key verbatim, render under item root)', () => {
    const out = tx(
      "each(state.at('todos'), { key: (t) => t.id, render: (item) => [text(item.at('title'))] })",
    )
    expect(out).toBe(
      "signalEach({ items: (s) => s.todos, deps: ['todos'] }, (t) => t.id, () => [signalText((ctx) => ctx.item.title, ['item.title'])])",
    )
  })

  it('multi-root each: a row reading component state merges its dep into source.deps', () => {
    // the jfb-ticker pattern: rows read item fields AND a shared dashboard.mode
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (r) => [tr({ class: state.at('mode') }, [td([text(r.at('name'))])])] })",
    )
    // the element-wrapped static-skeleton row lowers to the direct fast path
    expect(out).toContain('signalEachDirect(')
    // source deps merge: items 'rows' + the row's component-state read 'mode'
    expect(out).toContain("items: (s) => s.rows, deps: ['rows', 'mode']")
    // item read -> ctx.item (text binding); component-state read -> ctx.state
    // (reactive-attr binding); both wired by direct node reference
    expect(out).toContain('produce: (ctx) => ctx.item.name')
    expect(out).toContain("deps: ['item.name']")
    expect(out).toContain('produce: (ctx) => ctx.state.mode')
    expect(out).toContain("deps: ['state.mode']")
  })

  it('leaves an each VERBATIM when the render passes the row param to a helper call', () => {
    // `render: (item) => [activityItem(item, ...)]` — the row param leaks into a
    // verbatim helper call the lowered `() => [...]` render can't bind, so lowering
    // would emit a free `item` -> `item is not defined` at runtime. Stay verbatim:
    // the runtime authoring `each` binds a real item handle. (dashboard demo bug.)
    const src =
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [activityItem(item, state.at('locale'))] })"
    expect(tx(src)).toBe(src)
  })

  it('leaves an each VERBATIM when the render reads the index param in a helper call', () => {
    const src =
      "each(state.at('rows'), { key: (r) => r.id, render: (item, index) => [priorityItem(item, index, parts)] })"
    expect(tx(src)).toBe(src)
  })

  it('lowers an each whose handler reads the row param to signalEachDirect (live ctx)', () => {
    // the universal toggle/remove-by-id list row: `item` leaks ONLY into an event
    // handler. The direct factory binds it by reading the live row ctx at event
    // time — `item.at('id').peek()` -> `getCtx().item.id` — instead of bailing.
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [button({ onClick: () => send({ type: 'rm', id: item.at('id').peek() }) }, [text(item.at('name'))])] })",
    )
    expect(out).toContain('signalEachDirect(')
    // the factory takes the live-ctx accessor and attaches a click listener whose
    // item read is lowered to a getCtx() read; the row param is NOT a free var
    expect(out).toContain('(doc, getCtx) =>')
    expect(out).toContain(
      'addEventListener("click", () => send({ type: \'rm\', id: getCtx().item.id }))',
    )
    // the reactive text child still lowers to a ctx-read binding
    expect(out).toContain('produce: (ctx) => ctx.item.name')
  })

  it('lowers a handler reading index + state via .peek() to live-ctx reads', () => {
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item, index) => [button({ onClick: () => send({ type: 'x', i: index.peek(), m: state.at('mode').peek() }) }, [text(item.at('name'))])] })",
    )
    expect(out).toContain('signalEachDirect(')
    expect(out).toContain(
      'addEventListener("click", () => send({ type: \'x\', i: getCtx().index, m: getCtx().state.mode }))',
    )
  })

  it('leaves an each VERBATIM when the row param leaks into a handler as a HANDLE (non-peek)', () => {
    // `f(item)` passes the item handle itself — the factory can't rewrite that to a
    // ctx read, so the leak guard bails to the runtime authoring each (real handle).
    const src =
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [button({ onClick: () => f(item) }, [text(item.at('name'))])] })"
    expect(tx(src)).toBe(src)
  })

  it('falls back to signalEach when a handler is a tagSend(...) call (needs authoring path)', () => {
    // a tagged handler registers agent-dispatchable variants via the authoring
    // populate path; the direct factory can't, so it falls back to signalEach (which
    // still lowers the row, just through the render callback).
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [button({ onClick: tagSend('rm', () => send({ type: 'rm' })) }, [text(item.at('name'))])] })",
    )
    expect(out).toContain('signalEach(')
    expect(out).not.toContain('signalEachDirect(')
  })

  it('leaves an each VERBATIM when the render is a block body (not a concise array)', () => {
    // A block-body render `(item) => { return [...] }` used to be returned whole by
    // renderArraySrc, producing the malformed `signalEach(..., () => (item) => {...})`
    // — a render that yields the arrow instead of nodes. Stay verbatim.
    const src =
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => { return [text(item.at('name'))] } })"
    expect(tx(src)).toBe(src)
  })

  it('leaves a SHOW verbatim when the then-arm leaks its narrowed param to a helper', () => {
    // show(cond, (u) => [profileCard(u)]) lowered to `() => [profileCard(u)]` — the
    // narrowed `u` is free. Stay verbatim so the runtime show binds a real handle.
    const src = "show(state.at('user'), (u) => [profileCard(u)])"
    expect(tx(src)).toBe(src)
  })

  it('leaves a SHOW verbatim when an arm is a block body', () => {
    const src = "show(state.at('open'), () => { return [text('x')] })"
    expect(tx(src)).toBe(src)
  })

  it('leaves a BRANCH verbatim when a narrowed arm leaks its param to a helper', () => {
    // branch(value, disc, { loaded: (v) => [loadedView(v)] }) — `v` is free in the
    // lowered param-less arm. Stay verbatim; runtime branch binds the variant handle.
    const src =
      "branch(state.at('view'), (x) => x.kind, { loading: () => [text('…')], loaded: (v) => [loadedView(v)] })"
    expect(tx(src)).toBe(src)
  })

  it('leaves a BRANCH verbatim when an arm is a block body', () => {
    const src = "branch(state.at('filter'), { all: () => { return [text('a')] } })"
    expect(tx(src)).toBe(src)
  })

  it('lowers show to signalShow (cond spec, content under state root)', () => {
    const out = tx("show(state.at('open'), () => [text(state.at('name'))])")
    expect(out).toBe(
      "signalShow({ produce: (s) => s.open, deps: ['open'] }, () => [signalText((s) => s.name, ['name'])])",
    )
  })

  it('lowers the 2-arg plain form (string signal as discriminant, no narrowing)', () => {
    const out = tx(
      "branch(state.at('filter'), { all: () => [text('a')], done: () => [text('d')] })",
    )
    expect(out).toBe(
      "signalBranch({ produce: (s) => s.filter, deps: ['filter'] }, { all: () => [staticText('a')], done: () => [staticText('d')] })",
    )
  })

  it('lowers branch to signalBranch (key fn -> value.disc spec, key-only arms)', () => {
    const out = tx(
      "branch(state.at('view'), (v) => v.kind, { loading: () => [text('…')], loaded: () => [text(state.at('title'))] })",
    )
    expect(out).toBe(
      "signalBranch({ produce: (s) => (s.view).kind, deps: ['view.kind'] }, { loading: () => [staticText('…')], loaded: () => [signalText((s) => s.title, ['title'])] })",
    )
  })

  it('lowers a branch arm that reads its NARROWED variant signal (v -> value path)', () => {
    const out = tx(
      "branch(state.at('view'), (x) => x.type, { loaded: (v) => [text(v.at('data'))] })",
    )
    expect(out).toBe(
      "signalBranch({ produce: (s) => (s.view).type, deps: ['view.type'] }, { loaded: () => [signalText((s) => s.view.data, ['view.data'])] })",
    )
  })

  it('lowers foreign: state record -> SignalSpecs, mount/unmount verbatim', () => {
    const out = tx(
      "foreign({ state: { content: state.at('doc'), theme: state.at('ui.theme') }, mount: ({ el, state }) => new Editor(el, state), unmount: (i) => i.destroy() })",
    )
    expect(out).toBe(
      "signalForeign({ state: { content: { produce: (s) => s.doc, deps: ['doc'] }, theme: { produce: (s) => s.ui.theme, deps: ['ui.theme'] } }, mount: ({ el, state }) => new Editor(el, state), unmount: (i) => i.destroy() })",
    )
  })

  it('lowers a show arm that reads its NARROWED param (rebased onto cond path)', () => {
    const out = tx("show(state.at('user'), (u) => [text(u.at('name'))])")
    expect(out).toBe(
      "signalShow({ produce: (s) => s.user, deps: ['user'] }, () => [signalText((s) => s.user.name, ['user.name'])])",
    )
  })

  it('lowers show with an else arm (3rd argument)', () => {
    const out = tx("show(state.at('open'), () => [text('on')], () => [text('off')])")
    expect(out).toBe(
      "signalShow({ produce: (s) => s.open, deps: ['open'] }, () => [staticText('on')], () => [staticText('off')])",
    )
  })

  it('lowers a mapped cond in show', () => {
    const out = tx("show(state.at('count').map((c) => c > 0), () => [text('positive')])")
    expect(out).toBe(
      "signalShow({ produce: (s) => ((c) => c > 0)(s.count), deps: ['count'] }, () => [staticText('positive')])",
    )
  })
})

describe('transformNodeExpr — unrecognized forms left verbatim', () => {
  it('structural / helper calls are not rewritten (yet)', () => {
    expect(tx('each(state.at("items"), opts)')).toBe('each(state.at("items"), opts)')
    expect(tx('todoRow({ state: state.at("t"), send })')).toBe(
      'todoRow({ state: state.at("t"), send })',
    )
  })
})

describe('transformNodeExpr — block-body each rows (cross-function lowering, phase 1)', () => {
  const kind = (out: string): 'direct' | 'each' | 'verbatim' =>
    out.includes('signalEachDirect(') ? 'direct' : out.includes('signalEach(') ? 'each' : 'verbatim'

  it('lowers a block-body row to signalEachDirect: decl rewritten, static-from-local text + handler', () => {
    const out = tx(
      "each(state.at('files'), { key: (f) => f.id, render: (item) => { const isDir = item.peek().type === 'dir'; return [span({ class: isDir ? 'd' : 'f' }, [text(isDir ? '📁' : '📄'), text(item.at('name'))])] } })",
    )
    expect(out).toContain('signalEachDirect(')
    expect(out).toContain('(doc, getCtx) =>')
    // the local is emitted at the top with the .peek() read rewritten to live ctx
    expect(out).toContain("const isDir = getCtx().item.type === 'dir'")
    // static value from the local → one-time text node + applyAttr, not a binding
    expect(out).toContain("doc.createTextNode(String(isDir ? '📁' : '📄'))")
    expect(out).toContain("applyAttr(_n0, \"class\", isDir ? 'd' : 'f')")
    // the reactive read stays a binding
    expect(out).toContain('produce: (ctx) => ctx.item.name')
  })

  it('bails to authoring when a local is SIGNAL-bound (opaque alias)', () => {
    expect(
      kind(
        tx(
          "each(state.at('r'), { key: (r) => r.id, render: (item) => { const n = item.at('x'); return [li([text(n)])] } })",
        ),
      ),
    ).toBe('verbatim')
  })

  it('bails when a non-declaration statement precedes the return', () => {
    expect(
      kind(
        tx(
          "each(state.at('r'), { key: (r) => r.id, render: (item) => { sideEffect(); return [li([text(item.at('x'))])] } })",
        ),
      ),
    ).toBe('verbatim')
  })

  it('bails on a data-conditional return (per-row structure varies)', () => {
    expect(
      kind(
        tx(
          "each(state.at('r'), { key: (r) => r.id, render: (item) => { const d = item.peek().d; return d ? [li([])] : [span([])] } })",
        ),
      ),
    ).toBe('verbatim')
  })

  it('bails when a decl leaks the row param as a handle', () => {
    expect(
      kind(
        tx(
          "each(state.at('r'), { key: (r) => r.id, render: (item) => { const x = item; return [li([text(x.at('n'))])] } })",
        ),
      ),
    ).toBe('verbatim')
  })
})
