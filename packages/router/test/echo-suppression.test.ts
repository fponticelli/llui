import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #108 — hashchange events QUEUE, so one boolean cannot suppress two
// echoes. A batch of navigations (which `batch()` makes an explicitly supported
// pattern in this framework) left the extra echoes to dispatch a DUPLICATE
// send: the reducer runs twice and its effects fire twice, which for a
// non-idempotent reducer is a real bug, not a wasted render.

const registry = {
  home: route('/'),
  admin: route('/admin'),
  article: route('/article/:slug'),
}
type Registry = typeof registry

const hashRouter = () => createRouter(registry)

const settle = () => new Promise((r) => setTimeout(r, 10))

/** Mount a listener that dispatches through the SAME send the effects use. */
function mountListener(
  routing: ReturnType<typeof connectRouter<Registry>>,
  send: (msg: unknown) => void,
) {
  const container = document.createElement('div')
  const App = component({
    name: 'L',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  return () => handle.dispose()
}

function run(
  routing: ReturnType<typeof connectRouter<Registry>>,
  effect: ReturnType<ReturnType<typeof connectRouter<Registry>>['push']>,
  send: (msg: unknown) => void,
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
}

describe('#108 batched hash navigations dispatch exactly once each', () => {
  beforeEach(async () => {
    location.hash = ''
    await settle()
  })

  it('two navigate() effects in one tick produce one dispatch per navigation', async () => {
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const dispose = mountListener(routing, send)

    run(routing, routing.navigate('article', { slug: 'one' }), send)
    run(routing, routing.navigate('article', { slug: 'two' }), send)
    await settle()

    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'navigate', location: { name: 'article', params: { slug: 'one' } } },
      { type: 'navigate', location: { name: 'article', params: { slug: 'two' } } },
    ])

    dispose()
  })

  it('push() + navigate() in one tick produce exactly one dispatch', async () => {
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const dispose = mountListener(routing, send)

    run(routing, routing.push('admin'), send)
    run(routing, routing.navigate('article', { slug: 'x' }), send)
    await settle()

    // push() is URL-only; navigate() dispatches once. Neither echo may add one.
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'x' } },
    })

    dispose()
  })

  it('three navigations in one tick still dispatch once each', async () => {
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const dispose = mountListener(routing, send)

    run(routing, routing.navigate('admin'), send)
    run(routing, routing.push('home'), send)
    run(routing, routing.navigate('article', { slug: 'z' }), send)
    await settle()

    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'navigate', location: { name: 'admin', params: {} } },
      { type: 'navigate', location: { name: 'article', params: { slug: 'z' } } },
    ])

    dispose()
  })

  it('survives a long run of navigations with no listener mounted', async () => {
    // #110.2 made a mounted `listener()` optional, so a hash app can navigate
    // for its whole lifetime with nothing subscribed and no echo will ever be
    // consumed. The suppression is a COUNT plus the newest hash — never a queue
    // that grows one entry per navigation — and the arming of 200 unconsumed
    // echoes must not change what a later listener sees.
    const routing = connectRouter(hashRouter())
    const send = vi.fn()

    for (let i = 0; i < 200; i++) {
      run(routing, routing.navigate('article', { slug: String(i) }), send)
    }
    await settle()
    expect(send).toHaveBeenCalledTimes(200) // one per navigation, none from an echo

    const dispose = mountListener(routing, send)
    send.mockClear()
    location.hash = '#/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'admin', params: {} },
    })

    dispose()
  })

  it('a genuine hashchange arriving while suppression is armed still dispatches', async () => {
    const routing = connectRouter(hashRouter())
    const send = vi.fn()
    const dispose = mountListener(routing, send)

    // Arm a suppression, then let a change we did NOT make land first. The URL
    // is no longer where our write left it, so the armed echo is stale and must
    // not swallow a real user navigation.
    run(routing, routing.navigate('admin'), send)
    send.mockClear()
    location.hash = '#/article/y'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'y' } },
    })

    dispose()
  })
})
