// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { component, div, mountApp } from '@llui/dom'
import type { LluiDebugAPI } from '@llui/dom'
import { enableDevTools } from '@llui/dom/devtools'
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

// ── Test component ──────────────────────────────────────────────

type AState = { data: string | null }
type AMsg = { type: 'fetch' } | { type: 'loaded'; data: string }
type AEffect = { type: 'http'; url: string; onSuccess: (data: unknown) => AMsg }

const App = component<AState, AMsg, AEffect>({
  name: 'App',
  init: () => [{ data: null }, []],
  update: (state, msg) => {
    if (msg.type === 'fetch') {
      const effect: AEffect = {
        type: 'http',
        url: '/api/data',
        onSuccess: (data) => ({ type: 'loaded', data: String(data) }),
      }
      return [state, [effect]]
    }
    if (msg.type === 'loaded') {
      return [{ data: msg.data }, []]
    }
    return [state, []]
  },
  view: ({ text: textFn }) => [div({ id: 'app' }, [textFn((s: AState) => s.data ?? 'none')])],
})

// ── Tests ───────────────────────────────────────────────────────

describe('llui_mock_effect jsdom e2e', () => {
  it('intercepts http effect and delivers mocked response to state', async () => {
    enableDevTools()

    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, App)

    const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
    expect(api).toBeDefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    // Register a one-shot mock for any http effect
    const mockResult = (await server.handleToolCall('llui_mock_effect', {
      match: { type: 'http' },
      response: 'mocked-payload',
    })) as { mockId: string }
    expect(mockResult.mockId).toBeTruthy()

    // Send the fetch message — update() returns an http effect, which the
    // mock intercepts synchronously. The mocked response is delivered via
    // onSuccess as a microtask.
    await server.handleToolCall('llui_send_message', { msg: { type: 'fetch' } })

    // Wait for the microtask that delivers the mocked response
    await Promise.resolve()

    // The loaded message was sent; flush to apply it
    api.flush()

    const state = (await server.handleToolCall('llui_get_state', {})) as { data: string | null }
    expect(state.data).toBe('mocked-payload')
  })
})
