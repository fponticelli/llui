// Compile-time correctness rules — batch 3: no-eager-item-accessor,
// pure-update-function, exhaustive-update, no-let-reactive-accessor,
// each-closure-violation. Closes out the correctness rule migration
// from @llui/eslint-plugin.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('no-eager-item-accessor', () => {
  it('errors on text(item.title()) eager call', () => {
    const diags = diagnosticsFor(
      `
        import { component, each, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: () => [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [text(item.title())],
            })
          ],
        })
      `,
      'llui/no-eager-item-accessor',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
    expect(diags[0]!.message).toContain('item.title')
  })

  it('does NOT error on text(item.title) accessor', () => {
    const diags = diagnosticsFor(
      `
        import { component, each, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: () => [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [text(item.title)],
            })
          ],
        })
      `,
      'llui/no-eager-item-accessor',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('pure-update-function', () => {
  it('errors on fetch() inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            fetch('/api')
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/pure-update-function',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('fetch')
  })

  it('errors on Math.random() inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            const r = Math.random()
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/pure-update-function',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on Date.now() inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            const t = Date.now()
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/pure-update-function',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on new Date() inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            const d = new Date()
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/pure-update-function',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on a pure update', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ count: 0 }, []],
          update: (s) => [{ ...s, count: s.count + 1 }, []],
          view: () => [],
        })
      `,
      'llui/pure-update-function',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('exhaustive-update', () => {
  it('errors when update misses Msg variants and has no default', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        type Msg = { type: 'a' } | { type: 'b' } | { type: 'c' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'a': return [s, []]
            }
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/exhaustive-update',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain("'b'")
    expect(diags[0]!.message).toContain("'c'")
  })

  it('does NOT error when default clause is present', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        type Msg = { type: 'a' } | { type: 'b' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'a': return [s, []]
              default: return [s, []]
            }
          },
          view: () => [],
        })
      `,
      'llui/exhaustive-update',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error when all variants are handled', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        type Msg = { type: 'a' } | { type: 'b' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'a': return [s, []]
              case 'b': return [s, []]
            }
            return [s, []]
          },
          view: () => [],
        })
      `,
      'llui/exhaustive-update',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('no-let-reactive-accessor', () => {
  it('errors on top-level `let` accessor used in text()', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        let isGated = (s) => s.gated
        const App = component({
          name: 'X',
          init: () => [{ gated: false }, []],
          update: (s) => [s, []],
          view: () => [text(isGated)],
        })
      `,
      'llui/no-let-reactive-accessor',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
    expect(diags[0]!.message).toContain('const isGated')
  })

  it('mentions reassignment when the binding is reassigned', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        let isGated = (s) => s.gated
        isGated = (s) => !s.gated
        const App = component({
          name: 'X',
          init: () => [{ gated: false }, []],
          update: (s) => [s, []],
          view: () => [text(isGated)],
        })
      `,
      'llui/no-let-reactive-accessor',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('reassigned')
  })

  it('does NOT error on `const` accessor', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        const isGated = (s) => s.gated
        const App = component({
          name: 'X',
          init: () => [{ gated: false }, []],
          update: (s) => [s, []],
          view: () => [text(isGated)],
        })
      `,
      'llui/no-let-reactive-accessor',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on `let` with a non-callable initializer (e.g. label string)', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        let label = 'hi'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [text(() => label)],
        })
      `,
      'llui/no-let-reactive-accessor',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('each-closure-violation', () => {
  it('errors on capturing a view-scope value inside a render binding arrow', () => {
    // `outerVar` is declared inside view's body (so not module scope).
    // It's then captured inside an arrow attached to a reactive
    // property (`class:`) — that's the staleness footgun the rule
    // catches.
    const diags = diagnosticsFor(
      `
        import { component, each, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: ({ each }) => {
            const outerVar = 123
            return [
              each({
                items: (s) => s.items,
                key: (i) => i.id,
                render: ({ item }) => [
                  div({ class: () => 'item ' + outerVar }, [])
                ],
              })
            ]
          },
        })
      `,
      'llui/each-closure-violation',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags.some((d) => d.message.includes('outerVar'))).toBe(true)
  })

  it('does NOT error on a module-scope import used in render', () => {
    const diags = diagnosticsFor(
      `
        import { component, each, div } from '@llui/dom'
        const HARDCODED_CLASS = 'row'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: ({ each }) => [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [div({ class: HARDCODED_CLASS }, [])],
            })
          ],
        })
      `,
      'llui/each-closure-violation',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on event handler captures', () => {
    const diags = diagnosticsFor(
      `
        import { component, each, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: ({ each }) => {
            const outerVar = 123
            return [
              each({
                items: (s) => s.items,
                key: (i) => i.id,
                render: ({ item }) => [
                  button({ onClick: () => send({ type: 'click', value: outerVar }) })
                ],
              })
            ]
          },
        })
      `,
      'llui/each-closure-violation',
    )
    expect(diags).toHaveLength(0)
  })
})
