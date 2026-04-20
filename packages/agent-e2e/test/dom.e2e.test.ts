import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndBind, parseToolResult } from '../src/test-utils.js'

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup()
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: DOM inspection', () => {
  it('query_dom({name: "inc"}) returns an element with text "+"', async () => {
    await mintAndBind(ctx)

    const result = await ctx.mcpClient.callTool({
      name: 'query_dom',
      arguments: { name: 'inc' },
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{
      elements: Array<{ text: string; attrs: Record<string, string> }>
    }>(result as { content: Array<{ type: string; text?: string }> })

    expect(body.elements.length).toBeGreaterThanOrEqual(1)
    expect(body.elements[0]!.text).toBe('+')
    expect(body.elements[0]!.attrs['data-agent']).toBe('inc')
  })

  it('describe_visible_content returns an outline with a button for "inc"', async () => {
    await mintAndBind(ctx)

    const result = await ctx.mcpClient.callTool({
      name: 'describe_visible_content',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{
      outline: Array<{ kind: string; text?: string; actionVariant?: string }>
    }>(result as { content: Array<{ type: string; text?: string }> })

    expect(Array.isArray(body.outline)).toBe(true)

    const incButton = body.outline.find(
      (item) => item.kind === 'button' && item.actionVariant === 'inc',
    )
    expect(incButton).toBeDefined()
    expect(incButton!.text).toBe('+')
  })
})
