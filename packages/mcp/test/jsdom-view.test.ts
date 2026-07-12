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

describe('binding/DOM introspection tools are not advertised', () => {
  // The signal runtime does not implement the legacy binding/DOM-introspection
  // methods, so the tools backed by them are no longer registered (rather than
  // advertised and failing with "unknown method" at call time).
  it('does not register unservable DOM-introspection tools', () => {
    const names = new LluiMcpServer().getTools().map((t) => t.name)
    for (const dead of [
      'llui_inspect_element',
      'llui_get_rendered_html',
      'llui_dispatch_event',
      'llui_dom_diff',
      'llui_get_focus',
      'llui_scope_tree',
      'llui_get_bindings',
      'llui_mock_effect',
      'llui_step_back',
    ]) {
      expect(names).not.toContain(dead)
    }
  })

  it('signal debug API omits the legacy introspection methods', () => {
    const api = mountCounter()
    expect(api.inspectElement).toBeUndefined()
    expect(api.getRenderedHtml).toBeUndefined()
  })
})
