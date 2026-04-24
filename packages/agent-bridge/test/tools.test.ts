import { describe, it, expect } from 'vitest'
import { TOOLS, TOOL_TO_LAP_PATH } from '../src/tools.js'

describe('MCP tool registry', () => {
  it('advertises the unified observe tool', () => {
    const observe = TOOLS.find((t) => t.name === 'observe')
    expect(observe).toBeDefined()
    const desc = (observe?.description ?? '').toLowerCase()
    expect(desc).toContain('state')
    expect(desc).toContain('actions')
    expect(desc).toContain('description')
  })

  it('maps observe → /observe in the LAP path table', () => {
    expect(TOOL_TO_LAP_PATH.observe).toBe('/observe')
  })

  it('send_message advertises drain controls (waitFor, drainQuietMs, timeoutMs)', () => {
    const send = TOOLS.find((t) => t.name === 'send_message')
    expect(send).toBeDefined()
    const props = send!.inputSchema.properties as Record<string, { type?: string; enum?: string[] }>
    expect(props.waitFor).toBeDefined()
    expect(props.waitFor!.enum).toEqual(['drained', 'idle', 'none'])
    expect(props.drainQuietMs).toBeDefined()
    expect(props.timeoutMs).toBeDefined()
  })

  it('keeps legacy tools available for back-compat', () => {
    for (const legacy of ['describe_app', 'get_state', 'list_actions', 'wait_for_change']) {
      expect(TOOLS.find((t) => t.name === legacy)).toBeDefined()
      expect(TOOL_TO_LAP_PATH[legacy]).toBeDefined()
    }
  })

  it('preserves meta-tools (connect/disconnect)', () => {
    expect(TOOLS.find((t) => t.name === 'llui_connect_session')).toBeDefined()
    expect(TOOLS.find((t) => t.name === 'llui_disconnect_session')).toBeDefined()
  })
})
