// Agent-protocol rules — batch 3: agent-emits-drift, agent-msg-resolvable.
// File-local versions; cross-file resolution is out of scope here.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('agent-emits-drift', () => {
  it('errors when a case emits a kind not in @emits', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add") */
          | { type: 'add' }
          /** @intent("noop") */
          | { type: 'noop' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, [{ kind: 'http' }]]
              case 'noop': return [s, []]
            }
          },
          view: () => [div([])],
        })
      `,
      'llui/agent-emits-drift',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toContain('http')
  })

  it('errors when @emits declares a kind no case emits', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add") @emits("http") */
          | { type: 'add' }
          /** @intent("noop") */
          | { type: 'noop' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, []]
              case 'noop': return [s, []]
            }
          },
          view: () => [div([])],
        })
      `,
      'llui/agent-emits-drift',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toContain('declares @emits')
  })

  it('does NOT error when @emits matches the case emission', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add") @emits("http") */
          | { type: 'add' }
          /** @intent("noop") */
          | { type: 'noop' }
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s, m) => {
            switch (m.type) {
              case 'add': return [s, [{ kind: 'http' }]]
              case 'noop': return [s, []]
            }
          },
          view: () => [div([])],
        })
      `,
      'llui/agent-emits-drift',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-msg-resolvable', () => {
  it('errors when Msg is not declared or imported', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component<{}, MissingMsg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/agent-msg-resolvable',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('MissingMsg')
  })

  it('errors when Msg comes from a namespace import', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        import * as m from './msgs'
        const App = component<{}, m.Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/agent-msg-resolvable',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT error on locally-declared Msg', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg = { type: 'inc' }
        const App = component<{}, Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/agent-msg-resolvable',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on named-imported Msg', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        import { Msg } from './msgs'
        const App = component<{}, Msg, never>({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/agent-msg-resolvable',
    )
    expect(diags).toHaveLength(0)
  })
})
