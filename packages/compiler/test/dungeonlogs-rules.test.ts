// Regression tests for the two compile-time rules added in response
// to the dungeonlogs 2026-05-21 issue report:
//   - llui/no-sample-in-event-handler — sample() inside onClick/etc.
//   - llui/no-repeated-item-current   — repeated item.current().X in
//                                       an each.render accessor.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('llui/no-sample-in-event-handler', () => {
  it('errors when sample() appears inside onClick', () => {
    const diags = diagsFor(
      `
        import { component, button, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            button({ onClick: () => send({ type: 'pick', id: sample((s) => s.id) }) }),
          ],
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
    expect(diags[0]!.message).toMatch(/Capture the value at render time/)
  })

  it('errors on h.sample inside onInput', () => {
    const diags = diagsFor(
      `
        import { component, input } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: (h) => [
            input({ onInput: (e) => h.send({ type: 'commit', id: h.sample((s) => s.id) }) }),
          ],
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT fire for sample at render time (the correct pattern)', () => {
    const diags = diagsFor(
      `
        import { component, button, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: ({ send }) => {
            const id = sample((s) => s.id)
            return [button({ onClick: () => send({ type: 'pick', id }) })]
          },
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT fire on non-handler properties whose name happens to start with "on"', () => {
    // `oneof` is not an on-event handler — the rule must gate on the
    // /^on[A-Z]/ shape, not anything starting with "on".
    const diags = diagsFor(
      `
        import { component, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: () => [],
        })
        const cfg = { oneof: () => sample((s) => s.id) }
        void cfg
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('llui/no-repeated-item-current', () => {
  it('warns on two chained item.current() reads in one accessor', () => {
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string; meta: { label: string } }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([
                  text(() => item.current().name + ':' + item.current().meta.label),
                ]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('warning')
    expect(diags[0]!.message).toMatch(/destructure once|project to a row type/)
  })

  it('does NOT warn on a single item.current() call', () => {
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([text(() => item.current().name)]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT warn when destructured once at the top of the accessor', () => {
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string; meta: { label: string } }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([
                  text(() => {
                    const e = item.current()
                    return e.name + ':' + e.meta.label
                  }),
                ]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(0)
  })
})
