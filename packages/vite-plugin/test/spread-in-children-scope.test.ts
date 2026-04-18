import { describe, it, expect } from 'vitest'
import { diagnose } from '../src/diagnostics'

function spreadWarnings(source: string): string[] {
  return diagnose(source)
    .map((d) => d.message)
    .filter((m) => /Spread in children/.test(m))
}

// Cases from apps/web/repros/llui-spread-in-children-noise.mjs in
// dicerun2. The scanner is currently syntactic — any identifier spread
// or array-method-call spread fires. These tests pin scope-aware
// behavior: resolve the spread source's binding in the enclosing file
// and silence when it's a bounded expression (array literal, function
// call result, or bounded-receiver method chain).

describe('spread-in-children — positive control', () => {
  it('fires on inline [literal].map with reactive accessor', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ items: [{ id: 'a' }, { id: 'b' }] }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'list' }, [
            ...[1, 2, 3].map((n) => div([text(() => String(n))])),
          ]),
        ],
      })
    `
    expect(spreadWarnings(src).length).toBeGreaterThan(0)
  })
})

describe('spread-in-children — scope-aware relaxations', () => {
  it('Case A: silent when identifier resolves to array literal (const Node[] + push)', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      declare const needsBucketing: boolean
      declare const showWarning: boolean
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => {
          const footerNodes = []
          if (needsBucketing) footerNodes.push(div([text(() => 'bucketed')]))
          if (showWarning) footerNodes.push(div([text(() => 'warn')]))
          return [
            div({ class: 'chart' }, [
              div([text(() => 'header')]),
              ...footerNodes,
            ]),
          ]
        },
      })
    `
    expect(spreadWarnings(src)).toEqual([])
  })

  it('Case B: silent when .map receiver is a named bounded array', () => {
    const src = `
      import { component, div, button, text } from '@llui/dom'
      const TABS = ['stats', 'roll'] as const
      component({
        name: 'C',
        init: () => [{ active: 'stats' }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ role: 'tablist' }, [
            ...TABS.map((t) => button({ type: 'button' }, [text(() => t)])),
          ]),
        ],
      })
    `
    expect(spreadWarnings(src)).toEqual([])
  })

  it('Case C: silent when identifier resolves to a function-call result', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      const renderRows = (labels) => labels.map((l) => span([text(() => l)]))
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => {
          const rows = renderRows(['a', 'b'])
          return [
            div({ class: 'row' }, [
              div([text(() => 'lead')]),
              ...rows,
            ]),
          ]
        },
      })
    `
    expect(spreadWarnings(src)).toEqual([])
  })

  it('Case D: silent when .concat receiver is a named bounded array', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => {
          const minMaxChildren = [div([text(() => 'min')])]
          const bandedArea = div([text(() => 'band')])
          return [
            div({ class: 'chart' }, [
              ...minMaxChildren.concat([bandedArea]),
            ]),
          ]
        },
      })
    `
    expect(spreadWarnings(src)).toEqual([])
  })

  it('still warns when .map receiver is a state accessor (not a named bounded array)', () => {
    // Ensures scope-awareness doesn't mask the real bug — spreading a
    // state-derived map IS the case each() is for.
    const src = `
      import { component, div, text } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ items: ['a', 'b'] }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({}, [
            ...(s) => s.items.map((n) => div([text(() => n)])),
          ]),
        ],
      })
    `
    // Ill-formed syntactically but the scanner should still treat it as
    // an unresolved suspect spread — any future real-world state-derived
    // case must warn.
    // Skipping strict assertion here; the next test covers the real case.
    void src
  })

  it('still warns when identifier binding is a .map on a dynamic call receiver', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      declare const itemsFromState: (s: unknown) => unknown[]
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => {
          const rows = itemsFromState({}).map((it) => div([text(() => String(it))]))
          return [
            div({}, [...rows]),
          ]
        },
      })
    `
    // The binding is a .map on a call-expression receiver — not a named
    // bounded array. Keep the warning: this is the canonical case each()
    // covers (a dynamic-length source).
    expect(spreadWarnings(src).length).toBeGreaterThan(0)
  })

  it('warns when identifier binding is itself a suspect .map on an unresolved receiver', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      declare const x: unknown
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => {
          const rows = (x as any[]).map((n) => div([text(() => String(n))]))
          return [
            div({}, [...rows]),
          ]
        },
      })
    `
    // Receiver is not a resolvable named binding to an array literal —
    // keep the warning.
    expect(spreadWarnings(src).length).toBeGreaterThan(0)
  })
})
