// Agent-protocol rules — batch 1: string-effect-callback,
// agent-missing-intent, agent-warning-on-confirm,
// agent-example-on-payload, agent-exclusive-annotations,
// agent-optional-field-undocumented. Each checks JSDoc-tag patterns
// on Msg union variants.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('string-effect-callback', () => {
  it('errors on `onSuccess: "msgType"`', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (e) => fetchHttp({ url: '/x', onSuccess: 'gotIt' }),
          view: () => [],
        })
      `,
      'llui/string-effect-callback',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain("onSuccess: 'gotIt'")
  })

  it('does NOT error on typed message constructor', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          onEffect: (e) => fetchHttp({
            url: '/x',
            onSuccess: (data) => ({ type: 'gotIt', payload: data }),
          }),
          view: () => [],
        })
      `,
      'llui/string-effect-callback',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-missing-intent', () => {
  it('errors on a Msg variant with no @intent', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          | { type: 'add', text: string }
          | { type: 'remove', id: number }
      `,
      'llui/agent-missing-intent',
    )
    expect(diags).toHaveLength(2)
    expect(diags[0]!.message).toContain('"add"')
  })

  it('does NOT error when @intent is present', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") */
          | { type: 'add', text: string }
          /** @intent("Remove a todo") */
          | { type: 'remove', id: number }
      `,
      'llui/agent-missing-intent',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on @humanOnly variants', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add") */
          | { type: 'add', text: string }
          /** @humanOnly */
          | { type: 'internalReset' }
      `,
      'llui/agent-missing-intent',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-warning-on-confirm', () => {
  it('errors when @requiresConfirm has no @warning', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Delete account") @requiresConfirm */
          | { type: 'deleteAccount' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-warning-on-confirm',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error when @warning is present', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Delete account") @requiresConfirm @warning("Permanent and irreversible.") */
          | { type: 'deleteAccount' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-warning-on-confirm',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-example-on-payload', () => {
  it('errors on payload-bearing variant with @intent but no @example', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") */
          | { type: 'add', text: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-example-on-payload',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on nullary variants', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Reset") */
          | { type: 'reset' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-example-on-payload',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error when @example is present', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") @example("Add 'buy milk'") */
          | { type: 'add', text: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-example-on-payload',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-exclusive-annotations', () => {
  it('errors on @humanOnly + @agentOnly conflict', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @humanOnly @agentOnly */
          | { type: 'x' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-exclusive-annotations',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('opposite dispatch audiences')
  })

  it('errors on @humanOnly + @requiresConfirm redundancy', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @humanOnly @requiresConfirm */
          | { type: 'x' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-exclusive-annotations',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('redundant')
  })

  it('does NOT error on @humanOnly alone', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @humanOnly */
          | { type: 'x' }
          /** @intent("noop") */
          | { type: 'noop' }
      `,
      'llui/agent-exclusive-annotations',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-optional-field-undocumented', () => {
  it('errors on optional field with no JSDoc', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") */
          | { type: 'add', text: string, source?: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-optional-field-undocumented',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('"source"')
  })

  it('does NOT error when JSDoc is present', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") */
          | { type: 'add',
              text: string,
              /** @should("the source URL") */
              source?: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-optional-field-undocumented',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on @humanOnly variants', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @humanOnly */
          | { type: 'internal', secret?: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-optional-field-undocumented',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on required fields', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        type Msg =
          /** @intent("Add a todo") */
          | { type: 'add', text: string }
          /** @intent("Reset") */
          | { type: 'reset' }
      `,
      'llui/agent-optional-field-undocumented',
    )
    expect(diags).toHaveLength(0)
  })
})
