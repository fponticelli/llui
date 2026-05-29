import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { analyzeSignalExpr, signalPathOf, STATE_ROOTS } from '../../src/signals/extract-deps.js'

// Parse a single expression from source.
function parseExpr(src: string): ts.Expression {
  const sf = ts.createSourceFile('t.ts', `const __e = (${src})`, ts.ScriptTarget.Latest, true)
  let found: ts.Expression | undefined
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isVariableDeclaration(n) && n.initializer) {
      found = ts.isParenthesizedExpression(n.initializer) ? n.initializer.expression : n.initializer
      return
    }
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  if (!found) throw new Error('no expr in: ' + src)
  return found
}

const deps = (src: string): string[] => [...analyzeSignalExpr(parseExpr(src))].sort()
const ROOTS = STATE_ROOTS

describe('signalPathOf', () => {
  it('resolves at-chains rooted at state', () => {
    expect(signalPathOf(parseExpr('state'), ROOTS)).toBe('')
    expect(signalPathOf(parseExpr("state.at('count')"), ROOTS)).toBe('count')
    expect(signalPathOf(parseExpr("state.at('user.profile.name')"), ROOTS)).toBe(
      'user.profile.name',
    )
    expect(signalPathOf(parseExpr("state.at('user').at('name')"), ROOTS)).toBe('user.name')
  })
  it('returns null for non-simple / non-root', () => {
    expect(signalPathOf(parseExpr("state.at('user').map((u) => u.name)"), ROOTS)).toBeNull()
    expect(signalPathOf(parseExpr("other.at('x')"), ROOTS)).toBeNull()
  })
})

describe('analyzeSignalExpr', () => {
  const cases: [string, string[]][] = [
    // direct signals
    ['state', ['']],
    ["state.at('count')", ['count']],
    ["state.at('user.profile.name')", ['user.profile.name']],
    ["state.at('user').at('name')", ['user.name']],
    // .map rebases the callback's relative deps onto the receiver path
    ["state.at('user').map((u) => u.name)", ['user.name']],
    ["state.at('user').map((u) => `${u.first} ${u.last}`)", ['user.first', 'user.last']],
    // the LLM's default coarse-source form narrows to the same as the .at form
    ['state.map((s) => s.user.name)', ['user.name']],
    // collection: filter reads the whole array
    ["state.at('items').map((a) => a.filter((e) => e.done).length)", ['items']],
    // length is tracked precisely
    ["state.at('items').map((a) => a.length)", ['items.length']],
    // escape into an opaque helper: whole source slice
    ["state.at('user').map((u) => fmt(u))", ['user']],
    // peek is non-reactive
    ["state.at('count').peek()", []],
    // derived rebases each input independently
    ["derived([state.at('a'), state.at('user')], (x, y) => x + y.name)", ['a', 'user.name']],
    [
      "derived([state.at('user.first'), state.at('user.last')], (f, l) => `${f} ${l}`)",
      ['user.first', 'user.last'],
    ],
    // non-literal .map callback (imported): coarsen to the source slice
    ["state.at('user').map(fmtUser)", ['user']],
  ]
  for (const [src, expected] of cases) {
    it(src, () => expect(deps(src)).toEqual([...expected].sort()))
  }

  it('chained .map coarsens to the receiver deps (sound)', () => {
    // inner map derives from user.profile; outer .at on a derived signal can't
    // rebase, so it coarsens to the inner deps — covers user.profile.name.
    const d = deps("state.at('user').map((u) => u.profile).at('name')")
    expect(d).toEqual(['user.profile'])
  })

  it('supports custom signal roots (sub-view slice named state, plus extra)', () => {
    const e = parseExpr("theme.at('mode')")
    expect([
      ...analyzeSignalExpr(
        e,
        new Map([
          ['state', { value: 's', dep: '' }],
          ['theme', { value: 'theme', dep: '' }],
        ]),
      ),
    ]).toEqual(['mode'])
  })
})
