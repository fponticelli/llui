import { describe, it, expect } from 'vitest'
import { handleObserve, type ObserveHost } from '../../../src/client/rpc/observe.js'
import type { AgentContext, MessageAnnotations } from '../../../src/protocol.js'

function makeHost(overrides: Partial<ObserveHost> & { state?: unknown } = {}): ObserveHost {
  const state = overrides.state ?? { count: 0 }
  return {
    getState: overrides.getState ?? (() => state),
    getBindingDescriptors: overrides.getBindingDescriptors ?? (() => null),
    getMsgAnnotations: overrides.getMsgAnnotations ?? (() => null),
    getAgentAffordances: overrides.getAgentAffordances ?? (() => null),
    getAgentContext: overrides.getAgentContext ?? (() => null),
  }
}

describe('handleObserve', () => {
  it('returns {state, actions, context} in one call', () => {
    const state = { view: 'home', todos: [] }
    const host = makeHost({
      state,
      getBindingDescriptors: () => [{ variant: 'GoSettings' }],
      getMsgAnnotations: () =>
        ({
          GoSettings: {
            intent: 'go to settings',
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'shared',
          },
        }) as Record<string, MessageAnnotations>,
      getAgentContext: () => (s) => ({
        summary: `viewing ${(s as { view: string }).view}`,
        hints: [],
        cautions: [],
      }),
    })

    const result = handleObserve(host)

    expect(result.state).toEqual(state)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ variant: 'GoSettings', intent: 'go to settings' })
    expect(result.context).toEqual<AgentContext>({
      summary: 'viewing home',
      hints: [],
      cautions: [],
    })
  })

  it('returns context: null when the app does not define agentContext', () => {
    const host = makeHost({ state: { x: 1 }, getAgentContext: () => null })

    const result = handleObserve(host)

    expect(result.state).toEqual({ x: 1 })
    expect(result.context).toBeNull()
  })

  it('filters human-only actions out of the envelope', () => {
    const host = makeHost({
      getBindingDescriptors: () => [{ variant: 'Click' }, { variant: 'AdminOnly' }],
      getMsgAnnotations: () =>
        ({
          Click: {
            intent: 'click',
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'shared',
          },
          AdminOnly: {
            intent: 'admin',
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'human-only',
          },
        }) as Record<string, MessageAnnotations>,
    })

    const result = handleObserve(host)

    expect(result.actions.map((a) => a.variant)).toEqual(['Click'])
  })
})
