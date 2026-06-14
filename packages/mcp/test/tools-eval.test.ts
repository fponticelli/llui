import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI, PendingEffect, EffectTimelineEntry, StateDiff } from '@llui/dom'
import type { EffectMatch } from '@llui/dom'

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
    getEffectTimeline: vi.fn(() => [] as EffectTimelineEntry[]),
    mockEffect: vi.fn(() => ({ mockId: '' })),
    resolveEffect: vi.fn(() => ({ resolved: false })),
    stepBack: vi.fn(() => ({ state: { count: 0 }, rewindDepth: 0 })),
    getCoverage: () => ({ fired: {}, neverFired: [] }),
    evalInPage: vi.fn(() => ({
      result: undefined,
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [] as PendingEffect[],
        dirtyBindingIndices: [] as number[],
      },
    })),
    ...overrides,
  }
  return base
}

describe('llui_eval registration gating (RCE opt-in)', () => {
  it('does NOT register or list llui_eval by default', () => {
    const prev = process.env['LLUI_MCP_ENABLE_EVAL']
    delete process.env['LLUI_MCP_ENABLE_EVAL']
    try {
      const server = new LluiMcpServer()
      const names = server.getTools().map((t) => t.name)
      expect(names).not.toContain('llui_eval')
      // The structured dry-run dispatch tool stays available.
      expect(names).toContain('llui_eval_update')
    } finally {
      if (prev !== undefined) process.env['LLUI_MCP_ENABLE_EVAL'] = prev
    }
  })

  it('rejects dispatch of llui_eval when not enabled', async () => {
    const prev = process.env['LLUI_MCP_ENABLE_EVAL']
    delete process.env['LLUI_MCP_ENABLE_EVAL']
    try {
      const server = new LluiMcpServer()
      server.connectDirect(mkApi())
      await expect(server.handleToolCall('llui_eval', { code: '1' })).rejects.toThrow(
        /Unknown tool/,
      )
    } finally {
      if (prev !== undefined) process.env['LLUI_MCP_ENABLE_EVAL'] = prev
    }
  })

  it('registers llui_eval when enableEval option is set', () => {
    const server = new LluiMcpServer({ enableEval: true })
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_eval')
  })

  it('registers llui_eval when LLUI_MCP_ENABLE_EVAL=1', () => {
    const prev = process.env['LLUI_MCP_ENABLE_EVAL']
    process.env['LLUI_MCP_ENABLE_EVAL'] = '1'
    try {
      const server = new LluiMcpServer()
      const names = server.getTools().map((t) => t.name)
      expect(names).toContain('llui_eval')
    } finally {
      if (prev === undefined) delete process.env['LLUI_MCP_ENABLE_EVAL']
      else process.env['LLUI_MCP_ENABLE_EVAL'] = prev
    }
  })
})

describe('llui_eval', () => {
  // These exercise the eval behavior, so they need the tool registered.
  let prevEnableEval: string | undefined
  beforeAll(() => {
    prevEnableEval = process.env['LLUI_MCP_ENABLE_EVAL']
    process.env['LLUI_MCP_ENABLE_EVAL'] = '1'
  })
  afterAll(() => {
    if (prevEnableEval === undefined) delete process.env['LLUI_MCP_ENABLE_EVAL']
    else process.env['LLUI_MCP_ENABLE_EVAL'] = prevEnableEval
  })

  it('returns result and empty sideEffects for a pure expression', async () => {
    const fn = vi.fn(() => ({
      result: 42,
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [] as PendingEffect[],
        dirtyBindingIndices: [] as number[],
      },
    }))
    const api = mkApi({ evalInPage: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_eval', { code: '1 + 1' })
    expect(fn).toHaveBeenCalledWith('1 + 1')
    expect(result).toEqual({
      result: 42,
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [],
        dirtyBindingIndices: [],
      },
    })
  })

  it('surfaces state changes, history entries, and dirty binding indices', async () => {
    const stateDiff: StateDiff = {
      added: {},
      removed: {},
      changed: { n: { from: 0, to: 5 } },
    }
    const fn = vi.fn(() => ({
      result: undefined,
      sideEffects: {
        stateChanged: stateDiff,
        newHistoryEntries: 1,
        newPendingEffects: [] as PendingEffect[],
        dirtyBindingIndices: [0, 1],
      },
    }))
    const api = mkApi({ evalInPage: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const code = "globalThis.__lluiDebug.send({type:'inc'})"
    const result = await server.handleToolCall('llui_eval', { code })
    expect(fn).toHaveBeenCalledWith(code)
    expect(result).toEqual({
      result: undefined,
      sideEffects: {
        stateChanged: stateDiff,
        newHistoryEntries: 1,
        newPendingEffects: [],
        dirtyBindingIndices: [0, 1],
      },
    })
  })

  it('returns { error } when the expression throws', async () => {
    const fn = vi.fn(() => ({
      result: { error: 'boom' },
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [] as PendingEffect[],
        dirtyBindingIndices: [] as number[],
      },
    }))
    const api = mkApi({ evalInPage: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_eval', { code: 'throw new Error("boom")' })
    expect(fn).toHaveBeenCalledWith('throw new Error("boom")')
    expect(result).toEqual({
      result: { error: 'boom' },
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [],
        dirtyBindingIndices: [],
      },
    })
  })
})
