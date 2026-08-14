import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { lintSignals, applyLintFixes, type SignalDiagnostic } from '../../src/signals/rules.js'
import { lintSignalSource, lintTagSendSource } from '../parsed.js'

function lint(src: string): SignalDiagnostic[] {
  const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true)
  return lintSignals(sf)
}
const rules = (src: string): string[] => [...new Set(lint(src).map((d) => d.rule))].sort()
const messageFor = (src: string, rule: string): string =>
  lint(src).find((d) => d.rule === rule)?.message ?? ''

describe('operator-on-signal', () => {
  it('flags arithmetic / comparison / template / ternary / logical / unary on a signal', () => {
    expect(rules("const x = state.at('n') + 1")).toContain('operator-on-signal')
    expect(rules("const x = state.at('n') === 0")).toContain('operator-on-signal')
    expect(rules('const x = `v${state.at("n")}`')).toContain('operator-on-signal')
    expect(rules("const x = state.at('flag') ? a : b")).toContain('operator-on-signal')
    expect(rules("const x = state.at('flag') && y")).toContain('operator-on-signal')
    expect(rules("const x = !state.at('flag')")).toContain('operator-on-signal')
  })
  it('does NOT flag operations on plain values inside a .map body', () => {
    expect(rules("state.at('n').map((v) => v + 1)")).not.toContain('operator-on-signal')
    expect(rules("state.at('s').map((v) => `hi ${v}`)")).not.toContain('operator-on-signal')
  })
  it('quotes the offending expression AND the operator in the message', () => {
    const msg = messageFor("const x = state.at('n') + 1", 'operator-on-signal')
    // the exact offending signal expression, copy-pasteable into the fix
    expect(msg).toContain("state.at('n')")
    // the operator that triggered it
    expect(msg).toContain('(+)')
    // a tailored .map() example built from that expression
    expect(msg).toContain("state.at('n').map(")
  })
  it('does NOT flag operators on a .peek() snapshot (peek yields a plain value)', () => {
    // common in event handlers: read current value, then compute/compare
    expect(
      rules("button({ onClick: () => { if (state.at('n').peek() > 0) send({type:'x'}) } }, [])"),
    ).not.toContain('operator-on-signal')
    expect(
      rules("button({ onClick: () => send({ n: state.at('n').peek() + 1 }) }, [])"),
    ).not.toContain('operator-on-signal')
  })
})

describe('pure-derive-body', () => {
  it('flags side effects in a .map body', () => {
    expect(rules("state.at('n').map((v) => { fetch('/x'); return v })")).toContain(
      'pure-derive-body',
    )
    expect(rules("state.at('n').map((v) => { send({ type: 'x' }); return v })")).toContain(
      'pure-derive-body',
    )
    expect(rules("state.at('n').map((v) => { setTimeout(() => 0, 1); return v })")).toContain(
      'pure-derive-body',
    )
  })
  it('flags reactive primitives (.peek/.at/.map on a signal) in a derive body', () => {
    expect(rules("state.at('n').map((v) => v + state.at('m').peek())")).toContain(
      'pure-derive-body',
    )
    expect(rules("derived([state.at('a')], (a) => a + state.at('b').peek())")).toContain(
      'pure-derive-body',
    )
  })
  it('does NOT flag a pure value transform', () => {
    expect(rules("state.at('user').map((u) => u.name.toUpperCase())")).not.toContain(
      'pure-derive-body',
    )
    expect(rules("state.at('items').map((a) => a.filter((x) => x.done).length)")).not.toContain(
      'pure-derive-body',
    )
  })
})

describe('no-node-construction-in-body', () => {
  it('flags building DOM inside a derive body', () => {
    expect(
      rules("state.at('items').map((items) => items.map((i) => div([text(i.name)])))"),
    ).toContain('no-node-construction-in-body')
  })
  it('does NOT flag plain computation', () => {
    expect(rules("state.at('items').map((a) => a.length > 0)")).not.toContain(
      'no-node-construction-in-body',
    )
  })
  it('does NOT flag a static (non-signal) Array.map building DOM (static child list)', () => {
    // A plain array `.map` that builds nodes runs once at build time — it is a
    // legitimate way to spread a static list of children (e.g. <option>s).
    expect(rules('select({}, OPTS.map((k) => option({ value: k }, [text(k)])))')).not.toContain(
      'no-node-construction-in-body',
    )
  })
  it('still flags DOM built directly in a signal .map body', () => {
    expect(rules("state.at('items').map((i) => option({ value: i }, [text(i)]))")).toContain(
      'no-node-construction-in-body',
    )
  })
  // Shared-constants unification: tags that were missing from rules' drifted copy
  // of the element set (strong/tbody/em/…) are now recognized, so building them in
  // a derive body is no longer a false NEGATIVE.
  it('flags previously-missing element tags (strong/tbody) built in a derive body', () => {
    expect(rules("state.at('x').map((v) => strong([text(v)]))")).toContain(
      'no-node-construction-in-body',
    )
    expect(rules("state.at('x').map((v) => tbody([text(v)]))")).toContain(
      'no-node-construction-in-body',
    )
  })
})

describe('prefer-at-over-map', () => {
  it('flags a plain single-field projection on a signal .map (use .at)', () => {
    expect(rules('text(state.map((s) => s.name))')).toContain('prefer-at-over-map')
    expect(rules("state.at('user').map((u) => u.name)")).toContain('prefer-at-over-map')
    expect(rules("state.map((s) => s['name'])")).toContain('prefer-at-over-map')
  })
  it('flags it on an each row item signal', () => {
    expect(
      rules(
        "each(state.at('rows'), { key: (r) => r.id, render: (item) => [text(item.map((r) => r.commonName))] })",
      ),
    ).toContain('prefer-at-over-map')
  })
  it('does NOT flag a computed body (transform / multi-field / method / nested / predicate)', () => {
    expect(rules('text(state.map((s) => String(s.n)))')).not.toContain('prefer-at-over-map')
    expect(rules('text(state.map((s) => s.a + s.b))')).not.toContain('prefer-at-over-map')
    expect(rules("text(state.map((s) => (s.flag ? 'x' : 'y')))")).not.toContain(
      'prefer-at-over-map',
    )
    expect(rules('text(state.map((s) => s.user.name))')).not.toContain('prefer-at-over-map')
    expect(rules('text(state.map((s) => s.name.toUpperCase()))')).not.toContain(
      'prefer-at-over-map',
    )
    expect(rules('text(state.map((s) => s.items.length > 0))')).not.toContain('prefer-at-over-map')
  })
  it('does NOT flag a plain Array.map (receiver is not a signal)', () => {
    expect(rules('OPTS.map((o) => o.label)')).not.toContain('prefer-at-over-map')
  })
  it('does NOT flag an opaque accessor passed to .map (no inline arrow to narrow)', () => {
    expect(rules('text(state.map(b.planName))')).not.toContain('prefer-at-over-map')
  })
})

// The whole-`state`-coarseness rule was removed: rendering a whole-state object is
// already a TYPE error (`text`/`AttrValue` = `Reactive<string|number>`), and a
// `Signal` coerced into a template/operator is caught by `operator-on-signal`
// (below). A "pass a slice" rule added nothing real — `fmt(state)` → `state.map(fmt)`
// keeps the same dep, and it over-fired on composition like `shell(state)`.
describe('coarse whole-state is NOT a lint error (covered by types + operator-on-signal)', () => {
  it('does not flag whole state passed to a call (composition or otherwise)', () => {
    expect(rules('shell(state)')).toEqual([])
    expect(rules('text(formError(state))')).toEqual([])
    expect(rules('const [next, fx] = update(state, msg)')).toEqual([])
  })
  it('STILL flags a signal coerced into a template/operator (type-invisible) via operator-on-signal', () => {
    expect(rules('text(`hello ${state}`)')).toContain('operator-on-signal')
    expect(rules("text(`n=${state.at('n')}`)")).toContain('operator-on-signal')
  })
})

describe('row-scoped signals are checked inside each/show/branch bodies', () => {
  it('flags operators on an each row item/index signal', () => {
    expect(
      rules(
        "each(state.at('todos'), { key: (t) => t.id, render: (item) => [text(item.at('done') ? 'x' : 'y')] })",
      ),
    ).toContain('operator-on-signal')
    expect(
      rules(
        "each(state.at('todos'), { key: (t) => t.id, render: (item, index) => [text(index + 1)] })",
      ),
    ).toContain('operator-on-signal')
    expect(
      rules(
        "each(state.at('rows'), { key: (r) => r.id, render: (item) => [text(item.at('price') * 2)] })",
      ),
    ).toContain('operator-on-signal')
  })

  it('flags operators on a show narrowed signal', () => {
    expect(
      rules("show(state.at('user'), (u) => [text(u.at('age') >= 18 ? 'adult' : 'minor')])"),
    ).toContain('operator-on-signal')
  })

  it('flags operators on a branch narrowed arm signal', () => {
    expect(
      rules("branch(state.at('view'), 'type', { loaded: (v) => [text(v.at('count') + 1)] })"),
    ).toContain('operator-on-signal')
  })

  it('does NOT flag arithmetic on the key fn plain param (item is a value there)', () => {
    expect(
      rules(
        "each(state.at('todos'), { key: (t) => t.id + 1, render: (item) => [text(item.at('title'))] })",
      ),
    ).not.toContain('operator-on-signal')
  })

  it('does NOT flag idiomatic row bodies', () => {
    expect(
      lint(
        "each(state.at('todos'), { key: (t) => t.id, render: (item) => [text(item.at('title'))] })",
      ),
    ).toEqual([])
    expect(lint("show(state.at('user'), (u) => [text(u.at('name'))])")).toEqual([])
  })
})

