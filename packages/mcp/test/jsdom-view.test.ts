// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { component, div, mountApp } from '@llui/dom'
import type { ElementReport, LluiDebugAPI } from '@llui/dom'
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

type CState = { count: number }
type CMsg = { type: 'inc' }

const Counter = component<CState, CMsg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, _msg) => [{ count: state.count + 1 }, []],
  view: ({ text: textFn }) => [
    div({ id: 'c' }, [textFn((s: CState) => String(s.count))]),
  ],
})

// ── Tests ───────────────────────────────────────────────────────

describe('llui_inspect_element jsdom e2e', () => {
  it('returns a non-null report with correct tagName and bindings', async () => {
    // Install devtools before mounting so the hook is in place
    enableDevTools()

    // Mount into the live document so querySelector works
    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, Counter)

    // Grab the debug API populated by enableDevTools + mountApp
    const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
    expect(api).toBeDefined()

    // Wire the MCP server to the in-process API
    const server = new LluiMcpServer()
    server.connectDirect(api)

    // Call the tool
    const result = (await server.handleToolCall('llui_inspect_element', {
      selector: '#c',
    })) as ElementReport | null

    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('div')
    expect(result!.selector).toBe('#c')
    expect(result!.bindings.length).toBeGreaterThan(0)
    expect(result!.bindings[0]!.relation).toBe('text-child')
    expect(result!.attributes['id']).toBe('c')
  })

  it('returns null when no element matches the selector', async () => {
    enableDevTools()
    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, Counter)

    const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_inspect_element', {
      selector: '#does-not-exist',
    })

    expect(result).toBeNull()
  })
})

describe('llui_get_rendered_html jsdom e2e', () => {
  it('returns the outerHTML of the element matching the selector', async () => {
    enableDevTools()

    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, Counter)

    const api = (globalThis as unknown as { __lluiDebug: LluiDebugAPI }).__lluiDebug
    expect(api).toBeDefined()

    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_get_rendered_html', {
      selector: '#c',
    })) as string

    expect(result).toBeTruthy()
    expect(result.startsWith('<div')).toBe(true)
    expect(result).toContain('id="c"')
  })
})
