import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, type ToolHandler } from '../src/tool-registry'

describe('ToolRegistry', () => {
  it('registers and dispatches a tool by name, passing the parsed args through', async () => {
    const registry = new ToolRegistry()
    const handler: ToolHandler = vi.fn(async (_args) => ({ ok: true }))
    registry.register(
      {
        name: 'x_test',
        description: 'test',
        schema: z.object({ foo: z.string().optional() }),
      },
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

  it('rejects invalid args via the Zod schema before invoking the handler', async () => {
    const registry = new ToolRegistry()
    const handler: ToolHandler = vi.fn(async () => ({ ok: true }))
    registry.register(
      {
        name: 'needs_path',
        description: 't',
        schema: z.object({ path: z.string() }),
      },
      'debug-api',
      handler,
    )
    await expect(registry.dispatch('needs_path', {}, { relay: null, cdp: null })).rejects.toThrow(
      /Invalid args for needs_path/,
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('lists tool definitions in the back-compat JSON-Schema shape', () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'a', description: 'a', schema: z.object({}) },
      'debug-api',
      async () => null,
    )
    registry.register(
      {
        name: 'b',
        description: 'b',
        schema: z.object({ count: z.number() }),
      },
      'cdp',
      async () => null,
    )
    const tools = registry.listDefinitions()
    expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b'])
    const b = tools.find((t) => t.name === 'b')!
    expect(b.inputSchema.type).toBe('object')
    expect(b.inputSchema.properties).toHaveProperty('count')
    expect(b.inputSchema.required).toEqual(['count'])
  })
})