describe('peek-in-slot', () => {
  it('flags a .peek() snapshot used directly in a reactive slot', () => {
    expect(rules("text(state.at('x').peek())")).toContain('peek-in-slot')
    expect(rules("div({ class: state.at('x').peek() }, [])")).toContain('peek-in-slot')
  })

  it('flags a .peek() in a row slot (item signal)', () => {
    expect(
      rules("each(state.at('todos'), { key: (t) => t.id, render: (item) => [text(item.peek())] })"),
    ).toContain('peek-in-slot')
  })

  it('quotes the receiver and suggests .at()/.map() concretely', () => {
    const msg = messageFor("text(state.at('todos').peek())", 'peek-in-slot')
    expect(msg).toContain("state.at('todos').peek()")
    expect(msg).toContain("state.at('todos').at('field')")
    expect(msg).toContain("state.at('todos').map(")
  })

  it('teaches the sanctioned one-shot read (block-body render const + plain-value helpers)', () => {
    // The message must name the legitimate snapshot path so authors do not
    // reinvent the laundering wrapper (a fn whose param isn't `state`) — that
    // trick would re-open the bypass the non-bypassable-error design prevents.
    const msg = messageFor("text(state.at('x').peek())", 'peek-in-slot')
    expect(msg).toContain('block-body render `const`')
    expect(msg).toContain('plain value')
  })

  it('does NOT flag an outer state.peek() snapshot in a block-body render const', () => {
    // The value-aligned refactor for an intentional one-shot read: take the
    // snapshot at the render boundary, then pass the plain value to a helper.
    expect(
      rules(
        "each(state.at('decls'), { key: (d) => d.id, render: (declSig) => { const decl = declSig.peek(); const snap = state.peek(); return [control(resolveInputKind(decl, snap, id))] } })",
      ),
    ).not.toContain('peek-in-slot')
  })

  it('does NOT flag a pure helper that takes a plain snapshot (no live signal, no .peek)', () => {
    // resolveInputKind refactored to plain-in/plain-out: nothing to flag, and
    // crucially it no longer needs a `peekOnce`-style laundering wrapper.
    expect(
      rules(
        "function resolveInputKind(decl, snap, id) { const v = currentValue(factAt(snap, id, decl.id)); return isRangeShape(v) ? 'range' : decl.value_kind[0] }",
      ),
    ).not.toContain('peek-in-slot')
  })

  it('does NOT flag .peek() inside an event handler', () => {
    expect(rules("button({ onClick: () => send(state.at('x').peek()) }, [])")).not.toContain(
      'peek-in-slot',
    )
    expect(
      rules(
        "each(state.at('todos'), { key: (t) => t.id, render: (item) => [button({ onClick: () => send(item.peek()) }, [])] })",
      ),
    ).not.toContain('peek-in-slot')
  })

  it('does NOT flag .peek() inside a .map/derived body (pure-derive-body owns that)', () => {
    const r = rules("state.at('n').map((v) => v + state.at('m').peek())")
    expect(r).not.toContain('peek-in-slot')
    expect(r).toContain('pure-derive-body')
  })

  it('does NOT flag a .peek() initializing a block-body render LOCAL (the render-once row idiom)', () => {
    // `const isDir = item.peek().type === 'dir'` is the documented row-local
    // shape — it runs once per ROW on both the authoring path and the compiled
    // factory (wire decls), so flagging it would contradict the compiler.
    expect(
      rules(
        "each(state.at('entries'), { key: (e) => e.sha, render: (item) => { const isDir = item.peek().type === 'dir'; return [text(isDir ? 'd' : 'f')] } })",
      ),
    ).not.toContain('peek-in-slot')
  })

  it('still flags a .peek() in a reactive SLOT inside a block-body render', () => {
    expect(
      rules(
        "each(state.at('entries'), { key: (e) => e.sha, render: (item) => { const x = 1; return [text(item.peek().name)] } })",
      ),
    ).toContain('peek-in-slot')
  })
})

describe('at-after-map', () => {
  it('flags .at() chained after a signal .map()', () => {
    expect(rules("text(state.at('user').map((u) => u.profile).at('name'))")).toContain(
      'at-after-map',
    )
  })
  it('flags .at() chained after derived()', () => {
    expect(
      rules("text(derived([state.at('a'), state.at('b')], (a, b) => ({ x: a + b })).at('x'))"),
    ).toContain('at-after-map')
  })
  it('flags .at() after a multi-.map() chain', () => {
    expect(rules("text(state.at('a').map((a) => a).map((a) => a).at('x'))")).toContain(
      'at-after-map',
    )
  })
  it('flags it on a row item signal too', () => {
    expect(
      rules(
        "each(state.at('rows'), { key: (r) => r.id, render: (item) => [text(item.map((r) => r.meta).at('label'))] })",
      ),
    ).toContain('at-after-map')
  })
  it('does NOT flag the idiomatic slice-before-map order', () => {
    expect(rules("text(state.at('user').at('name').map((n) => n.toUpperCase()))")).not.toContain(
      'at-after-map',
    )
  })
  it('does NOT flag .at() on a plain (non-signal) array .map result', () => {
    expect(rules('OPTS.map((o) => o).at')).not.toContain('at-after-map')
  })
  it('message names the fix order', () => {
    const msg = messageFor("text(state.at('a').map((a) => a).at('x'))", 'at-after-map')
    expect(msg).toContain('.at()')
    expect(msg).toContain('BEFORE')
  })
})

describe('bag alias — lint uses the view’s actual state alias', () => {
  it('flags a violation under an aliased state bag ({ state: s })', () => {
    const src =
      "component({ init: () => ({ n: 0 }), update: (s) => s, view: ({ state: s }) => [text(s.at('n') + 1)] })"
    expect(rules(src)).toContain('operator-on-signal')
  })

  it('flags under the default { state } alias inside a component', () => {
    const src = "component({ view: ({ state }) => [text(state.at('n') + 1)] })"
    expect(rules(src)).toContain('operator-on-signal')
  })

  it('clean aliased component produces no diagnostics', () => {
    const src = "component({ view: ({ state: s }) => [text(s.at('name'))] })"
    expect(lint(src)).toEqual([])
  })

  it('does not flag plain values in init/update (no signal root there)', () => {
    const src =
      "component({ init: () => ({ n: 0 }), update: (s, m) => ({ n: s.n + 1 }), view: ({ state }) => [text(state.at('n'))] })"
    expect(lint(src)).toEqual([])
  })
})

describe('clean signal code produces no diagnostics', () => {
  it('idiomatic usage', () => {
    const src = [
      "text(state.at('user.name'))",
      "text(state.at('user').map((u) => `Hi ${u.name}`))",
      "div({ class: state.at('busy').map((b) => (b ? 'spin' : 'idle')) }, [])",
      "derived([state.at('a'), state.at('b')], (a, b) => a + b)",
    ].join('\n')
    expect(lint(src)).toEqual([])
  })
})

describe('async-update', () => {
  it('flags an async update reducer', () => {
    const src = `component({ init: () => ({ n: 0 }), update: async (s, m) => [s, []], view: ({ state }) => [] })`
    expect(rules(src)).toContain('async-update')
  })
  it('flags an async init', () => {
    const src = `component({ init: async () => ({ n: 0 }), update: (s) => s, view: ({ state }) => [] })`
    expect(rules(src)).toContain('async-update')
  })
  it('does NOT flag a synchronous reducer', () => {
    const src = `component({ init: () => ({ n: 0 }), update: (s, m) => [s, []], view: ({ state }) => [] })`
    expect(rules(src)).not.toContain('async-update')
  })
  it('does NOT flag an async onEffect (effects may be async, fire-and-forget)', () => {
    const src = `component({ init: () => ({ n: 0 }), update: (s) => s, onEffect: async (e) => {}, view: ({ state }) => [] })`
    expect(rules(src)).not.toContain('async-update')
  })
})

