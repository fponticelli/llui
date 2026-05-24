import { describe, expect, it } from 'vitest'
import { createEventBus } from '../src/notes/event-bus.js'
import type { ServerEvent } from '../src/notes/types.js'

describe('createEventBus', () => {
  it('delivers events to matching subscribers', () => {
    const bus = createEventBus()
    const received: ServerEvent[] = []
    bus.subscribe('hud', (e) => received.push(e))
    bus.broadcast({ type: 'note-created', id: '001', filename: 'x.md', author: 'human' })
    expect(received).toHaveLength(1)
  })

  it('only routes capture-request events to hud subscribers', () => {
    const bus = createEventBus()
    const hud: ServerEvent[] = []
    const mcp: ServerEvent[] = []
    const viewer: ServerEvent[] = []
    bus.subscribe('hud', (e) => hud.push(e))
    bus.subscribe('mcp', (e) => mcp.push(e))
    bus.subscribe('viewer', (e) => viewer.push(e))
    bus.broadcast({ type: 'capture-request', requestId: 'r1', payload: {} })
    expect(hud).toHaveLength(1)
    expect(mcp).toHaveLength(0)
    expect(viewer).toHaveLength(0)
  })

  it('delivers note-created and session-rotated to all roles', () => {
    const bus = createEventBus()
    const hud: ServerEvent[] = []
    const mcp: ServerEvent[] = []
    const viewer: ServerEvent[] = []
    bus.subscribe('hud', (e) => hud.push(e))
    bus.subscribe('mcp', (e) => mcp.push(e))
    bus.subscribe('viewer', (e) => viewer.push(e))
    bus.broadcast({ type: 'note-created', id: '001', filename: 'a.md', author: 'human' })
    bus.broadcast({ type: 'session-rotated', sessionId: 'session-x' })
    expect(hud).toHaveLength(2)
    expect(mcp).toHaveLength(2)
    expect(viewer).toHaveLength(2)
  })

  it('unsubscribe stops further delivery', () => {
    const bus = createEventBus()
    const received: ServerEvent[] = []
    const unsub = bus.subscribe('hud', (e) => received.push(e))
    unsub()
    bus.broadcast({ type: 'note-created', id: '001', filename: 'x.md', author: 'human' })
    expect(received).toHaveLength(0)
  })

  it('countByRole returns subscriber count', () => {
    const bus = createEventBus()
    expect(bus.countByRole('hud')).toBe(0)
    const u1 = bus.subscribe('hud', () => {})
    bus.subscribe('hud', () => {})
    bus.subscribe('mcp', () => {})
    expect(bus.countByRole('hud')).toBe(2)
    expect(bus.countByRole('mcp')).toBe(1)
    u1()
    expect(bus.countByRole('hud')).toBe(1)
  })

  it('isolates a thrown subscriber from breaking the others', () => {
    const bus = createEventBus()
    const received: ServerEvent[] = []
    bus.subscribe('hud', () => {
      throw new Error('boom')
    })
    bus.subscribe('hud', (e) => received.push(e))
    expect(() =>
      bus.broadcast({ type: 'note-created', id: '001', filename: 'x.md', author: 'human' }),
    ).not.toThrow()
    expect(received).toHaveLength(1)
  })
})
