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
    expect(out).toContain('= (ctx) => ctx.item.name')
    expect(out).toContain("= ['item.name']")
    expect(out).toContain('= (ctx) => ctx.state.mode')
    expect(out).toContain("= ['state.mode']")
  })

  it('hoists row-invariant deps arrays + produce closures out of the per-row factory', () => {
    // `deps: ['item.label']` and `produce: (ctx) => ctx.item.label` are
    // row-INDEPENDENT — allocating them per row was 2 extra objects per binding
    // per row (40k allocations on a jfb create-10k). They hoist to per-each-site
    // consts next to the cached skeleton; only the node-capturing `commit` stays
    // per row.
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [li({ class: item.at('cls') }, [text(item.at('label'))])] })",
    )
    expect(out).toContain('signalEachDirect(')
    expect(out).toContain("const _bd0 = ['item.cls']")
    expect(out).toContain("const _bd1 = ['item.label']")
    expect(out).toContain('const _bp0 = (ctx) => ctx.item.cls')
    expect(out).toContain('const _bp1 = (ctx) => ctx.item.label')
    expect(out).toContain('deps: _bd0, produce: _bp0,')
    expect(out).toContain('deps: _bd1, produce: _bp1,')
    // nothing per-row but the commit closure
    expect(out).not.toContain("deps: ['item.label'], produce:")
  })

  it('dedupes identical hoisted deps arrays across bindings', () => {
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [li({}, [text(item.at('label')), text(item.at('label').map((l) => l + '!'))])] })",
    )
    expect(out).toContain('signalEachDirect(')
    // both bindings read ['item.label'] — one shared const
    expect((out.match(/const _bd\d+ = \['item\.label'\]/g) ?? []).length).toBe(1)
  })

  it('keeps a produce INLINE when it reads a per-row block-body local', () => {
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => { const base = item.peek().base; return [li({}, [text(item.at('count').map((c) => c + base))])] } })",
    )
    expect(out).toContain('signalEachDirect(')
    // deps still hoist; the produce closes over the row local `base` -> per-row
    expect(out).toContain("const _bd0 = ['item.count']")
    expect(out).toMatch(/produce: \(ctx\) => .*base/)
    expect(out).not.toMatch(/const _bp\d+ = .*base/)
  })

  it('lowers an each whose render passes the row param to a helper call (rowHandle prelude)', () => {
    // `render: (item) => [activityItem(item, ...)]` — the row param leaks into a
    // verbatim helper call. The arm binds it to a REAL runtime handle (the same
    // pathHandle the authoring `each` creates), so the helper receives a genuine
    // Signal<T> and the each still lowers. Whole-state residue dep added: the
    // helper may read state invisibly.
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [activityItem(item, state.at('locale'))] })",
    )
    expect(out).toContain('signalEach(')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain("activityItem(item, state.at('locale'))")
    expect(out).toContain("deps: ['rows', '']") // items dep + whole-state residue
  })

  it('lowers an each whose render reads the index param in a helper call (index handle)', () => {
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item, index) => [priorityItem(item, index, parts)] })",
    )
    expect(out).toContain('signalEach(')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain("const index = rowHandle(getCtx, 'index')")
    expect(out).toContain('priorityItem(item, index, parts)')
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
    // the reactive text child still lowers to a ctx-read binding (hoisted const)
    expect(out).toContain('= (ctx) => ctx.item.name')
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

  it('lowers a handler passing the row param as a HANDLE (non-peek) via the prelude', () => {
    // `f(item)` passes the item handle itself — the factory can't rewrite that to
    // a ctx read, but the render arm binds `item` to a real runtime handle, so
    // `f` receives a live Signal<T> at event time (authoring-identical semantics).
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [button({ onClick: () => f(item) }, [text(item.at('name'))])] })",
    )
    expect(out).toContain('signalEach(')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain('onClick: () => f(item)')
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

  it('lowers a BLOCK-BODY render on the arm path when the factory bails (decls kept)', () => {
    // decls + return [...] — the factory bails (helper child), the arm keeps the
    // decls verbatim; the decl's item read makes `item` leak → rowHandle prelude.
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => { const nm = item.peek().name; return [li({}, [badge(nm), text(item.at('name'))])] } })",
    )
    expect(out).toContain('signalEach(')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain('const nm = item.peek().name')
    expect(out).toContain('badge(nm)')
  })

  it('leaves an each VERBATIM when the render block has a NON-decl statement', () => {
    const src =
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => { doSideEffect(); return [text(item.at('name'))] } })"
    expect(tx(src)).toBe(src)
  })

  it('leaves a SHOW verbatim when the then-arm leaks its narrowed param to a helper', () => {
    // show(cond, (u) => [profileCard(u)]) lowered to `() => [profileCard(u)]` — the
    // narrowed `u` is free. Stay verbatim so the runtime show binds a real handle.
    const src = "show(state.at('user'), (u) => [profileCard(u)])"
    expect(tx(src)).toBe(src)
  })

  it('lowers a SHOW arm with a block body (decls + return [...])', () => {
    const out = tx(
      "show(state.at('open'), () => { const cls = 'x'; return [div({ class: cls }, [])] })",
    )
    expect(out).toContain('signalShow(')
    expect(out).toContain("const cls = 'x'")
    expect(out).toContain('return [el("div", { class: cls }, [])]')
  })

  it('still leaves a SHOW verbatim when an arm block has a NON-decl statement', () => {
    const src = "show(state.at('open'), () => { doSideEffect(); return [text('x')] })"
    expect(tx(src)).toBe(src)
  })

  it('leaves a BRANCH verbatim when a narrowed arm leaks its param to a helper', () => {
    // branch(value, disc, { loaded: (v) => [loadedView(v)] }) — `v` is free in the
    // lowered param-less arm. Stay verbatim; runtime branch binds the variant handle.
    const src =
      "branch(state.at('view'), (x) => x.kind, { loading: () => [text('…')], loaded: (v) => [loadedView(v)] })"
    expect(tx(src)).toBe(src)
  })

  it('lowers a BRANCH arm with a block body (decls + return)', () => {
    const out = tx("branch(state.at('filter'), { all: () => { return [text('a')] } })")
    expect(out).toContain('signalBranch(')
    expect(out).toContain("all: () => [staticText('a')]")
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
    // the local is emitted at the top of the per-clone section, .peek() → live ctx
    expect(out).toContain("const isDir = getCtx().item.type === 'dir'")
    // static value from the local → placeholder text node + per-clone .data, not a binding
    expect(out).toContain("data = String(isDir ? '📁' : '📄')")
    // per-row static attr on the top root (located as the clone root `_r0`)
    expect(out).toContain("applyAttr(_r0, \"class\", isDir ? 'd' : 'f')")
    // the reactive read stays a binding (hoisted produce const)
    expect(out).toContain('= (ctx) => ctx.item.name')
  })

  it('lowers a PEEKED-VALUE local (const v = item.peek()) — a value, not a handle alias', () => {
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => { const v = item.peek(); return [li([text(v.label)])] } })",
    )
    expect(out).toContain('signalEachDirect(')
    expect(out).toContain('const v = getCtx().item') // peek read → live ctx, value local
    expect(out).toContain('data = String(v.label)') // static from the value local, per-clone .data
  })

  it('lowers a row whose class string CONTAINS the row-param name (no false leak)', () => {
    // `class: 'activity-item'` contains the substring "item" — the AST leak guard must
    // not treat that string literal as a free `item` reference.
    const out = tx(
      "each(state.at('rows'), { key: (r) => r.id, render: (item) => [li({ class: 'activity-item' }, [text(item.at('label'))])] })",
    )
    expect(out).toContain('signalEachDirect(')
    expect(out).toContain('setAttribute("class", "activity-item")')
  })

  it('a SIGNAL-bound local (opaque alias) lowers via the arm + rowHandle prelude', () => {
    // the factory bails (handle alias is opaque to the static tracer), but the
    // arm keeps the decl verbatim and binds `item` to a real handle — the alias
    // is then a genuine sub-handle the runtime `text` consumes reactively.
    const out = tx(
      "each(state.at('r'), { key: (r) => r.id, render: (item) => { const n = item.at('x'); return [li([text(n)])] } })",
    )
    expect(kind(out)).toBe('each')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain("const n = item.at('x')")
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

  it('a decl aliasing the row param lowers via the arm + rowHandle prelude', () => {
    const out = tx(
      "each(state.at('r'), { key: (r) => r.id, render: (item) => { const x = item; return [li([text(x.at('n'))])] } })",
    )
    expect(kind(out)).toBe('each')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain('const x = item')
  })
})
