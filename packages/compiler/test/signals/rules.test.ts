import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { lintSignals, type SignalDiagnostic } from '../../src/signals/rules.js'

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
