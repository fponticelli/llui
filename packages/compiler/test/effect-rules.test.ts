// Compile-time effect-handling correctness rules migrated from
// @llui/eslint-plugin: effect-without-handler, exhaustive-effect-handling.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('effect-without-handler', () => {
  it('errors when update returns non-empty effects but no onEffect is declared', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, [{ type: 'fetch' }]],
          view: () => [],
        })
      `,
      'llui/effect-without-handler',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
  })

  it('does NOT error when an onEffect handler is present', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, [{ type: 'fetch' }]],
          onEffect: (e) => {},
          view: () => [],
        })
      `,
      'llui/effect-without-handler',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error when update returns an empty effect list', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [],
        })
      `,
      'llui/effect-without-handler',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('exhaustive-effect-handling', () => {
  it('errors on empty .else(() => {}) handler', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (effect) =>
            match(effect)
              .with({ type: 'fetch' }, () => {})
              .else(() => {}),
          view: () => [],
        })
      `,
      'llui/exhaustive-effect-handling',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('silently drops')
  })

  it('errors on empty function expression in .else(function() {})', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (effect) =>
            match(effect)
              .with({ type: 'fetch' }, () => {})
              .else(function() {}),
          view: () => [],
        })
      `,
      'llui/exhaustive-effect-handling',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error when .else handler has body', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (effect) =>
            match(effect)
              .with({ type: 'fetch' }, () => {})
              .else(() => { console.warn('unhandled') }),
          view: () => [],
        })
      `,
      'llui/exhaustive-effect-handling',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on expression body `.else(() => undefined)`', () => {
    const diags = diagnosticsFor(
      `
        import { component } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (effect) =>
            match(effect)
              .with({ type: 'fetch' }, () => {})
              .else(() => undefined),
          view: () => [],
        })
      `,
      'llui/exhaustive-effect-handling',
    )
    expect(diags).toHaveLength(0)
  })
})
