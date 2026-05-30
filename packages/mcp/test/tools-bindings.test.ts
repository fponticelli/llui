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
    getFocus: () => ({
      selector: null,
      tagName: null,
      selectionStart: null,
      selectionEnd: null,
    }),
    forceRerender: vi.fn(() => ({ changedBindings: [] })),
    getEachDiff: () => [],
    getScopeTree: () => ({ scopeId: '1', kind: 'root' as const, active: true, children: [] }),
    getDisposerLog: () => [],
    getBindingGraph: () => [],
    ...overrides,
  }
  return base
}

describe('llui_force_rerender', () => {
  it('calls forceRerender and returns changed bindings', async () => {
    const fn = vi.fn(() => ({ changedBindings: [0, 3] }))
    const api = mkApi({ forceRerender: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_force_rerender', {})
    expect(fn).toHaveBeenCalledWith()
    expect(result).toEqual({ changedBindings: [0, 3] })
  })
})

describe('llui_each_diff', () => {
  it('forwards sinceIndex', async () => {
    const diffs = [
      { updateIndex: 0, eachSiteId: 's1', added: [], removed: [], moved: [], reused: [] },
      { updateIndex: 1, eachSiteId: 's1', added: ['a'], removed: [], moved: [], reused: [] },
    ]
    const fn = vi.fn(() => diffs)
    const api = mkApi({ getEachDiff: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_each_diff', { sinceIndex: 1 })
    expect(fn).toHaveBeenCalledWith(1)
    expect(result).toEqual(diffs)
  })

  it('passes undefined when sinceIndex omitted', async () => {
    const fn = vi.fn(() => [])
    const api = mkApi({ getEachDiff: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_each_diff', {})
    expect(fn).toHaveBeenCalledWith(undefined)
  })
})

describe('llui_scope_tree', () => {
  it('forwards depth and scopeId to getScopeTree', async () => {
    const tree = {
      scopeId: '1',
      kind: 'root' as const,
      active: true,
      children: [{ scopeId: '2', kind: 'each' as const, active: true, children: [] }],
    }
    const fn = vi.fn(() => tree)
    const api = mkApi({ getScopeTree: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_scope_tree', { depth: 2, scopeId: '1' })
    expect(fn).toHaveBeenCalledWith({ depth: 2, scopeId: '1' })
    expect(result).toEqual(tree)
  })
})

describe('llui_disposer_log', () => {
  it('forwards limit', async () => {
    const events = [{ scopeId: '5', cause: 'each-remove' as const, timestamp: 1 }]
    const fn = vi.fn(() => events)
    const api = mkApi({ getDisposerLog: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_disposer_log', { limit: 10 })
    expect(fn).toHaveBeenCalledWith(10)
    expect(result).toEqual(events)
  })
})

describe('llui_list_dead_bindings', () => {
  it('returns dead and never-changed bindings with a reason', async () => {
    const api = mkApi({
      getBindings: vi.fn(() => [
        {
          index: 0,
          mask: 1,
          lastValue: 'x',
          kind: 'text',
          key: undefined,
          dead: false,
          perItem: false,
        },
        {
          index: 1,
          mask: 2,
          lastValue: undefined,
          kind: 'text',
          key: undefined,
          dead: false,
          perItem: false,
        },
        {
          index: 2,
          mask: 4,
          lastValue: 'y',
          kind: 'text',
          key: undefined,
          dead: true,
          perItem: false,
        },
      ]),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_list_dead_bindings', {})) as Array<{
      index: number
      reason: string
    }>
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.reason).sort()).toEqual(['never_changed', 'scope_disposed'])
  })
})

describe('llui_binding_graph', () => {
  it('returns the binding graph', async () => {
    const graph = [
      { statePath: 'count', bindingIndices: [0, 2] },
      { statePath: 'name', bindingIndices: [1] },
    ]
    const fn = vi.fn(() => graph)
    const api = mkApi({ getBindingGraph: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_binding_graph', {})
    expect(fn).toHaveBeenCalledWith()
    expect(result).toEqual(graph)
  })
})
