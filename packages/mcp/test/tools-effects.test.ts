import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI, PendingEffect, EffectTimelineEntry } from '@llui/dom'
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
    getEffectTimeline: vi.fn(() => []),
    mockEffect: vi.fn(() => ({ mockId: '' })),
    resolveEffect: vi.fn(() => ({ resolved: false })),
    ...overrides,
  }
  return base
}

describe('llui_pending_effects', () => {
  it('returns the pending effects list', async () => {
    const effects: PendingEffect[] = [
      { id: 'e1', type: 'http', dispatchedAt: 1, status: 'queued' as const, payload: {} },
    ]
    const fn = vi.fn(() => effects)
    const api = mkApi({ getPendingEffects: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_pending_effects', {})
    expect(fn).toHaveBeenCalledWith()
    expect(result).toEqual(effects)
  })
})

describe('llui_effect_timeline', () => {
  it('forwards limit', async () => {
    const entries: EffectTimelineEntry[] = [
      { effectId: 'e1', type: 'http', phase: 'dispatched' as const, timestamp: 100 },
    ]
    const fn = vi.fn(() => entries)
    const api = mkApi({ getEffectTimeline: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_effect_timeline', { limit: 5 })
    expect(fn).toHaveBeenCalledWith(5)
    expect(result).toEqual(entries)
  })

  it('passes undefined when limit omitted', async () => {
    const fn = vi.fn(() => [])
    const api = mkApi({ getEffectTimeline: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_effect_timeline', {})
    expect(fn).toHaveBeenCalledWith(undefined)
  })
})

describe('llui_mock_effect', () => {
  it('registers a mock via mockEffect', async () => {
    const fn = vi.fn(() => ({ mockId: 'm1' }))
    const api = mkApi({ mockEffect: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_mock_effect', {
      match: { type: 'http' } satisfies EffectMatch,
      response: { data: 'fake' },
    })
    expect(fn).toHaveBeenCalledWith({ type: 'http' }, { data: 'fake' }, undefined)
    expect(result).toEqual({ mockId: 'm1' })
  })

  it('forwards opts.persist', async () => {
    const fn = vi.fn(() => ({ mockId: 'm2' }))
    const api = mkApi({ mockEffect: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_mock_effect', {
      match: { type: 'http' } satisfies EffectMatch,
      response: 'x',
      opts: { persist: true },
    })
    expect(fn).toHaveBeenCalledWith({ type: 'http' }, 'x', { persist: true })
  })
})

describe('llui_resolve_effect', () => {
  it('resolves by id', async () => {
    const fn = vi.fn(() => ({ resolved: true }))
    const api = mkApi({ resolveEffect: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_resolve_effect', {
      effectId: 'e1',
      response: { ok: 1 },
    })
    expect(fn).toHaveBeenCalledWith('e1', { ok: 1 })
    expect(result).toEqual({ resolved: true })
  })

  it('returns resolved:false when id unknown', async () => {
    const api = mkApi({ resolveEffect: vi.fn(() => ({ resolved: false })) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_resolve_effect', {
      effectId: 'missing',
      response: null,
    })
    expect(result).toEqual({ resolved: false })
  })
})
