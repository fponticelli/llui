import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

function mkApi(overrides?: Partial<LluiDebugAPI>): LluiDebugAPI {
  const base: LluiDebugAPI = {
    getState: () => ({ count: 0 }),
    send: vi.fn(),
    flush: vi.fn(),
    evalUpdate: () => ({ state: { count: 0 }, effects: [] }),
    getMessageHistory: () => [],
    exportTrace: () => ({
      lluiTrace: 1 as const,
      component: 'Test',
      generatedBy: 'test',
      timestamp: new Date().toISOString(),
      entries: [],
    }),
    clearLog: vi.fn(),
    validateMessage: () => null,
    getBindings: () => [],
    whyDidUpdate: () => ({
      bindingIndex: 0,
      bindingMask: 0,
      lastDirtyMask: 0,
      matched: false,
      accessorResult: undefined,
      lastValue: undefined,
      changed: false,
    }),
    searchState: () => undefined,
    getMessageSchema: () => null,
    getMaskLegend: () => null,
    decodeMask: () => [],
    getComponentInfo: () => ({ name: 'Test', file: null, line: null }),
    getStateSchema: () => null,
    getEffectSchema: () => null,
    snapshotState: () => ({ count: 0 }),
    restoreState: vi.fn(),
    getBindingsFor: () => [],
    inspectElement: () => null,
    getRenderedHtml: () => '',
    dispatchDomEvent: () => ({
      dispatched: false,
      messagesProducedIndices: [],
      resultingState: null,
    }),
    getFocus: () => ({ selector: null, tagName: null, selectionStart: null, selectionEnd: null }),
    ...overrides,
  }
  return base
}

describe('llui_dispatch_event tool', () => {
  it('calls dispatchDomEvent with (selector, type, undefined) when no init provided', async () => {
    const mockResult = {
      dispatched: true,
      messagesProducedIndices: [0],
      resultingState: { n: 1 },
    }
    const fn = vi.fn(() => mockResult)
    const api = mkApi({ dispatchDomEvent: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_dispatch_event', {
      selector: '#b',
      type: 'click',
    })

    expect(fn).toHaveBeenCalledWith('#b', 'click', undefined)
    expect(result).toEqual(mockResult)
  })

  it('forwards init when provided', async () => {
    const mockResult = {
      dispatched: true,
      messagesProducedIndices: [1],
      resultingState: { n: 2 },
    }
    const fn = vi.fn(() => mockResult)
    const api = mkApi({ dispatchDomEvent: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_dispatch_event', {
      selector: '#input',
      type: 'keydown',
      init: { key: 'Enter' },
    })

    expect(fn).toHaveBeenCalledWith('#input', 'keydown', { key: 'Enter' })
    expect(result).toEqual(mockResult)
  })
})

describe('llui_get_focus', () => {
  it('returns focus info from getFocus() method', async () => {
    const mockFocus = { selector: '#input', tagName: 'input', selectionStart: 2, selectionEnd: 2 }
    const fn = vi.fn(() => mockFocus)
    const api = mkApi({ getFocus: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_get_focus', {})

    expect(fn).toHaveBeenCalledWith()
    expect(result).toEqual(mockFocus)
  })
})
