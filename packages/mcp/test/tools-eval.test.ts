import { describe, it, expect, vi } from 'vitest'
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

describe('llui_eval', () => {
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
