import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

function mockDebugApi(state: Record<string, unknown> = { count: 0 }): LluiDebugAPI {
  let currentState = { ...state }
  const history: Array<{ msg: unknown; stateAfter: unknown }> = []

  return {
    getState: () => currentState,
    send: vi.fn((msg) => {
      history.push({ msg, stateAfter: currentState })
    }),
    flush: vi.fn(),
    evalUpdate: (msg) => ({ state: currentState, effects: [] }),
    getMessageHistory: () => history,
    exportTrace: () => ({
      lluiTrace: 1,
      component: 'Test',
      generatedBy: 'test',
      timestamp: new Date().toISOString(),
      entries: [],
    }),
    clearLog: vi.fn(),
    validateMessage: () => null,
    getBindings: () => [],
    whyDidUpdate: () => ({ mask: 0, dirty: 0, evaluated: false, value: undefined }),
    searchState: (path) => {
      const parts = path.split('.')
      let val: unknown = currentState
      for (const p of parts) {
        if (val && typeof val === 'object') val = (val as Record<string, unknown>)[p]
        else val = undefined
      }
      return val
    },
  }
}

describe('LluiMcpServer', () => {
  it('can be created with a debug API', () => {
    const api = mockDebugApi()
    const server = new LluiMcpServer()
    server.connectDirect(api)
    expect(server).toBeDefined()
  })

  it('returns tool definitions', () => {
    const server = new LluiMcpServer()
    const tools = server.getTools()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools[0]).toHaveProperty('name')
    expect(tools[0]).toHaveProperty('description')
    expect(tools[0]).toHaveProperty('inputSchema')
  })

  it('handles llui_get_state tool', async () => {
    const api = mockDebugApi({ count: 42 })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_get_state', {})
    expect(result).toEqual({ count: 42 })
  })

  it('handles llui_send_message tool', async () => {
    const api = mockDebugApi()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    await server.handleToolCall('llui_send_message', { msg: { type: 'inc' } })
    expect(api.send).toHaveBeenCalledWith({ type: 'inc' })
    expect(api.flush).toHaveBeenCalled()
  })

  it('handles llui_eval_update tool', async () => {
    const api = mockDebugApi({ count: 0 })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_eval_update', { msg: { type: 'inc' } })
    expect(result).toHaveProperty('state')
    expect(result).toHaveProperty('effects')
  })

  it('handles llui_search_state tool', async () => {
    const api = mockDebugApi({ user: { name: 'Franco' } })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_search_state', { query: 'user.name' })
    expect(result).toBe('Franco')
  })

  it('handles llui_clear_log tool', async () => {
    const api = mockDebugApi()
    const server = new LluiMcpServer()
    server.connectDirect(api)

    await server.handleToolCall('llui_clear_log', {})
    expect(api.clearLog).toHaveBeenCalled()
  })

  it('returns error for unknown tool', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mockDebugApi())

    await expect(server.handleToolCall('nonexistent', {})).rejects.toThrow()
  })

  it('returns error when no API connected', async () => {
    const server = new LluiMcpServer()
    await expect(server.handleToolCall('llui_get_state', {})).rejects.toThrow()
  })
})
