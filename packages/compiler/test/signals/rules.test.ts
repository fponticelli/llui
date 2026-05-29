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
  it('flags passing the whole state to a call in a reactive position', () => {
    expect(rules('text(formError(state))')).toContain('whole-state-to-call')
  })
  it('does NOT flag passing a slice', () => {
    expect(rules("text(formError(state.at('form')))")).not.toContain('whole-state-to-call')
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
