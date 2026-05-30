// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountSignalComponent, el } from '@llui/dom'
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

// ── Test component (signal runtime) ─────────────────────────────

type CState = { n: number }
type CMsg = { type: 'inc' }

function mountCounter(): { api: LluiDebugAPI; button: HTMLButtonElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountSignalComponent<CState, CMsg>(container, {
    name: 'Counter',
    init: () => ({ n: 0 }),
    update: (s) => ({ n: s.n + 1 }),
    view: ({ send }) => [
      el('div', {}, [el('button', { id: 'b', onClick: () => send({ type: 'inc' }) }, [])]),
    ],
  })
  const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
  const button = container.querySelector('#b') as HTMLButtonElement
  return { api, button }
}

// ── Tests ───────────────────────────────────────────────────────

describe('signal component — DOM interaction drives the update loop', () => {
  it('a real DOM click runs update() and the relay sees the new state', async () => {
    const { api, button } = mountCounter()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    button.click()

    const state = (await server.handleToolCall('llui_get_state', {})) as { n: number }
    expect(state.n).toBe(1)
  })
})

describe('llui_dispatch_event degrades gracefully for signal components', () => {
  it('dispatchDomEvent is unavailable on the signal runtime', async () => {
    const { api } = mountCounter()
    expect(api.dispatchDomEvent).toBeUndefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    await expect(
      server.handleToolCall('llui_dispatch_event', { selector: '#b', type: 'click' }),
    ).rejects.toThrow(/unknown method: dispatchDomEvent/)
  })
})
