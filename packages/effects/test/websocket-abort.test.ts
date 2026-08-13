// @vitest-environment jsdom
//
// A websocket registers one `'abort'` listener for the LIFETIME of one socket.
// `{ once: true }` unregisters it only when it FIRES — so every path that
// retires a socket WITHOUT aborting the scope used to leave its listener behind,
// each one retaining a closed `WebSocket` (issue #83):
//
//  1. REPLACEMENT. `websocket('feed', …)` on a key that already has a socket
//     closes the old one and overwrites the slot. The old socket's listener
//     never fires, so a reconnect loop accumulates one per attempt — measured at
//     `added=51 removed=0` over 50 dispatches.
//  2. NATURAL CLOSE. `onclose` dropped the registry slot but not the listener.
//  3. `cancel(key)`. Same shape, through `cancel.ts`.
//
// No timer is involved, so `@llui/test`'s mount-mode leak sweep cannot see any
// of it — the same blind spot that hid the `upload.ts` leak fixed in #77. These
// tests ARE the gate.
//
// The fix is the entry-object treatment #77 gave `Registry.debounces`: a
// `WebSocketEntry` whose `close()` is ONE idempotent retirement (silence the
// socket, close it, hand back the listener, drop the slot) that every path
// runs. The extra constraint here is that the entry must keep EXPOSING the
// socket, because `ws-send` writes through it — hence `{ socket, close }`
// rather than debounce's bare `{ cancel }`.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createDispatch, type Deps, type InternalSend, type Registry } from '../src/core'
import { websocketRunner, wsSendRunner } from '../src/runners/websocket'
import { cancelRunner } from '../src/runners/cancel'
import { cancel, websocket, wsSend } from '../src/index'
import { trackAbortListeners } from './helpers/track-abort-listeners'

/**
 * Every socket the runner opened during one test, newest last. Populated by the
 * fake's constructor so a test can reach a socket with its REAL type — reading
 * it back out of the registry would only ever be typed as the DOM `WebSocket`.
 */
let sockets: FakeWebSocket[] = []

/**
 * The smallest socket the runner actually uses: the four `on*` slots, `send`,
 * `close`, `readyState` and the `OPEN` constant it compares against. Driving the
 * lifecycle by hand (`simulateOpen`/`simulateClose`) is the point — a real
 * socket's timing is not observable in a unit test.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState: number = FakeWebSocket.CONNECTING
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  /** Payloads written through `ws-send`, in order. */
  readonly sent: string[] = []
  /** How many times `close()` was called — a retirement must be idempotent. */
  closeCalls = 0

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    sockets.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls++
    this.readyState = FakeWebSocket.CLOSED
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** The socket dies on its own — the server hung up, the network dropped. */
  simulateClose(code = 1006, reason = 'gone'): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code, reason }))
  }
}

/** The nth socket the runner opened. Throws rather than returning `undefined`, so
 * a case that never opened the socket it asserts on fails as a missing socket
 * instead of as a confusing property access. */
function socketAt(index: number): FakeWebSocket {
  const socket = sockets[index]
  if (!socket) throw new Error(`no socket #${index} — the runner opened ${sockets.length}`)
  return socket
}

/**
 * A dispatch over just the runners these tests need, with the per-mount registry
 * held OPEN so the assertions can read it. Deliberately NOT `handleEffects()`:
 * that chain owns a registry-wide teardown listener of its own, which would mask
 * whether the websocket runner cleans up after itself.
 */
function makeDeps(): { deps: Deps; registry: Registry } {
  const registry: Registry = {
    cancelControllers: new Map(),
    debounces: new Map(),
    websockets: new Map(),
  }
  const deps: Deps = {
    registry,
    custom: () => {},
    plugins: [],
    dispatch: createDispatch([websocketRunner, wsSendRunner, cancelRunner]),
  }
  return { deps, registry }
}

type FeedMsg =
  | { type: 'opened' }
  | { type: 'message'; data: unknown }
  | { type: 'closed'; code: number; reason: string }
  | { type: 'errored' }

function feed(url = 'wss://example.test/feed') {
  return websocket<FeedMsg>({
    url,
    key: 'feed',
    onOpen: () => ({ type: 'opened' }),
    onMessage: (data) => ({ type: 'message', data }),
    onClose: (code, reason) => ({ type: 'closed', code, reason }),
    onError: () => ({ type: 'errored' }),
  })
}

