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

// ── Test component (signal runtime) ─────────────────────────────
//
// Mounted via the signal runtime, which registers a SIGNAL debug API
// (installSignalDebug) onto globalThis.__lluiDebug. That API implements
// the core state/history/schema surface but NOT the legacy binding-
// introspection / DOM-inspection methods (inspectElement, getRenderedHtml).
// MCP tools backed by those methods must therefore degrade gracefully —
// the relay reports "unknown method".

type CState = { count: number }
type CMsg = { type: 'inc' }

function mountCounter(): LluiDebugAPI {
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountSignalComponent<CState, CMsg>(container, {
    name: 'Counter',
    init: () => ({ count: 0 }),
    update: (s) => ({ count: s.count + 1 }),
    view: () => [
      el('div', { id: 'c' }, [signalText((s) => String((s as CState).count), ['count'])]),
    ],
  })
  return (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
}

// ── Tests ───────────────────────────────────────────────────────

describe('signal component — core debug surface', () => {
  it('exposes live state through the relay', async () => {
    const api = mountCounter()
    expect(api).toBeDefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    const state = await server.handleToolCall('llui_get_state', {})
    expect(state).toEqual({ count: 0 })
  })
})

describe('binding/DOM introspection degrades gracefully for signal components', () => {
  it('llui_inspect_element is unavailable on the signal runtime', async () => {
    const api = mountCounter()
    // The signal debug API does not implement inspectElement.
    expect(api.inspectElement).toBeUndefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    await expect(server.handleToolCall('llui_inspect_element', { selector: '#c' })).rejects.toThrow(
      /unknown method: inspectElement/,
    )
  })

  it('llui_get_rendered_html is unavailable on the signal runtime', async () => {
    const api = mountCounter()
    expect(api.getRenderedHtml).toBeUndefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    await expect(
      server.handleToolCall('llui_get_rendered_html', { selector: '#c' }),
    ).rejects.toThrow(/unknown method: getRenderedHtml/)
  })
})