describe('controlled-input', () => {
  it('flags an input with a reactive value but no onInput/onChange', () => {
    expect(rules("input({ value: state.at('name') }, [])")).toContain('controlled-input')
    expect(rules("textarea({ value: state.at('bio') }, [])")).toContain('controlled-input')
  })
  it('does NOT flag when onInput is present', () => {
    expect(
      rules("input({ value: state.at('name'), onInput: (e) => send({ type: 'x' }) }, [])"),
    ).not.toContain('controlled-input')
  })
  it('does NOT flag when onChange is present', () => {
    expect(
      rules("input({ value: state.at('name'), onChange: (e) => send({ type: 'x' }) }, [])"),
    ).not.toContain('controlled-input')
  })
  it('does NOT flag a static (non-reactive) value', () => {
    expect(rules("input({ value: 'static' }, [])")).not.toContain('controlled-input')
  })
  it('does NOT flag a one-shot .peek() value', () => {
    expect(rules("input({ value: state.at('name').peek() }, [])")).not.toContain('controlled-input')
  })
  it('does NOT flag when props are spread (cannot reason about dynamic props)', () => {
    expect(rules("input({ ...attrs, value: state.at('name') }, [])")).not.toContain(
      'controlled-input',
    )
  })
  // Finding 8: a readonly / disabled input can't be typed into, so a reactive
  // value re-asserting state is correct — not a controlled-input bug.
  it('does NOT flag a readonly input', () => {
    expect(rules("input({ value: state.at('name'), readonly: true }, [])")).not.toContain(
      'controlled-input',
    )
  })
  it('does NOT flag a disabled input', () => {
    expect(rules("input({ value: state.at('name'), disabled: true }, [])")).not.toContain(
      'controlled-input',
    )
  })
  it('still flags when readonly is explicitly false', () => {
    expect(rules("input({ value: state.at('name'), readonly: false }, [])")).toContain(
      'controlled-input',
    )
  })
  // A reactive `checked` with no handler has the same overwrite bug as `value`.
  it('flags a checkbox with a reactive checked but no onChange/onInput', () => {
    expect(rules("input({ type: 'checkbox', checked: state.at('on') }, [])")).toContain(
      'controlled-input',
    )
  })
  it('does NOT flag reactive checked when onChange/onInput is present', () => {
    expect(
      rules("input({ checked: state.at('on'), onChange: (e) => send({ type: 'x' }) }, [])"),
    ).not.toContain('controlled-input')
    expect(
      rules("input({ checked: state.at('on'), onInput: (e) => send({ type: 'x' }) }, [])"),
    ).not.toContain('controlled-input')
  })
  it('does NOT flag reactive checked on a readonly/disabled input', () => {
    expect(rules("input({ checked: state.at('on'), readonly: true }, [])")).not.toContain(
      'controlled-input',
    )
    expect(rules("input({ checked: state.at('on'), disabled: true }, [])")).not.toContain(
      'controlled-input',
    )
  })
  it('does NOT flag a static (non-reactive) checked', () => {
    expect(rules('input({ checked: true }, [])')).not.toContain('controlled-input')
  })
  it('quotes `checked` (not `value`) in the checked message', () => {
    expect(messageFor("input({ checked: state.at('on') }, [])", 'controlled-input')).toContain(
      'checked',
    )
  })
})

describe('scope-aware rooting (finding 7)', () => {
  it('does NOT flag a reducer param named `state` (plain value) in update', () => {
    const src = `const C = component({ update: (state, msg) => [msg.v ?? state, []] })`
    expect(rules(src)).not.toContain('operator-on-signal')
  })
  it('does NOT flag arithmetic on a reducer `state` param', () => {
    const src = `const C = component({ update: (state, msg) => [{ n: state.n + 1 }, []] })`
    expect(rules(src)).not.toContain('operator-on-signal')
  })
  it('does NOT flag a param that shadows the state root inside a handler', () => {
    // an arrow whose own param reuses the name `state` operates on a plain value
    const src = `const f = (state) => state.count + 1`
    expect(rules(src)).not.toContain('operator-on-signal')
  })
  it('still flags a genuine signal operator misuse in a view body', () => {
    const src = `const C = component({ view: ({ state }) => [text(state.at('n') + 1)] })`
    expect(rules(src)).toContain('operator-on-signal')
  })
})

describe('a11y', () => {
  it('flags <img> without alt', () => {
    expect(rules("img({ src: state.at('url') }, [])")).toContain('a11y')
    expect(rules("el('img', { src: '/x.png' }, [])")).toContain('a11y')
  })
  it('does NOT flag <img> with alt (including empty alt for decorative)', () => {
    expect(rules("img({ src: '/x.png', alt: 'A cat' }, [])")).not.toContain('a11y')
    expect(rules("img({ src: '/x.png', alt: '' }, [])")).not.toContain('a11y')
  })
  it('flags onClick on a non-interactive element without role + tabIndex', () => {
    expect(rules("div({ onClick: () => send({ type: 'x' }) }, [])")).toContain('a11y')
    expect(rules("div({ onClick: () => 0, role: 'button' }, [])")).toContain('a11y')
  })
  it('does NOT flag onClick on a non-interactive element WITH role + tabIndex', () => {
    expect(rules("div({ onClick: () => 0, role: 'button', tabIndex: 0 }, [])")).not.toContain(
      'a11y',
    )
  })
  it('does NOT flag onClick on a natively interactive element', () => {
    expect(rules("button({ onClick: () => send({ type: 'x' }) }, [])")).not.toContain('a11y')
    expect(rules("a({ href: '/x', onClick: () => 0 }, [])")).not.toContain('a11y')
  })
  // `summary` natively toggles its <details> and is keyboard-activatable, so an
  // onClick on it needs no author-supplied role/tabindex. `label` forwards
  // activation to its control (which carries the keyboard story).
  it('does NOT flag onClick on a natively-interactive summary/label', () => {
    expect(rules("summary({ onClick: () => send({ type: 'x' }) }, [])")).not.toContain('a11y')
    expect(rules('label({ onClick: () => 0 }, [])')).not.toContain('a11y')
  })
  it('does NOT flag onClick when role is presentation/none (no own functionality)', () => {
    expect(rules("div({ role: 'presentation', onClick: () => 0 }, [])")).not.toContain('a11y')
    expect(rules("div({ role: 'none', onClick: () => 0 }, [])")).not.toContain('a11y')
  })
  it('accepts the lowercase tabindex HTML-attribute spelling (no a11y error)', () => {
    // a11y is satisfied — keyboard-reachable at runtime. The casing is steered
    // by the separate `convention` rule, not by failing a11y here.
    expect(rules("span({ onClick: () => 0, role: 'button', tabindex: 0 }, [])")).not.toContain(
      'a11y',
    )
  })
})

describe('convention (attribute casing → HTML-native lowercase)', () => {
  it('nudges camelCase tabIndex toward HTML-native tabindex', () => {
    const src = "div({ role: 'button', tabIndex: 0, onClick: () => 0 }, [])"
    expect(rules(src)).toContain('convention')
    // message quotes the lowercase replacement so it's copy-pasteable
    expect(messageFor(src, 'convention')).toContain('tabindex')
  })
  it('does NOT flag the lowercase tabindex form', () => {
    expect(rules("div({ role: 'button', tabindex: 0, onClick: () => 0 }, [])")).not.toContain(
      'convention',
    )
  })
  it('fires even when the element has a spread', () => {
    expect(rules('div({ tabIndex: 0, ...attrs }, [])')).toContain('convention')
  })
  it('covers the broadened camelCase DOM set (readOnly, spellCheck, maxLength, colSpan, …)', () => {
    expect(messageFor('input({ readOnly: true }, [])', 'convention')).toContain('readonly')
    expect(messageFor('input({ spellCheck: false }, [])', 'convention')).toContain('spellcheck')
    expect(messageFor('input({ maxLength: 5 }, [])', 'convention')).toContain('maxlength')
    expect(messageFor('td({ colSpan: 2 }, [])', 'convention')).toContain('colspan')
    expect(messageFor("input({ inputMode: 'numeric' }, [])", 'convention')).toContain('inputmode')
  })
  it('does NOT flag the HTML-native lowercase forms', () => {
    expect(rules("div({ contenteditable: 'false' }, [])")).not.toContain('convention')
    expect(rules("input({ autocomplete: 'off', maxlength: 1 }, [])")).not.toContain('convention')
  })
  it('flags camelCase contentEditable toward lowercase', () => {
    expect(messageFor("span({ contentEditable: 'true' }, [])", 'convention')).toContain(
      'contenteditable',
    )
  })
  it('carries a rename fix on the key span', () => {
    const d = lint('div({ tabIndex: 0 }, [])').find((x) => x.rule === 'convention')!
    expect(d.fix).toBeTruthy()
    expect(d.fix!.edits).toHaveLength(1)
    // the edit replaces just the `tabIndex` key with `tabindex`
    expect(d.fix!.edits[0]!.newText).toBe('tabindex')
  })
})

describe('event-handler-casing', () => {
  it('flags a miscased known handler (silent non-binding bug)', () => {
    const src = 'div({ onclick: () => 0 }, [])'
    expect(rules(src)).toContain('event-handler-casing')
    expect(messageFor(src, 'event-handler-casing')).toContain('onClick')
  })
  it('fixes multiword handlers to their exact canonical casing', () => {
    expect(messageFor('div({ onkeydown: () => 0 }, [])', 'event-handler-casing')).toContain(
      'onKeyDown',
    )
    expect(messageFor('div({ onmouseover: () => 0 }, [])', 'event-handler-casing')).toContain(
      'onMouseOver',
    )
  })
  it('does NOT flag a correctly-cased handler', () => {
    expect(rules('div({ onClick: () => 0 }, [])')).not.toContain('event-handler-casing')
  })
  it('does NOT flag an unknown on-prefixed name (no canonical to suggest)', () => {
    expect(rules('div({ onfoobar: () => 0 }, [])')).not.toContain('event-handler-casing')
  })
})

