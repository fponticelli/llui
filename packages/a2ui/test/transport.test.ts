import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  connectA2ui,
  webSocketTransport,
  type A2uiHandle,
  type WebSocketLike,
} from '../src/index.js'

const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

class MockSocket implements WebSocketLike {
  readonly sent: string[] = []
  private readonly listeners = new Set<(event: { data: unknown }) => void>()
  send(data: string): void {
    this.sent.push(data)
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener)
  }
  /** Simulate an inbound frame. */
  receive(data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    for (const listener of this.listeners) listener({ data: payload })
  }
  get listenerCount(): number {
    return this.listeners.size
  }
}

let container: HTMLElement
let handle: A2uiHandle
let socket: MockSocket

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  socket = new MockSocket()
})
afterEach(() => {
  handle?.dispose()
  container.remove()
})

describe('WebSocket transport', () => {
  it('renders inbound envelope frames and sends actions outbound', () => {
    handle = connectA2ui(container, webSocketTransport(socket))

    socket.receive([
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'go' } } },
            { id: 'l', component: 'Text', text: 'Go' },
          ],
        },
      },
    ])
    expect(container.querySelector('.a2ui-button')?.textContent).toBe('Go')

    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(socket.sent).toHaveLength(1)
    const frame = JSON.parse(socket.sent[0]!) as { action: { name: string } }
    expect(frame.action.name).toBe('go')
  })

  it('accepts a single-envelope frame (not just arrays)', () => {
    handle = connectA2ui(container, webSocketTransport(socket))
    socket.receive({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } })
    socket.receive({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'root', component: 'Text', text: 'hi' }],
      },
    })
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('hi')
  })

  it('delivers a multi-envelope array frame as a single batched apply (fix 3)', () => {
    handle = connectA2ui(container, webSocketTransport(socket))
    let notifications = 0
    handle.subscribe(() => {
      notifications++
    })
    const baseline = notifications
    socket.receive([
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: 'batched' }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: {} } },
    ])
    // The whole 3-envelope frame collapses into ONE reconcile (not three).
    expect(notifications - baseline).toBe(1)
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('batched')
  })

  it('unsubscribes from the socket on dispose', () => {
    handle = connectA2ui(container, webSocketTransport(socket))
    expect(socket.listenerCount).toBe(1)
    handle.dispose()
    expect(socket.listenerCount).toBe(0)
  })

  it('ignores malformed frames without throwing', () => {
    handle = connectA2ui(container, webSocketTransport(socket))
    expect(() => socket.receive('{not json')).not.toThrow()
  })

  it('reports malformed and non-envelope frames via onError instead of dropping silently', () => {
    const errors: Array<{ message: string; raw: unknown }> = []
    handle = connectA2ui(
      container,
      webSocketTransport(socket, {
        onError: (error, raw) => errors.push({ message: error.message, raw }),
      }),
    )

    socket.receive('{not json') // unparseable JSON
    socket.receive(42) // parses, but not an envelope object

    expect(errors).toHaveLength(2)
    expect(errors[0]!.message).toMatch(/JSON|token|Unexpected/i)
    expect(errors[1]!.message).toMatch(/envelope/i)
    expect(errors[1]!.raw).toBe(42)
  })
})
