// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountSignalComponent, el, signalText } from '@llui/dom'
import type { LluiDebugAPI } from '@llui/dom'
import { LluiMcpServer } from '../src/index'

afterEach(() => {
  // Clean up devtools globals between tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__lluiDebug
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__lluiComponents
  // Remove any elements added to the document body
  document.body.innerHTML = ''
})

// ── Test component (signal runtime, with an effect) ─────────────

type AState = { data: string | null }
type AMsg = { type: 'fetch' } | { type: 'loaded'; data: string }
type AEffect = { type: 'http'; url: string }

function mountApp(): LluiDebugAPI {
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountSignalComponent<AState, AMsg, AEffect>(container, {
    name: 'App',
    init: () => [{ data: null }, []],
    update: (state, msg) => {
      if (msg.type === 'fetch') return [state, [{ type: 'http', url: '/api/data' }]]
      if (msg.type === 'loaded') return [{ data: msg.data }, []]
      return [state, []]
    },
    onEffect: (effect, { send }) => {
      if (effect.type === 'http') send({ type: 'loaded', data: 'real-payload' })
    },
    view: () => [
      el('div', { id: 'app' }, [signalText((s) => (s as AState).data ?? 'none', ['data'])]),
    ],
  })
  return (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
}

// ── Tests ───────────────────────────────────────────────────────

describe('signal component — effects flow through onEffect', () => {
  it('dispatching fetch runs the http effect and delivers the loaded message', async () => {
    const api = mountApp()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    // Signal send is synchronous: the http effect's onEffect handler sends
    // `loaded` immediately, which applies before the call returns.
    await server.handleToolCall('llui_send_message', { msg: { type: 'fetch' } })

    const state = (await server.handleToolCall('llui_get_state', {})) as { data: string | null }
    expect(state.data).toBe('real-payload')
  })
})

describe('effect mocking degrades gracefully for signal components', () => {
  it('llui_mock_effect is unavailable on the signal runtime', async () => {
    const api = mountApp()
    // The signal runtime does not record/mocking effects — no effect timeline.
    expect(api.mockEffect).toBeUndefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    await expect(
      server.handleToolCall('llui_mock_effect', { match: { type: 'http' }, response: 'x' }),
    ).rejects.toThrow(/unknown method: mockEffect/)
  })
})