describe('attr-name (React-isms that silently break)', () => {
  it('flags className and offers `class`', () => {
    const src = "div({ className: 'x' }, [])"
    expect(rules(src)).toContain('attr-name')
    const d = lint(src).find((x) => x.rule === 'attr-name')!
    expect(d.message).toContain('class')
    expect(d.fix!.edits[0]!.newText).toBe('class')
  })
  it('flags htmlFor and offers `for`', () => {
    expect(messageFor("label({ htmlFor: 'x' }, [])", 'attr-name')).toContain('for')
  })
  it('does NOT flag the native class / for', () => {
    expect(rules("div({ class: 'x' }, [])")).not.toContain('attr-name')
    expect(rules("label({ for: 'x' }, [])")).not.toContain('attr-name')
  })
})

describe('empty-props (a throwaway `{}` on an element helper)', () => {
  const fixed = (src: string): string => {
    const msgs = lintSignalSource(src, 't.ts').filter((m) => m.rule === 'empty-props')
    const { code, skipped } = applyLintFixes(src, msgs)
    expect(skipped).toBe(0)
    return code
  }
  // A fixed source must still PARSE — a fix that produces `div(,)` or an
  // unbalanced call would otherwise sail past a string comparison.
  const parses = (src: string): boolean => {
    const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true)
    // `parseDiagnostics` is internal-but-stable; TS exposes it on the node.
    return (sf as ts.SourceFile & { parseDiagnostics?: unknown[] }).parseDiagnostics?.length === 0
  }

  it('flags the props+children form', () => {
    expect(rules("div({}, [text('hi')])")).toContain('empty-props')
  })
  it('flags the props-only form', () => {
    expect(rules('div({})')).toContain('empty-props')
  })
  it('flags an empty literal with only whitespace/newlines inside', () => {
    expect(rules('div({\n}, [])')).toContain('empty-props')
  })
  it('flags SVG helpers identically', () => {
    expect(rules("svg({}, [path({ d: 'M0 0' })])")).toContain('empty-props')
    expect(rules('g({}, [])')).toContain('empty-props')
    expect(rules("svgText({}, ['x'])")).toContain('empty-props')
  })
  it('flags a nested occurrence inside children', () => {
    expect(
      lint("div({ class: 'a' }, [span({}, [])])").filter((d) => d.rule === 'empty-props'),
    ).toHaveLength(1)
  })

  // ---- negatives: every legitimate lookalike must stay clean ----
  it('does NOT flag non-empty props', () => {
    expect(rules("div({ class: 'x' }, [text('hi')])")).not.toContain('empty-props')
  })
  it('does NOT flag the children-only form', () => {
    expect(rules("div([text('hi')])")).not.toContain('empty-props')
    expect(rules('div([])')).not.toContain('empty-props')
  })
  it('does NOT flag a spread (the spread source may be non-empty)', () => {
    expect(rules('div({ ...parts.root }, [])')).not.toContain('empty-props')
    expect(rules('div({ ...a, ...b }, [])')).not.toContain('empty-props')
  })
  it('does NOT flag a conditional props expression', () => {
    expect(rules('div(cond ? {} : props, [])')).not.toContain('empty-props')
  })
  it('does NOT flag a variable that happens to hold {}', () => {
    expect(rules('const props = {}\ndiv(props, [])')).not.toContain('empty-props')
  })
  it('does NOT flag a call with no arguments at all', () => {
    expect(rules('div()')).not.toContain('empty-props')
  })
  it('does NOT flag a user function that merely shares an element name', () => {
    const src = ["import { div } from './my-ui'", 'div({}, [])'].join('\n')
    expect(rules(src)).not.toContain('empty-props')
    const shadowed = 'const row = (div: (p: object, c: unknown[]) => void) => div({}, [])'
    expect(rules(shadowed)).not.toContain('empty-props')
  })
  // The rewrite `tag({}, c)` → `tag(c)` re-dispatches `c` through the helper's
  // overloads, which only typechecks when `c` is provably `readonly ChildNode[]`.
  // Without a checker the sole sound proxy is an array LITERAL, so every other
  // children expression must stay untouched — the fix would otherwise be emitted
  // to (and applied by) MCP clients as an unreviewed edit.
  it('does NOT flag a non-literal children argument (the rewrite may not typecheck)', () => {
    // The motivating false positive: compiles today, but `div(children)` matches
    // NEITHER overload — the correct rewrite is `div(children ?? [])`.
    const optional = [
      "import { div, type Renderable } from '@llui/dom'",
      'export function card(children?: Renderable) {',
      '  return div({}, children)',
      '}',
    ].join('\n')
    expect(rules(optional)).not.toContain('empty-props')
    // Same blind spot, other shapes: a call, a spread-built array, a conditional,
    // and a bare Mountable in the children slot (already a type error, but the
    // fix would silently "correct" it into a different one).
    expect(rules('div({}, makeChildren())')).not.toContain('empty-props')
    expect(rules('div({}, rows)')).not.toContain('empty-props')
    expect(rules('div({}, cond ? a : b)')).not.toContain('empty-props')
    expect(rules("div({}, text('hi'))")).not.toContain('empty-props')
    expect(rules('div({}, [...rows])')).toContain('empty-props') // an array literal IS provable
  })
  it('does NOT flag a non-element helper called with an empty object', () => {
    // `{}` is meaningful (or unavoidable) elsewhere: options bags, initial state,
    // an `el()` whose props argument is positional and defaults to `{}` anyway.
    expect(rules('each(items, {})')).not.toContain('empty-props')
    expect(rules('mountApp(root, App, {}) ')).not.toContain('empty-props')
    expect(rules("el('div', {}, [])")).not.toContain('empty-props')
  })
  it('does NOT flag an empty object literal in the CHILDREN position', () => {
    // `[{}]` is a child expression, not props — the rule must key off arg 0 only.
    expect(rules('div(props, [{}])')).not.toContain('empty-props')
    expect(rules("div({ class: 'x' }, [{}])")).not.toContain('empty-props')
  })

  // ---- message + autofix ----
  it('names the helper and the fix in the message', () => {
    const msg = messageFor("div({}, [text('hi')])", 'empty-props')
    expect(msg).toContain('div({}, …)')
    expect(msg).toContain('div(…)')
    expect(msg).toContain('children-only')
  })
  it('carries a fix that rewrites `div({}, [children])` to `div([children])`', () => {
    const out = fixed("div({}, [text('hi')])")
    expect(out).toBe("div([text('hi')])")
    expect(parses(out)).toBe(true)
    expect(rules(out)).not.toContain('empty-props')
  })
  it('carries a fix that rewrites `div({})` to `div()`', () => {
    const out = fixed('div({})')
    expect(out).toBe('div()')
    expect(parses(out)).toBe(true)
  })
  it('fixes a trailing-comma call without producing `div(,)`', () => {
    const out = fixed('div({},)')
    expect(parses(out)).toBe(true)
    expect(out).toBe('div()')
  })
  it('fixes every occurrence in one pass, and the result still compiles', () => {
    const src = [
      "import { component, div, span, text } from '@llui/dom'",
      'export const C = component({',
      "  name: 'C',",
      '  init: () => [{ n: 0 }, []],',
      '  update: (s) => [s, []],',
      '  view: ({ state }) => [',
      '    div({}, [',
      "      span({}, [text(state.at('n'))]),",
      '    ]),',
      '  ],',
      '})',
    ].join('\n')
    const out = fixed(src)
    expect(out).toContain('div([')
    expect(out).toContain('span([')
    expect(out).not.toContain('({}')
    expect(parses(out)).toBe(true)
    expect(lintSignalSource(out, 't.ts').map((m) => m.rule)).not.toContain('empty-props')
  })
  it('preserves a leading comment before the props argument', () => {
    expect(fixed('div(/* attrs */ {}, [])')).toBe('div(/* attrs */ [])')
  })
})

describe('exhaustive-update', () => {
  const comp = (msgType: string, updateBody: string) => `
    type Msg = ${msgType}
    component<{ n: number }, Msg, never>({
      init: () => ({ n: 0 }),
      update: (s, msg) => { ${updateBody} },
      view: ({ state }) => [],
    })`

  it('flags a switch that misses a Msg variant', () => {
    const src = comp(
      `{ type: 'a' } | { type: 'b' } | { type: 'c' }`,
      `switch (msg.type) { case 'a': return s; case 'b': return s }`,
    )
    expect(rules(src)).toContain('exhaustive-update')
    expect(messageFor(src, 'exhaustive-update')).toContain("'c'")
  })

  it('does NOT flag a switch that handles every variant', () => {
    const src = comp(
      `{ type: 'a' } | { type: 'b' }`,
      `switch (msg.type) { case 'a': return s; case 'b': return s }`,
    )
    expect(rules(src)).not.toContain('exhaustive-update')
  })

  it('does NOT flag when a default branch exists', () => {
    const src = comp(
      `{ type: 'a' } | { type: 'b' }`,
      `switch (msg.type) { case 'a': return s; default: return s }`,
    )
    expect(rules(src)).not.toContain('exhaustive-update')
  })

  it('handles an inline Msg union type argument', () => {
    const src = `component<{ n: number }, { type: 'a' } | { type: 'b' }, never>({
      init: () => ({ n: 0 }),
      update: (s, msg) => { switch (msg.type) { case 'a': return s } },
      view: ({ state }) => [],
    })`
    expect(rules(src)).toContain('exhaustive-update')
  })

  it('does NOT flag when the Msg type is not resolvable in this file (imported)', () => {
    const src = `component<{ n: number }, ExternalMsg, never>({
      init: () => ({ n: 0 }),
      update: (s, msg) => { switch (msg.type) { case 'a': return s } },
      view: ({ state }) => [],
    })`
    expect(rules(src)).not.toContain('exhaustive-update')
  })

  it('does NOT flag when update dispatches without a switch (cannot analyze)', () => {
    const src = comp(`{ type: 'a' } | { type: 'b' }`, `if (msg.type === 'a') return s; return s`)
    expect(rules(src)).not.toContain('exhaustive-update')
  })
})

