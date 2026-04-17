import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry, type ToolHandler } from '../src/tool-registry'

describe('ToolRegistry', () => {
  it('registers and dispatches a tool by name', async () => {
    const registry = new ToolRegistry()
    const handler: ToolHandler = vi.fn(async (_args) => ({ ok: true }))
    registry.register(
      { name: 'x_test', description: 'test', inputSchema: { type: 'object', properties: {} } },
      'debug-api',
      handler,
    )
    const result = await registry.dispatch('x_test', { foo: 'bar' }, { relay: null, cdp: null })
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, { relay: null, cdp: null })
    expect(result).toEqual({ ok: true })
  })

  it('throws on unknown tool', async () => {
    const registry = new ToolRegistry()
    await expect(registry.dispatch('no_such_tool', {}, { relay: null, cdp: null })).rejects.toThrow(
      /Unknown tool: no_such_tool/,
    )
  })

  it('lists all registered tool definitions', () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } },
      'debug-api',
      async () => null,
    )
    registry.register(
      { name: 'b', description: 'b', inputSchema: { type: 'object', properties: {} } },
      'cdp',
      async () => null,
    )
    const tools = registry.listDefinitions()
    expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b'])
  })
})
