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
    getCompiledSource: () => null,
    getMsgMaskMap: () => null,
    getBindingSource: () => null,
    getHydrationReport: () => [],
    getComponentInfo: () => ({ name: 'T', file: null, line: null }),
    ...overrides,
  } as unknown as LluiDebugAPI
}

describe('llui_hydration_report', () => {
  it('returns empty array when no divergences', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_hydration_report', {})) as {
      divergences: unknown[]
    }
    expect(Array.isArray(result.divergences)).toBe(true)
    expect(result.divergences).toEqual([])
  })

  it('returns divergences from the debug API', async () => {
    const divergences = [
      { path: 'body > div', kind: 'attribute', server: 'class=""', client: 'class="active"' },
    ]
    const server = new LluiMcpServer()
    server.connectDirect(
      mkApi({
        getHydrationReport: () => divergences as ReturnType<LluiDebugAPI['getHydrationReport']>,
      }),
    )
    const result = (await server.handleToolCall('llui_hydration_report', {})) as {
      divergences: unknown[]
    }
    expect(result.divergences).toEqual(divergences)
  })
})

describe('llui_ssr_render', () => {
  it('tool is registered', () => {
    const server = new LluiMcpServer()
    expect(server.getTools().some((t) => t.name === 'llui_ssr_render')).toBe(true)
  })

  it('returns error when component file is unknown', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())
    const result = (await server.handleToolCall('llui_ssr_render', {})) as {
      ok: boolean
      error: string
    }
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('SSR tool list', () => {
  it('exposes both SSR tools', () => {
    const server = new LluiMcpServer()
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_hydration_report')
    expect(names).toContain('llui_ssr_render')
  })
})