describe('import-binding recognition (framework calls gated by @llui/dom imports)', () => {
  it('does NOT flag a user function named `text` as node construction', () => {
    const src = [
      'function text(x: string) { return x }', // user's OWN text, not the dom helper
      "const c = state.at('n').map((v) => text(String(v)))",
    ].join('\n')
    expect(rules(src)).not.toContain('no-node-construction-in-body')
  })

  it('still flags the real @llui/dom `text` helper in a derive body', () => {
    const src = [
      "import { text } from '@llui/dom'",
      "const c = state.at('n').map((v) => text(String(v)))",
    ].join('\n')
    expect(rules(src)).toContain('no-node-construction-in-body')
  })

  it('recognizes an ALIASED element import for element-level lint (controlled-input)', () => {
    const src = [
      "import { input as field } from '@llui/dom'",
      "const v = field({ value: state.at('name') })",
    ].join('\n')
    expect(rules(src)).toContain('controlled-input')
  })

  it('does NOT run element lint on a user function shadowing an element-helper name', () => {
    const src = [
      'function input(props: unknown) { return props }', // user's OWN input
      "const v = input({ value: state.at('name') })",
    ].join('\n')
    expect(rules(src)).not.toContain('controlled-input')
  })

  it('does NOT treat a user function named `each` as a structural primitive', () => {
    // Under the real structural `each`, `item.at('x') ? a : b` in the row body
    // would be flagged operator-on-signal. A user `each` introduces no row root,
    // so `item` is a plain value and nothing fires.
    const src = [
      'function each(xs: number[], opts: unknown) { return xs.length }',
      "const c = each(state.at('rows').peek(), { render: (item) => [item.at('x') ? 1 : 2] })",
    ].join('\n')
    expect(rules(src)).not.toContain('operator-on-signal')
  })
})

describe('module-scope `state` is a plain value, not a signal root', () => {
  it('does NOT flag operator-on-signal when `state` is a local const', () => {
    // A module-scope `const state = [...]` shadows the conventional signal root;
    // `state.at(0) + 1` is plain array/value code, not a signal operation.
    const src = 'const state = [1, 2, 3]\nconst x = state.at(0) + 1'
    expect(rules(src)).not.toContain('operator-on-signal')
  })

  it('still flags a free/ambient `state` (the component signal)', () => {
    // No local declaration: `state` is the component signal, so the operator fires.
    expect(rules("const x = state.at('n') + 1")).toContain('operator-on-signal')
  })

  it('does NOT flag a method/accessor param named `state`', () => {
    const src = [
      'const api = {',
      '  read(state: number[]) { return state.at(0) + 1 },',
      '  get first() { return 0 },',
      '}',
    ].join('\n')
    expect(rules(src)).not.toContain('operator-on-signal')
  })
})

describe('lintSignalSource — ScriptKind follows the filename extension', () => {
  const genericArrowComponent = [
    "import { component, div, text, button } from '@llui/dom'",
    'const clone = <T>(x: T): T => x',
    'export const Counter = component({',
    "  name: 'Counter',",
    '  init: () => [{ n: 0 }, []],',
    '  update: (s) => [s, []],',
    '  view: ({ state, send }) => [',
    '    div({}, [',
    "      text(state.at('n').map((n) => clone(String(n)))),",
    "      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),",
    '    ]),',
    '  ],',
    '})',
  ].join('\n')

  it('does NOT emit a bogus operator-on-signal for a generic-arrow `.ts` component', () => {
    const diags = lintSignalSource(genericArrowComponent, 'widget.ts')
    expect(diags.map((d) => d.rule)).not.toContain('operator-on-signal')
  })

  it('reproduces the bug: the SAME source misparsed as `.tsx` fires the false error', () => {
    // Guards against a regression that silently drops the extension-based ScriptKind.
    const diags = lintSignalSource(genericArrowComponent, 'widget.tsx')
    expect(diags.map((d) => d.rule)).toContain('operator-on-signal')
  })
})

