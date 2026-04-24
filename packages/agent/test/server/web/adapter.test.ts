import { describe, it, expect, vi } from 'vitest'
import { createWHATWGPairingConnection } from '../../../src/server/web/adapter.js'
import type { ClientFrame, ServerFrame } from '../../../src/protocol.js'

/**
 * Minimal stand-in for the standards WebSocket interface — just
 * `send`, `close`, and `addEventListener` for message/close events.
 * We don't pull in `ws` here because the web adapter explicitly
 * targets the WHATWG shape, not the node-`ws` EventEmitter shape.
 */
function makeFakeWhatwgSocket(): {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  __emit(type: 'message' | 'close', data?: unknown): void
} {
  const listeners = new Map<string, Array<(e: { data?: unknown }) => void>>()
  return {
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((type: string, cb: (e: { data?: unknown }) => void) => {
      const arr = listeners.get(type) ?? []
      arr.push(cb)
      listeners.set(type, arr)
    }),
    __emit(type: 'message' | 'close', data?: unknown) {
      const arr = listeners.get(type) ?? []
      for (const cb of arr) cb({ data })
    },
  }
}

describe('createWHATWGPairingConnection', () => {
  it('send() serializes the frame as JSON on the socket', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    const frame: ServerFrame = { t: 'active' }
    conn.send(frame)
    expect(sock.send).toHaveBeenCalledWith(JSON.stringify(frame))
  })

  it('onFrame() parses string messages and delivers them', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))

    sock.__emit('message', JSON.stringify({ t: 'hello', appName: 'x' }))
    expect(received).toHaveLength(1)
    expect(received[0]?.t).toBe('hello')
  })

  it('onFrame() ignores malformed JSON without throwing', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))

    expect(() => sock.__emit('message', 'not json')).not.toThrow()
    expect(received).toHaveLength(0)
  })

  it('onClose() fires on the socket close event', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    const closed = vi.fn()
    conn.onClose(closed)
    sock.__emit('close')
    expect(closed).toHaveBeenCalledOnce()
  })

  it('close() delegates to the socket', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    conn.close()
    expect(sock.close).toHaveBeenCalled()
  })

  it('close() swallows errors from double-close', () => {
    const sock = makeFakeWhatwgSocket()
    sock.close.mockImplementationOnce(() => {
      throw new Error('already closed')
    })
    const conn = createWHATWGPairingConnection(sock as unknown as WebSocket)
    expect(() => conn.close()).not.toThrow()
  })
})
