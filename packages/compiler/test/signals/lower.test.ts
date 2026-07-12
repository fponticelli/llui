import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { signalToProduce } from '../../src/signals/lower.js'

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

function lower(src: string): { produce: string; deps: string[] } {
  const { expr, sf } = parse(src)
  const r = signalToProduce(expr, sf)
  if (r.produce === null) throw new Error(`produce bailed to null for: ${src}`)
  return { produce: r.produce, deps: r.deps.sort() }
}

function lowerRaw(src: string): { produce: string | null; deps: string[] } {
  const { expr, sf } = parse(src)
  const r = signalToProduce(expr, sf)
  return { produce: r.produce, deps: r.deps.sort() }
}

function run(produce: string, state: unknown): unknown {
  return new Function('s', `return (${produce})`)(state)
}

describe('signalToProduce — produce source', () => {
  it('navigates .at chains', () => {
    expect(lower("state.at('count')").produce).toBe('s.count')
    expect(lower("state.at('user.profile.name')").produce).toBe('s.user.profile.name')
    expect(lower("state.at('list.0.p')").produce).toBe('s.list[0].p')
    expect(lower('state').produce).toBe('s')
  })
  it('applies .map to the source value', () => {
    expect(lower("state.at('user').map((u) => u.name)").produce).toBe('((u) => u.name)(s.user)')
  })
  it('applies derived to each source', () => {
    expect(lower("derived([state.at('a'), state.at('b')], (x, y) => x + y)").produce).toBe(
      '((x, y) => x + y)(s.a, s.b)',
    )
  })

  // Finding 1: non-identifier `.at()` keys must use bracket access, not `.seg`
  // (which parses as subtraction / an illegal member for `my-key`).
  it('uses bracket access for non-identifier .at keys', () => {
    expect(lower("state.at('my-key')").produce).toBe('s["my-key"]')
    expect(lower("state.at('a.my-key.b')").produce).toBe('s.a["my-key"].b')
    expect(lower("state.at('with space')").produce).toBe('s["with space"]')
    expect(lower("state.at('123abc')").produce).toBe('s["123abc"]')
  })

  it('non-identifier .at key produce actually evaluates the value', () => {
    const { produce } = lower("state.at('my-key')")
    expect(run(produce, { 'my-key': 42 })).toBe(42)
  })

  // Finding 6: casts wrapping a signal element must not leak a HANDLE into produce.
  it('unwraps as/!/satisfies casts around a signal inside derived', () => {
    expect(
      lowerRaw("derived([state.at('a'), state.at('b') as any], (x, y) => x + y)").produce,
    ).toBe('((x, y) => x + y)(s.a, s.b)')
    expect(lowerRaw("state.at('a')!").produce).toBe('s.a')
    expect(lowerRaw("(state.at('a') satisfies unknown)").produce).toBe('s.a')
  })

  it('bails to null (verbatim) on an unrecognized signal form rather than emitting a handle read', () => {
    // a bare non-root identifier is a signal-handle local — must not be emitted
    // verbatim into a produce body (it would evaluate to a Signal, not a value)
    expect(lowerRaw('someLocalHandle').produce).toBeNull()
    expect(lowerRaw("derived([state.at('a'), someHandle], (x, y) => x + y)").produce).toBeNull()
  })
})

describe('signalToProduce — executes correctly with matching deps', () => {
  const state = {
    count: 7,
    user: { name: 'ada', profile: { email: 'a@b.c' } },
    list: [{ p: 1 }, { p: 2 }],
    a: 10,
    b: 20,
  }

  const cases: [string, unknown, string[]][] = [
    ["state.at('count')", 7, ['count']],
    ["state.at('user.name')", 'ada', ['user.name']],
    ["state.at('list.0.p')", 1, ['list.0.p']],
    ["state.at('user').map((u) => u.name.toUpperCase())", 'ADA', ['user.name']],
    ["state.at('user').map((u) => `Hi ${u.name}`)", 'Hi ada', ['user.name']],
    ['state.map((s) => s.user.name)', 'ada', ['user.name']],
    ["state.at('list').map((l) => l.length)", 2, ['list.length']],
    ['derived([state.at("a"), state.at("b")], (x, y) => x + y)', 30, ['a', 'b']],
    [
      "state.at('user').map((u) => `${u.name} <${u.profile.email}>`)",
      'ada <a@b.c>',
      ['user.name', 'user.profile.email'],
    ],
  ]

  for (const [src, expected, deps] of cases) {
    it(src, () => {
      const r = lower(src)
      expect(run(r.produce, state)).toEqual(expected) // generated code RUNS and is correct
      expect(r.deps).toEqual([...deps].sort()) // deps match the analyzer
    })
  }
})

describe('signalToProduce — differential: produce ignores non-dependency changes', () => {
  // The lowered produce must be invariant to mutations of paths NOT in deps —
  // the contract that lets the runtime gate skip it. (Soundness of deps comes
  // from analyzeSignalExpr; this confirms the produce body agrees.)
  it('mutating a non-dep path does not change produce output', () => {
    const src = "state.at('user').map((u) => `${u.first} ${u.last}`)"
    const { produce, deps } = lower(src)
    expect(deps).toEqual(['user.first', 'user.last'])
    const base = { user: { first: 'A', last: 'B', middle: 'X' }, other: 1 }
    const out0 = run(produce, base)
    // change non-dep paths
    const out1 = run(produce, { ...base, other: 999, user: { ...base.user, middle: 'ZZZ' } })
    expect(out1).toBe(out0)
    // change a dep path -> output changes
    const out2 = run(produce, { ...base, user: { ...base.user, first: 'Q' } })
    expect(out2).not.toBe(out0)
  })
})
