import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI, CoverageSnapshot, MessageRecord } from '@llui/dom'

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
    getPendingEffects: vi.fn(() => []),
    getEffectTimeline: vi.fn(() => []),
    mockEffect: vi.fn(() => ({ mockId: '' })),
    resolveEffect: vi.fn(() => ({ resolved: false })),
    stepBack: vi.fn(() => ({ state: {}, rewindDepth: 0 })),
    getCoverage: vi.fn(() => ({ fired: {}, neverFired: [] })),
    ...overrides,
  }
  return base
}

describe('llui_step_back', () => {
  it('defaults to n=1, mode=pure', async () => {
    const fn = vi.fn(() => ({ state: {}, rewindDepth: 1 }))
    const api = mkApi({ stepBack: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_step_back', {})
    expect(fn).toHaveBeenCalledWith(1, 'pure')
  })

  it('forwards n and mode=live', async () => {
    const fn = vi.fn(() => ({ state: { x: 1 }, rewindDepth: 3 }))
    const api = mkApi({ stepBack: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_step_back', { n: 3, mode: 'live' })
    expect(fn).toHaveBeenCalledWith(3, 'live')
    expect(result).toEqual({ state: { x: 1 }, rewindDepth: 3 })
  })
})

describe('llui_coverage', () => {
  it('passes coverage snapshot through', async () => {
    const snap: CoverageSnapshot = {
      fired: { increment: { count: 3, lastIndex: 2 } },
      neverFired: ['decrement'],
    }
    const fn = vi.fn(() => snap)
    const api = mkApi({ getCoverage: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_coverage', {})
    expect(fn).toHaveBeenCalled()
    expect(result).toEqual(snap)
  })
})

describe('llui_diff_state', () => {
  it('returns added/removed/changed', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = await server.handleToolCall('llui_diff_state', {
      a: { x: 1, y: 2 },
      b: { x: 1, y: 3, z: 4 },
    })
    expect(result).toEqual({
      added: { z: 4 },
      removed: {},
      changed: { y: { from: 2, to: 3 } },
    })
  })
})

describe('llui_assert', () => {
  it('eq passes when state path matches expected value', async () => {
    const api = mkApi({ searchState: () => 42 })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_assert', {
      path: 'count',
      op: 'eq',
      value: 42,
    })
    expect(result).toEqual({ pass: true, actual: 42, expected: 42, op: 'eq' })
  })

  it('gt fails when actual is not greater than expected', async () => {
    const api = mkApi({ searchState: () => 3 })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_assert', {
      path: 'count',
      op: 'gt',
      value: 10,
    })
    expect(result).toEqual({ pass: false, actual: 3, expected: 10, op: 'gt' })
  })
})

describe('llui_search_history', () => {
  it('filters history by msg.type', async () => {
    const records: MessageRecord[] = [
      {
        index: 0,
        timestamp: 1,
        msg: { type: 'increment' },
        stateBefore: { count: 0 },
        stateAfter: { count: 1 },
        effects: [],
        dirtyMask: 1,
      },
      {
        index: 1,
        timestamp: 2,
        msg: { type: 'decrement' },
        stateBefore: { count: 1 },
        stateAfter: { count: 0 },
        effects: [],
        dirtyMask: 1,
      },
    ]
    const api = mkApi({ getMessageHistory: () => records })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_search_history', {
      filter: { type: 'increment' },
    })
    expect(result).toEqual([records[0]])
  })
})
