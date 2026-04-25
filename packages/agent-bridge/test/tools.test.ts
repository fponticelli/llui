import { describe, it, expect } from 'vitest'
import { TOOL_DESCRIPTORS } from '../src/tools.js'

describe('MCP tool registry', () => {
  const findDesc = (name: string) => TOOL_DESCRIPTORS.find((t) => t.name === name)

  it('advertises the unified observe tool', () => {
    const observe = findDesc('observe')
    expect(observe).toBeDefined()
    const desc = (observe?.description ?? '').toLowerCase()
    expect(desc).toContain('state')
    expect(desc).toContain('actions')
    expect(desc).toContain('description')
  })

  it('maps observe → /observe in the LAP path table', () => {
    const observe = findDesc('observe')
    expect(observe?.kind).toBe('forward')
    if (observe?.kind === 'forward') {
      expect(observe.lapPath).toBe('/observe')
    }
  })

  it('send_message advertises drain controls (waitFor, drainQuietMs, timeoutMs)', () => {
    const send = findDesc('send_message')
    expect(send).toBeDefined()
    const shape = send!.schema.shape
    expect(shape.waitFor).toBeDefined()
    expect(shape.drainQuietMs).toBeDefined()
    expect(shape.timeoutMs).toBeDefined()
    // Spot-check that waitFor accepts the documented enum values via parse
    expect(send!.schema.safeParse({ msg: { type: 'x' }, waitFor: 'drained' }).success).toBe(true)
    expect(send!.schema.safeParse({ msg: { type: 'x' }, waitFor: 'idle' }).success).toBe(true)
    expect(send!.schema.safeParse({ msg: { type: 'x' }, waitFor: 'none' }).success).toBe(true)
    expect(send!.schema.safeParse({ msg: { type: 'x' }, waitFor: 'bogus' }).success).toBe(false)
  })

  it('send_message rejects calls missing the required msg field', () => {
    const send = findDesc('send_message')
    expect(send!.schema.safeParse({}).success).toBe(false)
  })

  it('keeps legacy tools available for back-compat', () => {
    for (const legacy of ['describe_app', 'get_state', 'list_actions', 'wait_for_change']) {
      const t = findDesc(legacy)
      expect(t).toBeDefined()
      expect(t!.kind).toBe('forward')
    }
  })

  it('preserves meta-tools (connect/disconnect)', () => {
    expect(findDesc('llui_connect_session')?.kind).toBe('meta')
    expect(findDesc('llui_disconnect_session')?.kind).toBe('meta')
  })

  it('llui_connect_session validates url and token are required strings', () => {
    const t = findDesc('llui_connect_session')!
    expect(t.schema.safeParse({ url: 'http://x', token: 'abc' }).success).toBe(true)
    expect(t.schema.safeParse({ url: 'http://x' }).success).toBe(false)
    expect(t.schema.safeParse({ url: 123, token: 'abc' }).success).toBe(false)
  })
})
