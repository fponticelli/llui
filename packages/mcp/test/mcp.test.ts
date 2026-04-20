import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { LluiMcpServer, mcpActiveFilePath } from '../src/index'
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

  it('writes devUrl to the marker file when provided', () => {
    const server = new LluiMcpServer(5299)
    server.setDevUrl('http://localhost:5173')
    server.startBridge()
    const path = mcpActiveFilePath()
    expect(existsSync(path)).toBe(true)
    const marker = JSON.parse(readFileSync(path, 'utf8')) as {
      port: number
      pid: number
      devUrl?: string
    }
    expect(marker.port).toBe(5299)
    expect(marker.devUrl).toBe('http://localhost:5173')
    server.stopBridge()
  })

  it('omits devUrl from the marker file when not set', () => {
    const server = new LluiMcpServer(5298)
    server.startBridge()
    const marker = JSON.parse(readFileSync(mcpActiveFilePath(), 'utf8')) as {
      port: number
      devUrl?: string
    }
    expect(marker.devUrl).toBeUndefined()
    server.stopBridge()
  })
})

describe('llui_lint tool', () => {
  it('lints inline source via the source argument', async () => {
    const server = new LluiMcpServer()
    // No debug API needed — lint tool is independent of the running app
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count++  // mutation
          return [state, []]
        },
        view: () => [],
      })
    `
    const result = (await server.handleToolCall('llui_lint', { source })) as {
      file: string
      score: number
      violations: Array<{ rule: string; line: number; message: string }>
      summary: string
    }
    expect(result.file).toBe('input.ts')
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(result.score).toBeLessThan(20)
    expect(result.summary).toContain('violation')
  })

  it('returns score 20 and zero violations for clean source', async () => {
    const server = new LluiMcpServer()
    const source = `
      import { component, div } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc':
              return [{ ...state, count: state.count + 1 }, []]
          }
        },
        view: ({ text }) => [div({}, [text((s) => String(s.count))])],
      })
    `
    const result = (await server.handleToolCall('llui_lint', { source })) as {
      score: number
      violations: unknown[]
    }
    expect(result.score).toBe(20)
    expect(result.violations).toEqual([])
  })

  it('respects the exclude option', async () => {
    const server = new LluiMcpServer()
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count++
          return [state, []]
        },
        view: () => [],
      })
    `
    const result = (await server.handleToolCall('llui_lint', {
      source,
      exclude: ['state-mutation'],
    })) as {
      violations: Array<{ rule: string }>
    }
    expect(result.violations.every((v) => v.rule !== 'state-mutation')).toBe(true)
  })

  it('throws when neither source nor path is provided', async () => {
    const server = new LluiMcpServer()
    await expect(server.handleToolCall('llui_lint', {})).rejects.toThrow(/source.*path/)
  })

  it('throws when both source and path are provided', async () => {
    const server = new LluiMcpServer()
    await expect(
      server.handleToolCall('llui_lint', { source: 'x', path: '/tmp/foo.ts' }),
    ).rejects.toThrow(/not both/)
  })

  it('lints a file via the path argument', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = mkdtempSync(join(tmpdir(), 'llui-lint-test-'))
    const filePath = join(dir, 'sample.ts')
    writeFileSync(
      filePath,
      `
        import { component } from '@llui/dom'
        type State = { count: number }
        type Msg = { type: 'inc' }
        const C = component<State, Msg, never>({
          name: 'C',
          init: () => [{ count: 0 }, []],
          update: (state) => { state.count++; return [state, []] },
          view: () => [],
        })
      `,
    )

    try {
      const server = new LluiMcpServer()
      const result = (await server.handleToolCall('llui_lint', { path: filePath })) as {
        file: string
        violations: Array<{ rule: string }>
      }
      expect(result.file).toBe(filePath)
      expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects non-.ts paths', async () => {
    const server = new LluiMcpServer()
    await expect(server.handleToolCall('llui_lint', { path: '/tmp/foo.js' })).rejects.toThrow(
      /\.ts/,
    )
  })

  it('rejects nonexistent paths', async () => {
    const server = new LluiMcpServer()
    await expect(
      server.handleToolCall('llui_lint', { path: '/nonexistent/file.ts' }),
    ).rejects.toThrow(/not found/)
  })

  it('exposes llui_lint in the tool list', () => {
    const server = new LluiMcpServer()
    const tools = server.getTools()
    const lint = tools.find((t) => t.name === 'llui_lint')
    expect(lint).toBeDefined()
    expect(lint!.description).toContain('lint')
    expect(lint!.inputSchema.properties.source).toBeDefined()
    expect(lint!.inputSchema.properties.path).toBeDefined()
    expect(lint!.inputSchema.properties.exclude).toBeDefined()
  })
})
