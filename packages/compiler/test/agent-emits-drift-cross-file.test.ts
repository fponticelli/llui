// Cross-file regression for `agent-emits-drift`. When `component<S,
// ImportedMsg, E>()` resolves M to another file (typeSources.msg set),
// the rule must iterate the imported Msg's variants too. Without this,
// the drift check would silently skip imported Msg unions — a real
// gap given how many examples import Msgs from co-located modules.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

const IMPORTED_MSG_SOURCE = `
type Msg =
  /** @intent("Add a todo") @emits("http") */
  | { type: 'add' }
  /** @intent("Reset") */
  | { type: 'reset' }
`

function withTypeSources(localSource: string): Diagnostic[] {
  const result = transformLlui(
    localSource,
    'fixture.ts',
    /* devMode */ false,
    /* emitAgentMetadata */ false,
    /* mcpPort */ null,
    /* verbose */ false,
    {
      msg: { source: IMPORTED_MSG_SOURCE, typeName: 'Msg' },
    },
  )
  return (result?.diagnostics ?? []).filter((d) => d.id === 'llui/agent-emits-drift')
}

describe('agent-emits-drift — cross-file', () => {
  it('catches orphaned @emits on an imported Msg variant (declared http, no literal emit)', () => {
    const diags = withTypeSources(
      `
        import { component, div } from '@llui/dom'
        import type { Msg } from './msgs'
        const App = component<{}, Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, []]
              case 'reset': return [s, []]
            }
          },
          view: () => [div([])],
        })
      `,
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags.some((d) => d.message.includes('"add"') && d.message.includes('http'))).toBe(true)
  })

  it('catches undeclared emissions in a case for an imported Msg variant', () => {
    // The 'reset' variant has no @emits; if the case emits 'log', the
    // rule must catch the drift even though Msg is in another file.
    const diags = withTypeSources(
      `
        import { component, div } from '@llui/dom'
        import type { Msg } from './msgs'
        const App = component<{}, Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, [{ kind: 'http' }]]
              case 'reset': return [s, [{ kind: 'log' }]]
            }
          },
          view: () => [div([])],
        })
      `,
    )
    expect(diags.some((d) => d.message.includes('"reset"') && d.message.includes('log'))).toBe(true)
  })

  it('is silent when imported Msg @emits matches the local cases', () => {
    const diags = withTypeSources(
      `
        import { component, div } from '@llui/dom'
        import type { Msg } from './msgs'
        const App = component<{}, Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, [{ kind: 'http' }]]
              case 'reset': return [s, []]
            }
          },
          view: () => [div([])],
        })
      `,
    )
    expect(diags).toHaveLength(0)
  })
})
