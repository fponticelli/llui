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
      "signalEach({ produce: (s) => s.todos, deps: ['todos'] }, (t) => t.id, () => [signalText((s) => s.title, ['title'])])",
    )
  })

  it('lowers show to signalShow (cond spec, content under state root)', () => {
    const out = tx("show(state.at('open'), () => [text(state.at('name'))])")
    expect(out).toBe(
      "signalShow({ produce: (s) => s.open, deps: ['open'] }, () => [signalText((s) => s.name, ['name'])])",
    )
  })

  it('lowers branch to signalBranch (disc spec, arms)', () => {
    const out = tx(
      "branch(state.at('view'), { loading: () => [text('…')], loaded: () => [text(state.at('title'))] })",
    )
    expect(out).toBe(
      "signalBranch({ produce: (s) => s.view, deps: ['view'] }, { loading: () => [staticText('…')], loaded: () => [signalText((s) => s.title, ['title'])] })",
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