describe('websocket() abort cleanup', () => {
  let send: Mock<InternalSend>
  let controller: AbortController

  beforeEach(() => {
    sockets = []
    send = vi.fn<InternalSend>()
    controller = new AbortController()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('replacing a socket on the same key hands back the previous socket’s listener', () => {
    const { deps, registry } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    deps.dispatch(feed('wss://example.test/a'), send, controller.signal, deps)
    deps.dispatch(feed('wss://example.test/b'), send, controller.signal, deps)

    expect(sockets).toHaveLength(2)
    expect(socketAt(0).closeCalls).toBe(1)
    // Registering nothing would satisfy `added == removed` vacuously.
    expect(listeners.added).toHaveLength(2)
    // Exactly the SUPERSEDED socket's listener went back — the live one stays.
    expect(listeners.removed).toEqual([listeners.added[0]])
    expect(registry.websockets.get('feed')?.socket).toBe(socketAt(1))
  })

  it('a superseded socket dispatches no app onClose and does not evict its replacement', () => {
    const { deps, registry } = makeDeps()
    deps.dispatch(feed('wss://example.test/a'), send, controller.signal, deps)
    deps.dispatch(feed('wss://example.test/b'), send, controller.signal, deps)

    // The old socket's close lands asynchronously in a real browser; it must be
    // silent by then (the replacement-race bug) even though it is still closing.
    socketAt(0).simulateClose()

    expect(send).not.toHaveBeenCalled()
    expect(registry.websockets.get('feed')?.socket).toBe(socketAt(1))
  })

  it('a socket closing naturally removes its abort listener and drops the slot', () => {
    const { deps, registry } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    deps.dispatch(feed(), send, controller.signal, deps)
    expect(listeners.added).toHaveLength(1)

    socketAt(0).simulateClose(1011, 'server error')

    expect(listeners.removed).toEqual(listeners.added)
    expect(registry.websockets.has('feed')).toBe(false)
    // The app still hears about it — the teardown must not swallow `onClose`.
    expect(send).toHaveBeenCalledWith({ type: 'closed', code: 1011, reason: 'server error' })
  })

  it('aborting the component signal closes the socket and removes the listener', () => {
    const { deps, registry } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    deps.dispatch(feed(), send, controller.signal, deps)
    controller.abort()

    expect(socketAt(0).closeCalls).toBe(1)
    expect(registry.websockets.has('feed')).toBe(false)
    expect(listeners.added).toHaveLength(1)
    expect(listeners.removed).toEqual(listeners.added)
    // Unmount — no spurious app `onClose`.
    expect(send).not.toHaveBeenCalled()
  })

  it('cancel(key) closes the socket and removes its listener', () => {
    const { deps, registry } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    deps.dispatch(feed(), send, controller.signal, deps)
    deps.dispatch(cancel('feed'), send, controller.signal, deps)

    expect(socketAt(0).closeCalls).toBe(1)
    expect(registry.websockets.has('feed')).toBe(false)
    expect(listeners.removed).toEqual(listeners.added)
    expect(send).not.toHaveBeenCalled()
  })

  it('a long-lived component does not accumulate one abort listener per socket', () => {
    // Bounded as N GROWS — not merely small. A per-socket leak makes the live
    // count track `dispatches`, so measuring at two very different N and
    // comparing is what distinguishes "released" from "few so far".
    const reconnect = (dispatches: number): { added: number; live: number } => {
      const scope = new AbortController()
      const { deps } = makeDeps()
      const listeners = trackAbortListeners(scope.signal)
      for (let i = 0; i < dispatches; i++) {
        deps.dispatch(feed(`wss://example.test/${i}`), send, scope.signal, deps)
      }
      return {
        added: listeners.added.length,
        live: listeners.added.length - listeners.removed.length,
      }
    }

    const few = reconnect(5)
    const many = reconnect(50)

    // Not vacuous: every dispatch really did register a listener.
    expect(few.added).toBe(5)
    expect(many.added).toBe(50)
    // Only the ONE live socket still holds a listener, at either scale.
    expect(many.live).toBe(few.live)
    expect(many.live).toBe(1)
  })

  it('a closed socket leaves nothing live at all', () => {
    const { deps } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    for (let i = 0; i < 20; i++) {
      deps.dispatch(feed(`wss://example.test/${i}`), send, controller.signal, deps)
      socketAt(i).simulateClose()
    }

    expect(listeners.added).toHaveLength(20)
    expect(listeners.removed).toEqual(listeners.added)
  })
})

describe('ws-send through the registry entry', () => {
  let send: Mock<InternalSend>
  let controller: AbortController

  beforeEach(() => {
    sockets = []
    send = vi.fn<InternalSend>()
    controller = new AbortController()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('writes to the live socket once it is OPEN', () => {
    const { deps } = makeDeps()
    deps.dispatch(feed(), send, controller.signal, deps)
    socketAt(0).simulateOpen()

    deps.dispatch(wsSend('feed', { hello: 'world' }), send, controller.signal, deps)
    deps.dispatch(wsSend('feed', 'raw'), send, controller.signal, deps)

    expect(socketAt(0).sent).toEqual(['{"hello":"world"}', 'raw'])
  })

  it('drops a write to a socket that is not OPEN, and to a retired key', () => {
    const { deps } = makeDeps()
    deps.dispatch(feed(), send, controller.signal, deps)

    // Still CONNECTING.
    deps.dispatch(wsSend('feed', 'early'), send, controller.signal, deps)
    expect(socketAt(0).sent).toEqual([])

    socketAt(0).simulateOpen()
    controller.abort()
    deps.dispatch(wsSend('feed', 'late'), send, controller.signal, deps)
    expect(socketAt(0).sent).toEqual([])
  })

  it('follows the key to a REPLACEMENT socket', () => {
    const { deps } = makeDeps()
    deps.dispatch(feed('wss://example.test/a'), send, controller.signal, deps)
    deps.dispatch(feed('wss://example.test/b'), send, controller.signal, deps)
    socketAt(1).simulateOpen()

    deps.dispatch(wsSend('feed', 'after-reconnect'), send, controller.signal, deps)

    expect(socketAt(0).sent).toEqual([])
    expect(socketAt(1).sent).toEqual(['after-reconnect'])
  })
})
