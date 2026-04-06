/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleEffects, broadcast, broadcastListen, type Effect } from '../src/index'

describe('broadcast effects', () => {
  let send: ReturnType<typeof vi.fn>
  let ctrl: AbortController
  let signal: AbortSignal

  beforeEach(() => {
    send = vi.fn()
    ctrl = new AbortController()
    signal = ctrl.signal
  })

  afterEach(() => {
    ctrl.abort()
  })

  it('broadcastListen receives messages posted via broadcast', async () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: broadcastListen('app-events', (data) => ({ type: 'received', data })),
      send,
      signal,
    })

    // Simulate an incoming message by posting via a separate channel instance
    const poster = new BroadcastChannel('app-events')
    poster.postMessage({ kind: 'hello', n: 1 })
    // BroadcastChannel delivery is microtask-async
    await new Promise((r) => setTimeout(r, 10))
    poster.close()

    expect(send).toHaveBeenCalledWith({
      type: 'received',
      data: { kind: 'hello', n: 1 },
    })
  })

  it('broadcast posts a message to the channel', async () => {
    const handler = handleEffects<Effect>().else(() => {})

    // Listen via a separate BroadcastChannel instance
    const listener = new BroadcastChannel('ping-pong')
    const received: unknown[] = []
    listener.addEventListener('message', (e) => received.push(e.data))

    handler({ effect: broadcast('ping-pong', 'hello'), send, signal })
    await new Promise((r) => setTimeout(r, 10))
    listener.close()

    expect(received).toEqual(['hello'])
  })

  it('broadcastListen stops receiving after signal abort', async () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: broadcastListen('live', (data) => ({ type: 'received', data })),
      send,
      signal,
    })

    ctrl.abort()

    const poster = new BroadcastChannel('live')
    poster.postMessage({ x: 1 })
    await new Promise((r) => setTimeout(r, 10))
    poster.close()

    expect(send).not.toHaveBeenCalled()
  })
})
