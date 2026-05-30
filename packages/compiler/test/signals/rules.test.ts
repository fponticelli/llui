import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { lintSignals, type SignalDiagnostic } from '../../src/signals/rules.js'

function lint(src: string): SignalDiagnostic[] {
  const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true)
  return lintSignals(sf)
}
const rules = (src: string): string[] => [...new Set(lint(src).map((d) => d.rule))].sort()

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
    expect(rules("state.at('items').map((a) => a.length)")).not.toContain(
      'no-node-construction-in-body',
    )
  })
})

describe('whole-state-to-call', () => {
  it('flags whole state in a reactive VALUE slot (text arg, reactive prop)', () => {
    expect(rules('text(formError(state))')).toContain('whole-state-to-call')
    expect(rules('text(state)')).toContain('whole-state-to-call')
    expect(rules('div({ class: badgeClass(state) }, [])')).toContain('whole-state-to-call')
  })
  it('does NOT flag passing a slice', () => {
    expect(rules("text(formError(state.at('form')))")).not.toContain('whole-state-to-call')
  })
  // A view-helper call narrows internally (its own bindings carry their own mask),
  // so passing whole state DOWN to it is composition, not a coarse dependency. The
  // canonical top-level `view: ({ state }) => [shell(state)]` must not be flagged.
  it('does NOT flag whole state passed to a composition (node-producing) call', () => {
    expect(rules('shell(state)')).not.toContain('whole-state-to-call')
    expect(rules('div({}, [shell(state)])')).not.toContain('whole-state-to-call')
    expect(
      rules('each(state.at("rows"), { key: (r) => r.id, render: (item) => [rowView(state)] })'),
    ).not.toContain('whole-state-to-call')
  })
  // Non-view code (a reducer/helper) where `state` is a plain param is not a
  // reactive slot at all — must not be flagged (was a shadow false-positive).
  it('does NOT flag whole state passed to a plain call outside any reactive slot', () => {
    expect(rules('const [next, fx] = update(state, msg)')).not.toContain('whole-state-to-call')
    expect(rules('const changed = cloudLinkChanged(state, next)')).not.toContain(
      'whole-state-to-call',
    )
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
