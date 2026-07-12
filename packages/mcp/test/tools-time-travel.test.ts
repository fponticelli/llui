import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI, MessageRecord } from '@llui/dom'

// A signal-runtime-shaped fake: only the servable core methods. The
// binding/scope/effect/time-travel methods are legacy-runtime concepts the
// signal runtime does not implement, and the tools that used them have been
// dropped — so they are intentionally absent here.
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
    searchState: () => undefined,
    getMessageSchema: () => null,
    getComponentInfo: () => ({ name: 'Test', file: null, line: null }),
    getStateSchema: () => null,
    getEffectSchema: () => null,
    snapshotState: () => ({ count: 0 }),
    restoreState: vi.fn(),
    ...overrides,
  }
  return base
}

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
      },
      {
        index: 1,
        timestamp: 2,
        msg: { type: 'decrement' },
        stateBefore: { count: 1 },
        stateAfter: { count: 0 },
        effects: [],
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
