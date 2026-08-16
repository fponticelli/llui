import { component, mountApp, text } from '@llui/dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter, type ConnectOptions, type RouterEffect } from '../src/connect'
import { createRouter, route } from '../src/index'

const registry = {
  home: route('/'),
  admin: route('/admin'),
  article: route('/article/:slug'),
}
type Registry = typeof registry

const makeRouter = (mode: 'hash' | 'history' = 'hash') => createRouter(registry, { mode })
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

function mountLink(
  routing: ReturnType<typeof connectRouter<Registry>>,
  send: (message: unknown) => void,
  destination: ['home' | 'admin'] | ['article', { slug: string }],
) {
  const container = document.createElement('div')
  const App = component({
    name: 'HashLinkSemanticsHost',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [
      destination[0] === 'article'
        ? routing.link(send, 'article', destination[1], {}, [text('go')])
        : routing.link(send, destination[0], {}, [text('go')]),
    ],
  })
  const handle = mountApp(container, App)
  return { anchor: container.querySelector('a')!, dispose: () => handle.dispose() }
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  anchor.dispatchEvent(event)
  return event
}

function run(
  routing: ReturnType<typeof connectRouter<Registry>>,
  effect: RouterEffect,
  send = vi.fn(),
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
  return send
}

describe('#110 hash link semantics', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    location.hash = ''
    await settle()
  })

  it('makes a click on the current canonical location a full no-op', async () => {
    location.hash = '#/admin'
    await settle()
    const beforeEnter = vi.fn()
    const routing = connectRouter(makeRouter(), { beforeEnter })
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, ['admin'])

    const event = click(anchor)

    expect(event.defaultPrevented).toBe(true)
    expect(beforeEnter).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/admin')
    dispose()
  })

  it('writes and dispatches without a listener mounted', () => {
    const routing = connectRouter(makeRouter())
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, ['article', { slug: 'x' }])

    click(anchor)

    expect(location.hash).toBe('#/article/x')
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'x' } },
    })
    dispose()
  })

  it('runs guards at click time and leaves no junk entry when blocked', () => {
    const options: ConnectOptions<Registry> = {
      beforeEnter: (to) => to.name !== 'admin' && undefined,
    }
    const routing = connectRouter(makeRouter(), options)
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, ['admin'])
    const hashBefore = location.hash
    const lengthBefore = history.length

    click(anchor)

    expect(send).not.toHaveBeenCalled()
    expect(location.hash).toBe(hashBefore)
    expect(history.length).toBe(lengthBefore)
    dispose()
  })

  it('dispatches the normalized redirect target at click time', () => {
    const router = makeRouter()
    const routing = connectRouter(router, {
      beforeEnter: (to) => (to.name === 'admin' ? router.location('home') : undefined),
    })
    const send = vi.fn()
    const { anchor, dispose } = mountLink(routing, send, ['admin'])

    click(anchor)

    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'home', params: {} },
    })
    expect(location.hash === '' || location.hash === '#/').toBe(true)
    dispose()
  })
})

describe('#110 guard redirects on push and replace', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    location.hash = ''
    await settle()
  })

  it('push keeps the URL and dispatched redirect location in agreement', () => {
    const router = makeRouter('history')
    const routing = connectRouter(router, {
      beforeEnter: (to) =>
        to.name === 'admin' ? router.location('article', { slug: 'x' }) : undefined,
    })
    const send = run(routing, routing.push('admin'))

    expect(location.pathname).toBe('/article/x')
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'x' } },
    })
  })

  it('replace keeps the URL and dispatched redirect location in agreement', () => {
    const router = makeRouter('history')
    const routing = connectRouter(router, {
      beforeEnter: (to) =>
        to.name === 'admin' ? router.location('article', { slug: 'y' }) : undefined,
    })
    const send = run(routing, routing.replace('admin'))

    expect(location.pathname).toBe('/article/y')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'y' } },
    })
  })

  it('keeps push and replace URL-only when no guard redirects', () => {
    const routing = connectRouter(makeRouter('history'))
    const send = vi.fn()

    run(routing, routing.push('admin'), send)
    run(routing, routing.replace('article', { slug: 'z' }), send)

    expect(send).not.toHaveBeenCalled()
  })

  it('stays silent and leaves the URL unchanged when a guard blocks', () => {
    const routing = connectRouter(makeRouter('history'), { beforeEnter: () => false })
    const send = run(routing, routing.push('admin'))

    expect(send).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/')
  })

  it('redirects and dispatches in hash mode', () => {
    const router = makeRouter()
    const routing = connectRouter(router, {
      beforeEnter: (to) =>
        to.name === 'admin' ? router.location('article', { slug: 'q' }) : undefined,
    })
    const send = run(routing, routing.push('admin'))

    expect(location.hash).toBe('#/article/q')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'q' } },
    })
  })
})
