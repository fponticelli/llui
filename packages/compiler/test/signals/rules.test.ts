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