describe('agent-annotation-syntax (issue #89 — the audit’s `agent-validates-syntax`)', () => {
  // The annotation grammar is a real quoted-string tokenizer now; anything it
  // cannot read UNAMBIGUOUSLY is a build error rather than a silently
  // truncated predicate (a truncated `@routeGated` is an always-open gate, a
  // truncated `@validates` accepts everything).
  const doc = (body: string): string =>
    `/**\n * ${body}\n */\ntype Msg = { type: 'x'; f: string }\n`

  it('flags an UNESCAPED inner quote in every annotation tag', () => {
    expect(rules(doc('@routeGated("state.mode === "admin"")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("v === "a"")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@should("say "hi"")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@intent("say "hi"")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@example("send("x")")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@warning("drops the "cloud" copy")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@emits("http:"GET"")'))).toContain('agent-annotation-syntax')
  })

  it('flags an unterminated string, a missing `)`, and an unquoted argument', () => {
    expect(rules(doc('@intent("never closed'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("v > 0"'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates(v > 0)'))).toContain('agent-annotation-syntax')
  })

  it('flags wrong arity (too few / too many arguments)', () => {
    expect(rules(doc('@routeGated()'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@routeGated("a", "b", "c")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("a", "b")'))).toContain('agent-annotation-syntax')
  })

  it('flags a mismatched curly/straight quote pair', () => {
    expect(rules(doc('@intent(“say hi")'))).toContain('agent-annotation-syntax')
  })

  it('does NOT flag well-formed tags, including escaped and curly quotes', () => {
    expect(rules(doc('@routeGated("state.mode === \\"admin\\"", "admins only")'))).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules(doc('@routeGated("state.step === \'review\'")'))).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules(doc('@validates("/^\\d{5}$/.test(v)")'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@intent(“fancy quotes”)'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@emits("http", "log")'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@should("Cite the source.") @validates("v.length > 0")'))).not.toContain(
      'agent-annotation-syntax',
    )
  })

  it('does NOT flag standard block-form JSDoc `@example` (no call parens)', () => {
    // The universal JSDoc spelling — `@example` followed by a code block, not
    // by `("…")`. The extractor ignores it; so must the rule.
    const src = [
      '/**',
      ' * @example',
      " * send({ type: 'inc' })",
      ' */',
      "type Msg = { type: 'inc' }",
    ].join('\n')
    expect(rules(src)).not.toContain('agent-annotation-syntax')
    const inline = [
      '/**',
      " * @example send({ type: 'inc' })",
      ' */',
      "type Msg = { type: 'inc' }",
    ].join('\n')
    expect(rules(inline)).not.toContain('agent-annotation-syntax')
  })

  it('does NOT flag a lookalike outside a JSDoc block (string literal, line comment)', () => {
    expect(rules('const s = \'@validates("v === "a"")\'')).not.toContain('agent-annotation-syntax')
    expect(rules('// @validates("v === "a"")\nconst n = 1')).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules('/* @validates("v === "a"") */\nconst n = 1')).not.toContain(
      'agent-annotation-syntax',
    )
  })

  it('does NOT flag PROSE in a JSDoc the extractors never read', () => {
    // Real false positives found by running the rule over this repo: the
    // compiler's and agent's own sources DOCUMENT the grammar with
    // placeholders. An annotation on a function/const is inert anyway, so
    // flagging it would fail valid builds for no safety gain.
    const fnDoc = [
      '/**',
      ' * Match `@emits("k1", "k2", ...)` — comma-separated effect kinds.',
      ' * Malformed `@intent (no quoted string)` is treated as "no intent".',
      ' * Compiles a `@validates(...)` predicate.',
      ' */',
      'function readEmits(comment: string): string[] { return [] }',
    ].join('\n')
    expect(rules(fnDoc)).not.toContain('agent-annotation-syntax')
    const constDoc = ['/**', ' * @validates("v === "a"")', ' */', 'const x = 1'].join('\n')
    expect(rules(constDoc)).not.toContain('agent-annotation-syntax')
  })

  it('DOES flag the same malformation on a property signature and a union member', () => {
    const field = [
      "type Msg = { type: 'x'",
      '  /** @validates("v === "a"") */',
      '  role: string',
      '}',
    ].join('\n')
    expect(rules(field)).toContain('agent-annotation-syntax')
    const secondMember = [
      'type Msg =',
      "  | { type: 'a' }",
      '  /** @routeGated("state.m === "b"") */',
      "  | { type: 'b' }",
    ].join('\n')
    expect(rules(secondMember)).toContain('agent-annotation-syntax')
    const iface = [
      'interface State {',
      '  /** @should("say "hi"") */',
      '  note?: string',
      '}',
    ].join('\n')
    expect(rules(iface)).toContain('agent-annotation-syntax')
  })

  it('does NOT flag an unrelated tag whose name merely starts the same', () => {
    expect(rules(doc('@intentional("v === "a"")'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@examples("a" "b")'))).not.toContain('agent-annotation-syntax')
  })

  // ── the predicate itself must be JavaScript, not just well-quoted ──────
  // A well-formed annotation carrying an uncompilable predicate sails through
  // the grammar and then fails the boundary's `new Function`, which degrades
  // to gate-open / accept-all. An unbalanced paren is an ordinary typo.
  it('flags a predicate that is not a valid JS expression', () => {
    expect(rules(doc('@routeGated("")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@routeGated("f(a)) === 1")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("v.slice(0)) === \'a\'")'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@routeGated("state.mode ===")'))).toContain('agent-annotation-syntax')
    // …and the gate's optional 2nd argument is PROSE, never compiled.
    expect(rules(doc('@routeGated("state.ok", "not while (unbalanced")'))).not.toContain(
      'agent-annotation-syntax',
    )
  })

  it('does NOT flag a valid predicate, however exotic', () => {
    expect(rules(doc('@validates("/^\\d{5}$/.test(v)")'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@validates("v.length > 0 && !v.startsWith(\'_\')")'))).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules(doc('@routeGated("state.a?.b ?? false")'))).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules(doc('@routeGated("state.mode === \\"admin\\"")'))).not.toContain(
      'agent-annotation-syntax',
    )
    // Only the two PREDICATE tags are compiled — prose tags are free text.
    expect(rules(doc('@intent("Delete (permanently")'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@should("use ) sparingly")'))).not.toContain('agent-annotation-syntax')
  })

  it('the predicate message names the degradation and the bound name', () => {
    const gate = messageFor(doc('@routeGated("f(a)) === 1")'), 'agent-annotation-syntax')
    expect(gate).toContain('f(a)) === 1')
    expect(gate).toContain('ALWAYS-OPEN')
    expect(gate).toContain("'state'")
    const val = messageFor(doc('@validates("")'), 'agent-annotation-syntax')
    expect(val).toContain('ACCEPT-EVERYTHING')
    expect(val).toContain("'v'")
  })

  it('quotes the offending tag and names the fix', () => {
    const msg = messageFor(doc('@validates("v === "a"")'), 'agent-annotation-syntax')
    expect(msg).toContain('@validates')
    expect(msg).toContain('\\"')
  })

  it('fires through lintSignalSource on a plain `.ts` Msg module', () => {
    // Msg unions usually live in a `.ts` sibling, not the `.tsx` view file.
    const src = doc('@routeGated("state.mode === "admin"")')
    expect(lintSignalSource(src, 'msg.ts').map((d) => d.rule)).toContain('agent-annotation-syntax')
  })

  // ── the `@example({…})` JSON form (issue #98) ──────────────────────────
  // The rule is the second half of the grammar: the tokenizer DROPS what it
  // cannot read, so without a matching build error the JSON form would fail
  // the same silent way the whole form failed before #89.
  it('does NOT flag a well-formed `@example({…})`', () => {
    expect(rules(doc('@example({"type":"select","id":42})'))).not.toContain(
      'agent-annotation-syntax',
    )
    expect(rules(doc('@example({"a":"}"})'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@example({"a":{"b":[1,2]}})'))).not.toContain('agent-annotation-syntax')
    expect(rules(doc('@example([{"type":"a"}])'))).not.toContain('agent-annotation-syntax')
    // …and the quoted form is untouched by any of it.
    expect(rules(doc('@example("{\\"type\\":\\"select\\"}")'))).not.toContain(
      'agent-annotation-syntax',
    )
  })

  it('flags an `@example({…})` whose literal is not valid JSON', () => {
    expect(rules(doc('@example({not json})'))).toContain('agent-annotation-syntax')
    expect(rules(doc("@example({'type':'select'})"))).toContain('agent-annotation-syntax')
    expect(rules(doc('@example({"a":1,})'))).toContain('agent-annotation-syntax')
  })

  it('flags an `@example({…})` whose braces never balance', () => {
    expect(rules(doc('@example({"a":1)'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@example({"a":{"b":1})'))).toContain('agent-annotation-syntax')
  })

  it('the JSON message names the tag and says the value must be JSON', () => {
    const msg = messageFor(doc('@example({not json})'), 'agent-annotation-syntax')
    expect(msg).toContain('@example')
    expect(msg).toContain('JSON')
  })

  // NEGATIVE: the brace form belongs to `@example` alone. A brace after any
  // other tag is a mistake — accepting it would invent a second spelling of a
  // concept (a predicate, prose) that has exactly one.
  it('flags a brace argument on every tag OTHER than `@example`', () => {
    expect(rules(doc('@intent({"a":1})'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@warning({"a":1})'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@should({"a":1})'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@validates({"a":1})'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@routeGated({"a":1})'))).toContain('agent-annotation-syntax')
    expect(rules(doc('@emits({"a":1})'))).toContain('agent-annotation-syntax')
  })

  // NEGATIVE: standard block-form `@example` with a brace on the NEXT line is
  // ordinary JSDoc, not a call — the `(` rule is what separates them, and the
  // JSON form must not widen it.
  it('does NOT flag block-form `@example` followed by an object literal', () => {
    const src = [
      '/**',
      ' * @example',
      ' * { "type": "inc" }',
      ' */',
      "type Msg = { type: 'inc' }",
    ].join('\n')
    expect(rules(src)).not.toContain('agent-annotation-syntax')
  })
})

// Issue #118 — `tagSend(send, ['touch'], () => send({ type: 'touch' }))`.
//
// The tag list and the `type` the callback actually dispatches are two
// INDEPENDENT facts, and nothing checked that they agree. `__lluiVariants` is
// read by `signals/element.ts` and feeds the agent/devtools surface: it is how
// an agent learns which Msg variants a control can emit, so a drifted tag is a
// string that LIES to a model — the same silent class as #89's truncated
// predicate and #92's wrong dependency answers. The compiler-emitted tags are
// derived from the `send` call itself and cannot drift; only hand-written ones
// can, which is exactly what this rule reads.
describe('tag-send-drift (issue #118)', () => {
  const IMPORT = "import { tagSend } from '@llui/dom'\n"
  const src = (body: string): string => IMPORT + body

  // ── positive: a dispatched type missing from the list ────────────────────
  // This direction is SOUND unconditionally: a literal `send({type:'x'})` in
  // the handler is a dispatch that provably happens, so a list without `'x'`
  // understates the handler no matter what else the body does.
  it('flags a dispatched `type` that the tag list omits', () => {
    expect(
      rules(src("const p = tagSend(send, ['touch'], () => send({ type: 'touched', f: 1 }))")),
    ).toContain('tag-send-drift')
  })

  it('flags a second dispatched `type` in a multi-branch handler', () => {
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['increment'], (e) => {",
            "  if (e.key === 'ArrowUp') send({ type: 'increment' })",
            "  else send({ type: 'decrement' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).toContain('tag-send-drift')
  })

  it('flags a dispatch from a nested callback inside the handler', () => {
    expect(
      rules(
        src(
          "const p = tagSend(send, ['start'], () => { setTimeout(() => send({ type: 'tick' }), 1) })",
        ),
      ),
    ).toContain('tag-send-drift')
  })

  // ── positive: a declared tag the handler never dispatches ────────────────
  // Only checked when the handler's dispatch set is provably COMPLETE — see
  // the negative cases below for what forfeits that.
  it('flags a declared variant the handler never dispatches', () => {
    expect(
      rules(src("const p = tagSend(send, ['touch', 'blur'], () => send({ type: 'touch' }))")),
    ).toContain('tag-send-drift')
  })

  // ── the message must be patchable on the first retry ─────────────────────
  it('quotes the offending variant and names the fix', () => {
    // A one-character typo trips BOTH directions — the dispatched variant is
    // undeclared AND the declared one is never dispatched — which together
    // describe the mistake exactly.
    const msgs = lint(src("const p = tagSend(send, ['touch'], () => send({ type: 'touched' }))"))
      .filter((d) => d.rule === 'tag-send-drift')
      .map((d) => d.message)
    expect(msgs).toHaveLength(2)
    expect(msgs.some((m) => m.includes("dispatches `{ type: 'touched' }`"))).toBe(true)
    expect(msgs.some((m) => m.includes("declares variant 'touch'"))).toBe(true)
    for (const m of msgs) expect(m).toContain('__lluiVariants')
    const over = messageFor(
      src("const p = tagSend(send, ['touch', 'blur'], () => send({ type: 'touch' }))"),
      'tag-send-drift',
    )
    expect(over).toContain("'blur'")
  })

  // ── negative: the shapes that must stay clean ────────────────────────────
  // A false positive here blocks a valid library build, so these matter more
  // than the positives. Every one is a real shape from `@llui/components`,
  // `@llui/agent` or `@llui/markdown-editor`.
  it('does NOT flag a matching tag list', () => {
    expect(
      rules(src("const p = tagSend(send, ['touch'], () => send({ type: 'touch', field: 'a' }))")),
    ).not.toContain('tag-send-drift')
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['increment', 'decrement'], (e) => {",
            "  if (e.key === 'ArrowUp') send({ type: 'increment' })",
            "  else send({ type: 'decrement' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a spread or computed tag list — the list is not readable', () => {
    expect(
      rules(src("const p = tagSend(send, [...names], () => send({ type: 'x' }))")),
    ).not.toContain('tag-send-drift')
    expect(rules(src("const p = tagSend(send, [KEY], () => send({ type: 'x' }))"))).not.toContain(
      'tag-send-drift',
    )
    expect(rules(src("const p = tagSend(send, names, () => send({ type: 'x' }))"))).not.toContain(
      'tag-send-drift',
    )
  })

  // ── the list read through an `as const` / `satisfies` assertion ──────────
  // The NARROWED signature (`readonly M['type'][]`) actively nudges authors
  // toward `as const` — it is the documented fix for a list that widened to
  // `string[]` — so the two guards were pushing in opposite directions: the
  // spelling the type asks for made the rule bail and silently switch itself
  // off for that call site. An assertion is erased at runtime, so the array
  // literal underneath is exactly what becomes `__lluiVariants`; unwrapping it
  // is runtime-faithful, and the elements are still validated as string
  // literals, so it widens coverage without widening what counts as readable.
  it('reads the variant list through an `as const` assertion', () => {
    expect(
      rules(src("const p = tagSend(send, ['touch'] as const, () => send({ type: 'touched' }))")),
    ).toContain('tag-send-drift')
    expect(
      rules(src("const p = tagSend(send, ['touch'] as const, () => send({ type: 'touch' }))")),
    ).not.toContain('tag-send-drift')
    // …and through the sibling erasures the repo's one unwrap helper covers.
    expect(
      rules(
        src(
          "const p = tagSend(send, (['touch'] satisfies readonly string[]), () => send({ type: 'touched' }))",
        ),
      ),
    ).toContain('tag-send-drift')
  })

  it('still bails on a HOISTED variant list, assertion or not', () => {
    // Unwrapping an assertion must not be mistaken for resolving an
    // identifier: `VARIANTS` is a binding this analysis does not follow, and
    // `as const` on it changes nothing.
    expect(
      rules(src("const p = tagSend(send, VARIANTS, () => send({ type: 'touched' }))")),
    ).not.toContain('tag-send-drift')
    expect(
      rules(src("const p = tagSend(send, VARIANTS as const, () => send({ type: 'touched' }))")),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a non-literal handler — its dispatches are not visible', () => {
    // `tagSend(send, ['hide'], dismissOnEscape)` is real (`@llui/components`).
    expect(rules(src("const p = tagSend(send, ['hide'], dismissOnEscape))"))).not.toContain(
      'tag-send-drift',
    )
  })

  it('does NOT flag a handler that delegates to a helper', () => {
    // `tagSend(send, ['commit'], (e) => commitFromEvent(e.target))` — the
    // dispatch happens one call away and is invisible here. Reporting
    // "declares 'commit', dispatches nothing" would be a false positive.
    expect(
      rules(src("const p = tagSend(send, ['commit'], (e) => commitFromEvent(e.target)))")),
    ).not.toContain('tag-send-drift')
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['setValue', 'commit'], (e) => {",
            '  helper(e)',
            "  send({ type: 'setValue' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a dispatch whose payload is not a readable literal', () => {
    expect(
      rules(src("const p = tagSend(send, ['setValue'], () => send({ type: msgType }))")),
    ).not.toContain('tag-send-drift')
    expect(rules(src("const p = tagSend(send, ['fwd'], (m) => send(m))"))).not.toContain(
      'tag-send-drift',
    )
    expect(
      rules(src("const p = tagSend(send, ['a', 'b'], () => send({ ...base, type: 'a' }))")),
    ).not.toContain('tag-send-drift')
  })

  // ── the two knobs that decide false positives, pinned in BOTH directions ──
  // Each of these dies if its knob is mutated away; the pair is what makes the
  // completeness predicate testable at all. The earlier version of this test
  // declared only the variant it dispatched, so direction 2 had nothing to
  // report and it passed whatever the predicate returned.
  it('keeps completeness across an inert event-method call on its own parameter', () => {
    // `e.preventDefault()` must NOT count as an unreadable dispatch — it is the
    // single most common statement in these handlers, and treating it as opaque
    // would switch the over-declaration check off everywhere. Declaring 'b' and
    // dispatching only 'a' is what proves completeness actually survived: if the
    // predicate stops forgiving `preventDefault`, 'b' goes unreported.
    const msgs = lint(
      src(
        [
          "const p = tagSend(send, ['a', 'b'], (e) => {",
          '  e.preventDefault()',
          "  send({ type: 'a' })",
          '})',
        ].join('\n'),
      ),
    ).filter((d) => d.rule === 'tag-send-drift')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.message).toContain("declares variant 'b'")
  })

  it('forfeits completeness when the dispatcher ESCAPES as a value', () => {
    // `node.onclick = send` hands the dispatcher to something that can call it
    // out of sight, so "I saw no dispatch of 'a'" stops being evidence. No call
    // in this body forfeits completeness on its own, so the escape guard is the
    // only thing keeping this clean — kill it and two diagnostics appear.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a'], (e) => {",
            '  e.preventDefault()',
            '  node.onclick = send',
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
    // The reviewer's shape: the dispatcher passed to a collaborator.
    expect(rules(src("const p = tagSend(send, ['a'], (bus) => { bus.on(send) })"))).not.toContain(
      'tag-send-drift',
    )
  })

  // ── negative: calls the completeness predicate must NOT forgive ───────────
  // Every one of these is valid code that an earlier predicate rejected: it
  // forgave ANY call rooted at a handler parameter — a bare call, an
  // element-access call, a call to a caller-supplied callback — all of which
  // can reach the dispatcher. Completeness is only ever an excuse to report
  // direction 2, so when in doubt it must be forfeited: an unreported drift is
  // a missed lint, a false positive is a broken build.
  it('does NOT flag a bare call on one of its own parameters', () => {
    expect(rules(src("const p = tagSend(send, ['done'], (cb) => cb())"))).not.toContain(
      'tag-send-drift',
    )
    expect(
      rules(src("const p = tagSend(send, ['pick'], (emit) => emit({ type: 'pick' }))")),
    ).not.toContain('tag-send-drift')
    expect(
      rules(src("const p = tagSend(send, ['x'], ({ send: s }) => s({ type: 'x' }))")),
    ).not.toContain('tag-send-drift')
    expect(rules(src("const p = tagSend(send, ['a'], (...args) => args[0]())"))).not.toContain(
      'tag-send-drift',
    )
  })

  it('does NOT flag a non-inert method call on one of its own parameters', () => {
    expect(rules(src("const p = tagSend(send, ['commit'], (ctx) => ctx.commit())"))).not.toContain(
      'tag-send-drift',
    )
    expect(
      rules(src("const p = tagSend(send, ['select'], (opt) => opt.onSelect?.())")),
    ).not.toContain('tag-send-drift')
    expect(rules(src("const p = tagSend(send, ['go'], (e) => e['go']())"))).not.toContain(
      'tag-send-drift',
    )
    expect(
      rules(
        src(
          "const p = tagSend(send, ['a', 'b'], async (api) => { await api.save(); send({ type: 'a' }) })",
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a handler whose body tags a template or constructs', () => {
    // A TaggedTemplateExpression is not a CallExpression, so the walk used to
    // step straight past it while keeping completeness. So did `new Foo()`.
    expect(rules(src("const p = tagSend(send, ['a'], () => { html`x` })"))).not.toContain(
      'tag-send-drift',
    )
    expect(
      rules(src("const p = tagSend(send, ['a'], () => { new Reporter(send) })")),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a handler that RETURNS a handler', () => {
    // The inner function does not run when this handler runs, so neither its
    // dispatches nor its silence describe this tag.
    expect(
      rules(src("const p = tagSend(send, ['open'], () => () => send({ type: 'close' }))")),
    ).not.toContain('tag-send-drift')
    expect(
      rules(
        src("const p = tagSend(send, ['open'], () => { return () => send({ type: 'close' }) })"),
      ),
    ).not.toContain('tag-send-drift')
  })

  // ── negative: the dispatcher name REBOUND in an inner scope ──────────────
  // Direction 1 attributes a `send({type:'x'})` to THIS tag only if that `send`
  // is the dispatcher that was tagged. An inner binding of the same name is a
  // DIFFERENT function, so carrying the name into its scope reports a dispatch
  // that this control cannot make. Shadowing is decided by `scopeIntroduces`
  // (the repo's one shadowing predicate) — never re-derived here.
  it('does NOT flag a dispatch through a destructured parameter of the same name', () => {
    expect(
      rules(
        src(
          "const p = tagSend(send, ['open'], () => { items.forEach(({ send }) => send({ type: 'inner' })) })",
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a dispatch through an inner `const` of the same name', () => {
    expect(
      rules(
        src(
          "const p = tagSend(send, ['open'], () => { const send = other; send({ type: 'inner' }) })",
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT attribute a NESTED `tagSend` handler to the outer call', () => {
    // The inner call is checked on its own — its handler's dispatches are the
    // inner tag's business. Attributing them outward made the outer (correct)
    // call report a variant it never emits.
    expect(
      rules(
        src(
          "const p = tagSend(send, ['open'], () => { const q = tagSend(send, ['close'], () => send({ type: 'close' })); use(q) })",
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('still flags real drift in the same file as a shadowing handler', () => {
    // The prune must not switch the rule off wholesale.
    expect(
      rules(
        src(
          [
            "const a = tagSend(send, ['open'], () => { items.forEach(({ send }) => send({ type: 'inner' })) })",
            "const b = tagSend(send, ['touch'], () => send({ type: 'touched' }))",
          ].join('\n'),
        ),
      ),
    ).toContain('tag-send-drift')
  })

  // ── negative: the HANDLER'S OWN parameter list is a scope too ────────────
  // The shadowing prune above starts INSIDE the handler, so it caught every
  // rebinding except the nearest one: the handler's own parameters. That is the
  // same class as `items.forEach(({ send }) => …)` exactly one scope up — the
  // dispatcher name resolves to the parameter, which is a different function,
  // and attributing its dispatches to this tag reports a variant the control
  // cannot emit (plus an over-declaration for the one it really does emit).
  it('does NOT flag a dispatch through a DESTRUCTURED parameter of the handler itself', () => {
    // E2 — `Ctx` carries its own `send`; the handler destructures it.
    const e2 = [
      'type Ctx = { send: (m: Msg) => void }',
      "const p = tagSend(send, ['open'], ({ send }: Ctx) => send({ type: 'inner' }))",
    ].join('\n')
    expect(rules(src(e2))).not.toContain('tag-send-drift')
  })

  it('does NOT flag a dispatch through a handler parameter NAMED like the dispatcher', () => {
    // E1 — the same rebinding, spelled as a plain parameter.
    const e1 = [
      'type Ctx = { send: (m: Msg) => void }',
      "const p = tagSend(send, ['open'], (send: Ctx['send']) => send({ type: 'inner' }))",
    ].join('\n')
    expect(rules(src(e1))).not.toContain('tag-send-drift')
  })

  it('does NOT flag a handler-parameter shadow in a .tsx module', () => {
    // The ScriptKind must not change the answer — a TSX parse of the same shape
    // reaches the same walk, and `.tsx` is where consumer view code lives.
    const tsx = [
      IMPORT,
      'type Ctx = { send: (m: Msg) => void }',
      'const icon = <span>x</span>',
      "export const p = tagSend(send, ['open'], ({ send }: Ctx) => send({ type: 'inner' }))",
    ].join('\n')
    expect(lintTagSendSource(tsx, 'm.tsx')).toEqual([])
  })

  // ── negative: a PARAMETER DEFAULT is code, and it runs ───────────────────
  // Defaults are evaluated on every call, so a call or a dispatcher mention
  // sitting in one is exactly as consequential as the same text in the body —
  // but the walk started at `handler.body` and never visited the parameter
  // list at all, so both the completeness cost and the escape guard were
  // silently skipped there.
  it('forfeits completeness for a call in a PARAMETER DEFAULT', () => {
    // F1 — `compute()` is an unreadable call that may dispatch, so "I never saw
    // 'b'" stops being evidence and direction 2 must not run.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], (e: Ev = compute()) => {",
            '  e.preventDefault()',
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('forfeits completeness when the dispatcher ESCAPES in a PARAMETER DEFAULT', () => {
    // F2 — the escape guard's own hole, relocated into parameter position:
    // `register(send)` hands the dispatcher away, so it can be called out of
    // sight and the absent `'b'` proves nothing.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], (_h: Ev = register(send)) => {",
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('still flags a dispatch made from a PARAMETER DEFAULT', () => {
    // The parameter list is WALKED, not merely skipped: a readable dispatch
    // there is attributed like any other. Asserted on the direction-1 message
    // rather than on the rule name, because the unwalked version also reported
    // something here — the over-declaration of 'a' — and would pass a
    // rule-name-only check while seeing nothing at all.
    const msgs = lint(src("const p = tagSend(send, ['a'], (_x = send({ type: 'boot' })) => {})"))
      .filter((d) => d.rule === 'tag-send-drift')
      .map((d) => d.message)
    expect(msgs.some((m) => m.includes("dispatches `{ type: 'boot' }`"))).toBe(true)
  })

  // ── negative: a default INSIDE a binding pattern is still a default ──────
  // `p.initializer` is only the default of a whole parameter (`(e = compute())`).
  // A default written inside the parameter's binding PATTERN
  // (`({ x = compute() })`, `([x = compute()])`) hangs off a `BindingElement`
  // under `p.name`, so walking initializers alone reached none of them — the
  // same defect as the unwalked parameter list, one position further in, with
  // the same two costs: a call there is unreadable code that runs on every call
  // (completeness), and a dispatcher mention there escapes or dispatches.
  // Walking `p.name` also makes the parameter list treat a binding pattern
  // exactly as the body walk already treats `const { … } = x`.
  it('forfeits completeness for a call in an OBJECT-PATTERN default', () => {
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], ({ x = compute() }) => {",
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('forfeits completeness when the dispatcher ESCAPES in an OBJECT-PATTERN default', () => {
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], ({ x = register(send) }) => {",
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a correct list whose only dispatch is in an OBJECT-PATTERN default', () => {
    // The dispatch of `'inner'` is real and the list names it. Unwalked, the
    // scan saw an empty body, called it complete, and reported the declared
    // variant as never dispatched — a false positive on a list that is right.
    expect(
      rules(src("const p = tagSend(send, ['inner'], ({ x = send({ type: 'inner' }) }) => {})")),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a correct list whose only dispatch is in an ARRAY-PATTERN default', () => {
    expect(
      rules(src("const p = tagSend(send, ['inner'], ([x = send({ type: 'inner' })]) => {})")),
    ).not.toContain('tag-send-drift')
  })

  it('forfeits completeness for a call in a NESTED binding-pattern default', () => {
    // The walk has to recurse: the default sits two patterns deep.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], ({ o: { x = compute() } }) => {",
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('forfeits completeness for a pattern default on a FUNCTION-EXPRESSION handler', () => {
    // Both handler shapes reach the same scan; neither may keep a completeness
    // it has not earned.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['a', 'b'], function ({ x = compute() }) {",
            "  send({ type: 'a' })",
            '})',
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag the realistic event-destructuring default', () => {
    // The shape a consumer actually writes: destructure the event and default
    // one field. `compute()` may dispatch, so the absent `'close'` proves
    // nothing.
    expect(
      rules(
        src(
          [
            "const p = tagSend(send, ['open', 'close'], ({ currentTarget = compute() }) =>",
            "  send({ type: 'open' }))",
          ].join('\n'),
        ),
      ),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a binding-pattern default in a .tsx module', () => {
    // Same ScriptKind guard as the handler-parameter shadow above: `.tsx` is
    // where consumer view code lives, and a TSX parse must reach the same walk.
    const tsx = [
      IMPORT,
      'const icon = <span>x</span>',
      "export const p = tagSend(send, ['a', 'b'], ({ x = compute() }) => { send({ type: 'a' }) })",
      "export const q = tagSend(send, ['inner'], ({ x = send({ type: 'inner' }) }) => {})",
    ].join('\n')
    expect(lintTagSendSource(tsx, 'm.tsx')).toEqual([])
  })

  it('still flags real drift dispatched from a binding-pattern default', () => {
    // Walking the pattern is not a blanket amnesty: a readable dispatch there
    // is attributed like any other, so an undeclared one is still reported.
    const msgs = lint(
      src("const p = tagSend(send, ['a'], ({ x = send({ type: 'boot' }) }) => {})"),
    ).filter((d) => d.rule === 'tag-send-drift')
    expect(msgs.some((m) => m.message.includes("dispatches `{ type: 'boot' }`"))).toBe(true)
  })

  it('does NOT flag when the dispatcher is not the identifier being called', () => {
    // Only calls to the tagged dispatcher count. `send` here is a different
    // binding from the `dispatch` that was tagged, so nothing is correlated.
    expect(
      rules(src("const p = tagSend(dispatch, ['x'], () => send({ type: 'y' })))")),
    ).not.toContain('tag-send-drift')
  })

  it('does NOT flag a user function that merely shares the name `tagSend`', () => {
    const own = [
      'function tagSend(a, b, c) { return c }',
      "const p = tagSend(send, ['touch'], () => send({ type: 'touched' }))",
    ].join('\n')
    expect(rules(own)).not.toContain('tag-send-drift')
  })

  it('does not crash on a `tagSend` call of another arity', () => {
    expect(() => rules(src("const p = tagSend('rm', () => send({ type: 'rm' }))"))).not.toThrow()
    expect(rules(src("const p = tagSend('rm', () => send({ type: 'rm' }))"))).not.toContain(
      'tag-send-drift',
    )
  })

  // The canonical `tagSend` call site is a library `connect()` module with NO
  // `component(` call in it, which `lintSignalSource` never reaches — so the
  // rule must also run on the non-component path the adapter uses.
  it('fires through the non-component entry point', () => {
    const drift = src("export const p = tagSend(send, ['touch'], () => send({ type: 'touched' }))")
    expect(lintTagSendSource(drift, 'connect.ts').map((d) => d.rule)).toContain('tag-send-drift')
    const clean = src("export const p = tagSend(send, ['touch'], () => send({ type: 'touch' }))")
    expect(lintTagSendSource(clean, 'connect.ts')).toEqual([])
    // …and a module that never mentions the helper is skipped before parsing.
    expect(lintTagSendSource('export const n = 1', 'plain.ts')).toEqual([])
  })
})
