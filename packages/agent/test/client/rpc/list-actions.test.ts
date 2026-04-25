import { describe, it, expect } from 'vitest'
import { handleListActions, type ListActionsHost } from '../../../src/client/rpc/list-actions.js'
import type { MessageAnnotations } from '../../../src/protocol.js'

function makeHost(opts: {
  state?: unknown
  descriptors?: Array<{ variant: string }> | null
  annotations?: Record<string, MessageAnnotations> | null
  affordances?: ((s: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}): ListActionsHost {
  return {
    getState: () => opts.state ?? {},
    getBindingDescriptors: () => opts.descriptors ?? null,
    getMsgAnnotations: () => opts.annotations ?? null,
    getAgentAffordances: () => opts.affordances ?? null,
  }
}

describe('handleListActions', () => {
  it('empty bindings and no affordances returns empty actions', () => {
    const result = handleListActions(makeHost({ descriptors: [], affordances: null }))
    expect(result).toEqual({ actions: [] })
  })

  it('human-only binding is filtered out', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Delete' }, { variant: 'Save' }],
        annotations: {
          Delete: {
            intent: 'delete item',
            dispatchMode: 'human-only',
            requiresConfirm: false,
            alwaysAffordable: false,
          },
          Save: {
            intent: 'save item',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
          },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)?.variant).toBe('Save')
  })

  it('intent fallback to variant name when annotation has null intent', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Toggle' }],
        annotations: {
          Toggle: {
            intent: null,
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
          },
        },
      }),
    )
    expect(result.actions.at(0)?.intent).toBe('Toggle')
  })

  it('affordances with payload sets payloadHint', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [{ type: 'AddItem', id: 'abc', qty: 2 }],
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)).toMatchObject({
      variant: 'AddItem',
      source: 'always-affordable',
      payloadHint: { id: 'abc', qty: 2 },
    })
  })

  it('missing annotations defaults: intent=variant, requiresConfirm=false', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Increment' }],
        annotations: null,
      }),
    )
    expect(result.actions.at(0)).toMatchObject({
      variant: 'Increment',
      intent: 'Increment',
      requiresConfirm: false,
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
    })
  })

  it('affordance with no extra keys has null payloadHint', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [{ type: 'Reset' }],
      }),
    )
    expect(result.actions.at(0)?.payloadHint).toBeNull()
  })
})
