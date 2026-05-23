// Compile-time correctness rules migrated from @llui/eslint-plugin.
// Each rule is a CompilerModule emitting a structured Diagnostic with
// severity 'error' — LLMs ignore warnings, so the only effective
// channel is non-bypassable compiler errors.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('async-update', () => {
  it('errors on `async` update function', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: async (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/async-update',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
    expect(diags[0]!.message).toContain('async')
  })

  it('errors on await inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            await Promise.resolve()
            return [s, []]
          },
          view: () => [div([])],
        })
      `,
      'llui/async-update',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on await inside a nested async helper declared in update', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => {
            const doAsync = async () => { await Promise.resolve() }
            return [s, []]
          },
          view: () => [div([])],
        })
      `,
      'llui/async-update',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('map-on-state-array', () => {
  it('errors on .map() on state-derived value in view', () => {
    const diags = diagnosticsFor(
      `
        import { component, div, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [s, []],
          view: () => [
            div([
              (s) => s.items.map(i => text(() => i.name))
            ])
          ],
        })
      `,
      'llui/map-on-state-array',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
  })

  it('does NOT error on .map() on a non-state local array', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => {
            const arr = [1, 2, 3]
            return arr.map(n => div([]))
          },
        })
      `,
      'llui/map-on-state-array',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on .map() inside an enclosing each.items accessor', () => {
    // Self-referential false-positive fix (dicerun2 issue #1, 0.5.4):
    // `.map()` inside `each({ items: (s) => s.foo.map(...) })` is
    // building the very array `each` consumes. The diagnostic used
    // to tell the author to use `each` — which they already were.
    const diags = diagnosticsFor(
      `
        import { component, each, text } from '@llui/dom'
        type Row = { id: string; label: string }
        const App = component({
          name: 'X',
          init: () => [{ items: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            ...each<Row>({
              items: (s: { items: Row[] }) => s.items.map((r) => ({ id: r.id, label: r.label })),
              key: (r) => r.id,
              render: ({ item }) => [text(item.label)],
            }),
          ],
        })
      `,
      'llui/map-on-state-array',
    )
    expect(diags).toHaveLength(0)
  })

  it('also suppresses inside h.each({items}) — View-bag form', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        type Row = { id: string; label: string }
        const App = component({
          name: 'X',
          init: () => [{ items: [] as Row[] }, []],
          update: (s) => [s, []],
          view: ({ each }) => [
            ...each<Row>({
              items: (s: { items: Row[] }) => s.items.map((r) => ({ id: r.id, label: r.label })),
              key: (r) => r.id,
              render: ({ item }) => [text(item.label)],
            }),
          ],
        })
      `,
      'llui/map-on-state-array',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on .map() in update (only view triggers the rule)', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (s) => [{ ...s, items: s.items.map(x => x + 1) }, []],
          view: () => [div([])],
        })
      `,
      'llui/map-on-state-array',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('nested-send-in-update', () => {
  it('errors on send() inside update', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m, { send }) => {
            send({ type: 'other' })
            return [s, []]
          },
          view: () => [div([])],
        })
      `,
      'llui/nested-send-in-update',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
  })

  it('does NOT error on send() inside a nested function declared in update', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            const doSomething = () => { send({ type: 'foo' }) }
            return [s, []]
          },
          view: () => [div([])],
        })
      `,
      'llui/nested-send-in-update',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on returning effects (the correct pattern)', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, [{ type: 'fetch' }]],
          view: () => [div([])],
        })
      `,
      'llui/nested-send-in-update',
    )
    expect(diags).toHaveLength(0)
  })
})
