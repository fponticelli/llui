// Agent-protocol rules — batch 2: agent-tagsend-translator-missing,
// agent-nonextractable-handler, subapp-requires-reason.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('agent-tagsend-translator-missing', () => {
  it('errors when `*.connect(get, send, …)` passes raw send', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ sort: {} }, []],
          update: (s) => [s, []],
          view: ({ send }) => {
            sortable.connect((s) => s.sort, send)
            return [div([])]
          },
        })
      `,
      'llui/agent-tagsend-translator-missing',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('sortable.connect')
  })

  it('does NOT error when a translator wraps send', () => {
    const diags = diagnosticsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ sort: {} }, []],
          update: (s) => [s, []],
          view: ({ send }) => {
            sortable.connect((s) => s.sort, (libMsg) => send({ type: 'Sort/Update', msg: libMsg }))
            return [div([])]
          },
        })
      `,
      'llui/agent-tagsend-translator-missing',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('agent-nonextractable-handler', () => {
  it('errors on send(makeMsg()) in view', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            button({ onClick: () => send(makeMsg()) })
          ],
        })
      `,
      'llui/agent-nonextractable-handler',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on send({ type: variant }) — computed type', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            button({ onClick: () => send({ type: variant }) })
          ],
        })
      `,
      'llui/agent-nonextractable-handler',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on send({ type: "literal" })', () => {
    const diags = diagnosticsFor(
      `
        import { component, button } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            button({ onClick: () => send({ type: 'click' }) })
          ],
        })
      `,
      'llui/agent-nonextractable-handler',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('subapp-requires-reason', () => {
  it('errors on subApp({...}) missing reason', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const widget = subApp({ component: someComp })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('requires a')
  })

  it('errors on empty reason', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const widget = subApp({ component: someComp, reason: '' })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('non-empty')
  })

  it('errors on organization-only excuse', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const widget = subApp({ component: someComp, reason: 'code organization' })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('organization')
  })

  it('errors on non-literal reason (interpolated template)', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const widget = subApp({ component: someComp, reason: \`computed \${x}\` })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('grep')
  })

  it('does NOT error on a real literal reason', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const widget = subApp({ component: someComp, reason: 'Monaco editor owns its own DOM + selection lifecycle' })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error when reason is a local const string', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const REASON = '60fps drag layer — host reducer too slow for this'
        const widget = subApp({ component: someComp, reason: REASON })
      `,
      'llui/subapp-requires-reason',
    )
    expect(diags).toHaveLength(0)
  })
})
