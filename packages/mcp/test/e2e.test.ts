// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountSignalComponent } from '@llui/dom/signals'
import type { LluiDebugAPI } from '@llui/dom/signals'
import { LluiMcpServer } from '../src/index'

/**
 * End-to-end test of the MCP debug chain against the SIGNAL runtime:
 *   MCP server  →  connectDirect  →  __lluiDebug (installSignalDebug)  →  real component
 *
 * The signal runtime registers its debug API on `globalThis.__lluiDebug` via
 * `installSignalDebug` (dev builds). We drive it in-process through
 * `connectDirect` — the WebSocket browser relay (`startRelay`) is a
 * legacy-runtime transport and is not part of the signal surface. The core
 * state/history/snapshot/list tools all work against the signal API.
 */

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__lluiDebug
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__lluiComponents
  document.body.innerHTML = ''
})

// ── Test component (signal runtime) ─────────────────────────────

interface CounterState {
  count: number
  label: string
}

type CounterMsg =
  | { type: 'increment' }
  | { type: 'decrement' }
  | { type: 'setLabel'; label: string }

function mountCounter(): LluiDebugAPI {
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountSignalComponent<CounterState, CounterMsg>(container, {
    name: 'Counter',
    init: () => ({ count: 0, label: 'tap me' }),
    update: (state, msg) => {
      switch (msg.type) {
        case 'increment':
          return { ...state, count: state.count + 1 }
        case 'decrement':
          return { ...state, count: state.count - 1 }
        case 'setLabel':
          return { ...state, label: msg.label }
      }
    },
    view: () => [],
  })
  return (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
}

// ── E2E ────────────────────────────────────────────────────────

describe('MCP e2e — signal debug API → real component', () => {
  it('forwards llui_get_state to the real component', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_get_state', {})
    expect(result).toEqual({ count: 0, label: 'tap me' })
  })

  it('llui_send_message updates real component state and returns the new state', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    const result = (await server.handleToolCall('llui_send_message', {
      msg: { type: 'increment' },
    })) as { sent: boolean; state: CounterState }

    expect(result.sent).toBe(true)
    expect(result.state.count).toBe(3)
  })

  it('llui_validate_message passes through when no __msgSchema is injected', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    // This hand-built def has no compiler-injected __msgSchema, so validation
    // is a pass-through and the (incomplete) message is still sent.
    const result = (await server.handleToolCall('llui_send_message', {
      msg: { type: 'setLabel' },
    })) as { sent: boolean; errors?: unknown[] }

    expect(result.sent).toBe(true)
  })

  it('llui_snapshot_state + llui_restore_state round-trip works', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    const snap = await server.handleToolCall('llui_snapshot_state', {})
    expect(snap).toEqual({ count: 2, label: 'tap me' })

    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    const before = await server.handleToolCall('llui_get_state', {})
    expect(before).toEqual({ count: 4, label: 'tap me' })

    const restored = (await server.handleToolCall('llui_restore_state', { snapshot: snap })) as {
      restored: boolean
      state: CounterState
    }
    expect(restored.restored).toBe(true)
    expect(restored.state).toEqual({ count: 2, label: 'tap me' })
  })

  it('llui_list_components shows the mounted component', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_list_components', {})) as {
      components: string[]
      active: string | null
    }
    expect(result.components).toContain('Counter')
    expect(result.active).toBe('Counter')
  })

  it('llui_get_message_history returns the recorded messages', async () => {
    const api = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    await server.handleToolCall('llui_send_message', { msg: { type: 'increment' } })
    await server.handleToolCall('llui_send_message', { msg: { type: 'setLabel', label: 'hi' } })

    const history = (await server.handleToolCall('llui_get_message_history', {})) as Array<{
      msg: { type: string }
      stateAfter: CounterState
    }>
    expect(history.length).toBeGreaterThanOrEqual(2)
    const types = history.map((h) => h.msg.type)
    expect(types).toContain('increment')
    expect(types).toContain('setLabel')
  })
})
