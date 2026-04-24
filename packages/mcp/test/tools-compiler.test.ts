import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

function mkApi(overrides?: Partial<LluiDebugAPI>): LluiDebugAPI {
  return {
    getState: () => ({}),
    send: vi.fn(),
    flush: vi.fn(),
    evalUpdate: () => ({ state: {}, effects: [] }),
    getMessageHistory: () => [],
    exportTrace: () => ({
      lluiTrace: 1 as const,
      component: 'T',
      generatedBy: 'test',
      timestamp: '',
      entries: [],
    }),
    clearLog: vi.fn(),
    validateMessage: () => null,
    getBindings: () => [],
    whyDidUpdate: () => ({ mask: 0, dirty: 0, evaluated: false, value: undefined }),
    searchState: () => undefined,
    getCompiledSource: () => ({ pre: 'view: () => []', post: 'view: () => []' }),
    getMsgMaskMap: () => ({ count: 1 }),
    getBindingSource: (i) => (i === 0 ? { file: 'counter.ts', line: 10, column: 5 } : null),
    ...overrides,
  } as unknown as LluiDebugAPI
}

describe('llui_show_compiled', () => {
  it('returns pre/post source via relay', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_show_compiled', {})) as {
      pre: string
      post: string
    }
    expect(result.pre).toBe('view: () => []')
    expect(result.post).toBe('view: () => []')
  })

  it('returns null values when component has no metadata', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi({ getCompiledSource: () => null }))
    const result = await server.handleToolCall('llui_show_compiled', {})
    expect(result).toEqual({ pre: null, post: null })
  })
})

describe('llui_explain_mask', () => {
  it('returns mask bits for a state path key', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_explain_mask', { msgType: 'count' })) as {
      msgType: string
      mask: number
      paths: string[]
    }
    expect(result.msgType).toBe('count')
    expect(result.mask).toBe(1)
  })

  it('returns mask 0 for unknown msgType', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_explain_mask', { msgType: 'unknown' })) as {
      mask: number
    }
    expect(result.mask).toBe(0)
  })
})

describe('llui_goto_binding_source', () => {
  it('returns file/line/col for a known binding', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_goto_binding_source', {
      bindingIndex: 0,
    })) as { file: string; line: number; column: number }
    expect(result.file).toBe('counter.ts')
    expect(result.line).toBe(10)
  })

  it('returns null for unknown binding', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = await server.handleToolCall('llui_goto_binding_source', { bindingIndex: 99 })
    expect(result).toBeNull()
  })
})

describe('compiler tool list', () => {
  it('exposes all 3 compiler tools', () => {
    const server = new LluiMcpServer()
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_show_compiled')
    expect(names).toContain('llui_explain_mask')
    expect(names).toContain('llui_goto_binding_source')
  })
})
