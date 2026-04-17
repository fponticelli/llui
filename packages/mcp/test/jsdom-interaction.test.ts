// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { component, div, button, mountApp } from '@llui/dom'
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

type CState = { n: number }
type CMsg = { type: 'inc' }

const Counter = component<CState, CMsg, never>({
  name: 'Counter',
  init: () => [{ n: 0 }, []],
  update: (state, _msg) => [{ n: state.n + 1 }, []],
  view: ({ send }) => [div({}, [button({ id: 'b', onClick: () => send({ type: 'inc' }) }, [])])],
})

// ── Tests ───────────────────────────────────────────────────────

describe('llui_dispatch_event jsdom e2e', () => {
  it('dispatches a click, records message history index, and returns resulting state', async () => {
    enableDevTools()

    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, Counter)

    const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
    expect(api).toBeDefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_dispatch_event', {
      selector: '#b',
      type: 'click',
    })) as {
      dispatched: boolean
      messagesProducedIndices: number[]
      resultingState: { n: number } | null
    }

    expect(result.dispatched).toBe(true)
    expect(result.messagesProducedIndices).toHaveLength(1)
    expect(result.resultingState).not.toBeNull()
    expect(result.resultingState!.n).toBe(1)
  })
})
