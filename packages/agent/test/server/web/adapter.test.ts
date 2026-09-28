import { describe, it, expect, vi } from 'vitest'
import {
  createWHATWGPairingConnection,
  type WhatwgSocket,
} from '../../../src/server/web/adapter.js'
import type { ClientFrame, HelloFrame, ServerFrame } from '../../../src/protocol.js'

/**
 * Minimal stand-in for the standards WebSocket interface — the
 * `WhatwgSocket` slice the adapter uses: `send`, `close`, and
 * `addEventListener` for message/close/open. We don't pull in `ws` here
 * because the web adapter explicitly targets the WHATWG shape, not the
 * node-`ws` EventEmitter shape.
 */
interface FakeWhatwgSocket extends WhatwgSocket {
  readonly sent: string[]
  closeCalls: number
  closeThrows: boolean
  emit(type: 'message' | 'close', data?: unknown): void
}

function makeFakeWhatwgSocket(): FakeWhatwgSocket {
  const listeners = new Map<string, Array<(ev: { readonly data: unknown }) => void>>()
  const sock: FakeWhatwgSocket = {
    sent: [],
    closeCalls: 0,
    closeThrows: false,
    send(data: string) {
      sock.sent.push(data)
    },
    close() {
      sock.closeCalls++
      if (sock.closeThrows) throw new Error('already closed')
    },
    addEventListener(type: string, listener: (ev: { readonly data: unknown }) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    emit(type, data) {
      for (const cb of listeners.get(type) ?? []) cb({ data })
    },
  }
  return sock
}

const hello = (appName = 'x'): HelloFrame => ({
  t: 'hello',
  appName,
  appVersion: '0.0.0',
  msgSchema: {},
  stateSchema: {},
  affordancesSample: [],
  docs: null,
  schemaHash: 'h',
})

describe('createWHATWGPairingConnection', () => {
  it('send() serializes the frame as JSON on the socket', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    const frame: ServerFrame = { t: 'active' }
    conn.send(frame)
    expect(sock.sent).toEqual([JSON.stringify(frame)])
  })

  it('onFrame() parses string messages and delivers them', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))

    sock.emit('message', JSON.stringify(hello()))
    expect(received).toHaveLength(1)
    expect(received[0]?.t).toBe('hello')
  })

  it('onFrame() decodes binary (ArrayBuffer and byte-view) messages', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))
    const bytes = new TextEncoder().encode(JSON.stringify(hello('bin')))
    // A buffer from THIS realm's `ArrayBuffer` (jsdom's `TextEncoder` returns a
    // view over a Node-realm buffer, which no runtime the adapter targets has).
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    sock.emit('message', bytes)
    sock.emit('message', buffer)
    expect(received.map((f) => f.t)).toEqual(['hello', 'hello'])
  })

  it('onFrame() ignores malformed JSON without throwing', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))

    expect(() => sock.emit('message', 'not json')).not.toThrow()
    expect(received).toHaveLength(0)
  })

  it('onFrame() DROPS well-formed JSON that is not a valid LAP ClientFrame', () => {
    // The Node adapter validates every inbound frame against the zod schema;
    // the web adapter used to `JSON.parse(raw) as ClientFrame` and dispatch
    // whatever arrived — a hostile frame with wrong-typed correlation fields.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const sock = makeFakeWhatwgSocket()
      const conn = createWHATWGPairingConnection(sock)
      const received: ClientFrame[] = []
      conn.onFrame((f) => received.push(f))

      const invalid = [
        { t: 'hello', appName: 'x' }, // hello missing required fields
        { t: 'rpc-reply', id: 42, result: null }, // wrong-typed correlation id
        { t: 'confirm-resolved', confirmId: 'c', outcome: 'maybe', stateAfter: null },
        { t: 'not-a-frame' },
        ['hello'],
        null,
      ]
      for (const frame of invalid) sock.emit('message', JSON.stringify(frame))
      expect(received).toEqual([])
      expect(warn).toHaveBeenCalledTimes(invalid.length)

      // The pairing survives: a valid frame after the invalid ones still arrives.
      sock.emit('message', JSON.stringify({ t: 'rpc-reply', id: 'r1', result: 1 }))
      expect(received).toEqual([{ t: 'rpc-reply', id: 'r1', result: 1 }])
    } finally {
      warn.mockRestore()
    }
  })

  it('buffers frames received BEFORE onFrame is wired and flushes them on registration', () => {
    // Regression (accept race): the browser sends hello the instant the
    // socket opens, but registration (which calls onFrame) only happens
    // after the async acceptConnection. Frames must be buffered, not lost.
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)

    // hello arrives before onFrame is registered.
    sock.emit('message', JSON.stringify(hello('early')))

    const received: ClientFrame[] = []
    conn.onFrame((f) => received.push(f))
    // The buffered hello is flushed into the handler at registration.
    expect(received).toHaveLength(1)
    expect(received[0]?.t).toBe('hello')

    // Subsequent frames deliver live.
    sock.emit(
      'message',
      JSON.stringify({ t: 'log-append', entry: { id: 'e', at: 1, kind: 'read' } }),
    )
    expect(received).toHaveLength(2)
  })

  it('onClose() fires immediately if the socket already closed before registration', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    sock.emit('close') // closed before the registry wired onClose
    const closed = vi.fn()
    conn.onClose(closed)
    expect(closed).toHaveBeenCalledOnce()
  })

  it('onClose() fires on the socket close event', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    const closed = vi.fn()
    conn.onClose(closed)
    sock.emit('close')
    expect(closed).toHaveBeenCalledOnce()
  })

  it('close() delegates to the socket', () => {
    const sock = makeFakeWhatwgSocket()
    const conn = createWHATWGPairingConnection(sock)
    conn.close()
    expect(sock.closeCalls).toBe(1)
  })

  it('close() swallows errors from double-close', () => {
    const sock = makeFakeWhatwgSocket()
    sock.closeThrows = true
    const conn = createWHATWGPairingConnection(sock)
    expect(() => conn.close()).not.toThrow()
  })
})
