// Compile-time correctness rules — batch 2: direct-state-in-view,
// imperative-dom-in-view, accessor-side-effect, state-mutation.
// Migrated from @llui/eslint-plugin; all promoted to compiler errors.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('direct-state-in-view', () => {
  it('errors on `state.X` inside an event handler', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ name: '' }, []],
          update: (s) => [s, []],
          view: () => [
            button({
              onClick: () => { send({ type: 'click', value: state.name }) },
            })
          ],
        })
      `,
      'llui/direct-state-in-view',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
  })

  it('does NOT error on accessor `text(state => state.name)`', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ name: '' }, []],
          update: (s) => [s, []],
          view: () => [text(state => state.name)],
        })
      `,
      'llui/direct-state-in-view',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('imperative-dom-in-view', () => {
  it('errors on document.getElementById directly in view body', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => {
            const el = document.getElementById('app')
            return []
          },
        })
      `,
      'llui/imperative-dom-in-view',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('getElementById')
  })

  it('does NOT error inside onMount', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [
            onMount(() => { document.getElementById('app') })
          ],
        })
      `,
      'llui/imperative-dom-in-view',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error inside an event handler', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [
            button({ onClick: () => { document.getElementById('app') } })
          ],
        })
      `,
      'llui/imperative-dom-in-view',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('accessor-side-effect', () => {
  it('errors on console.log inside a text() accessor', () => {
    const diags = diagnosticsFor(
      `
        import { component, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ name: '' }, []],
          update: (s) => [s, []],
          view: () => [
            text(s => {
              console.log(s)
              return s.name
            })
          ],
        })
      `,
      'llui/accessor-side-effect',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
  })

  it('errors on fetch() inside a class accessor', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ isActive: false }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              class: s => {
                fetch('/api')
                return s.isActive ? 'active' : ''
              }
            })
          ],
        })
      `,
      'llui/accessor-side-effect',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error inside an event handler', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [
            button({ onClick: () => { console.log('clicked') } })
          ],
        })
      `,
      'llui/accessor-side-effect',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('state-mutation', () => {
  it('errors on direct assignment `state.count = …`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ count: 0 }, []],
          update: (state) => {
            state.count = state.count + 1
            return [state, []]
          },
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('immutable')
  })

  it('errors on compound assignment `state.count += 1`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ count: 0 }, []],
          update: (state) => {
            state.count += 1
            return [state, []]
          },
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on increment `state.count++`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ count: 0 }, []],
          update: (state) => {
            state.count++
            return [state, []]
          },
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on mutating method `state.items.push(...)`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ items: [] }, []],
          update: (state, msg) => {
            state.items.push(msg.item)
            return [state, []]
          },
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('push')
  })

  it('does NOT error on immutable spread `{...state, count: state.count + 1}`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ count: 0 }, []],
          update: (state) => [{ ...state, count: state.count + 1 }, []],
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on mutating a non-state local', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ arr: [] }, []],
          update: (state) => {
            const arr = []
            arr.push(1)
            return [{ ...state, arr }, []]
          },
          view: () => [],
        })
      `,
      'llui/state-mutation',
    )
    expect(diags).toHaveLength(0)
  })
})
