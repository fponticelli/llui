import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import type { ConnectOptions } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

type Route =
  | { page: 'home' }
  | { page: 'admin' }
  | { page: 'login' }
  | { page: 'article'; slug: string }

function makeRouter() {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['admin'], () => ({ page: 'admin' })),
      route(['login'], () => ({ page: 'login' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
    ],
    { mode: 'history' },
  )
}

/** Mount a component that renders one link; return the anchor + dispose. */
function mountLink(
  options: ConnectOptions<Route> | undefined,
  send: (msg: unknown) => void,
  route: Route,
  attrs: Record<string, unknown> = {},
) {
  const routing = connectRouter(makeRouter(), options)
  const container = document.createElement('div')
  const App = component({
    name: 'T',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [routing.link(send, route, attrs, [text('go')])],
  })
  const handle = mountApp(container, App)
  const anchor = container.querySelector('a')!
  return { anchor, handle, routing }
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  anchor.dispatchEvent(ev)
  return ev
}

describe('link() runs the guard pipeline in history mode (finding 1)', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('a beforeEnter guard that blocks stops the link navigation (no pushState, no send)', () => {
    const send = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const { anchor, handle } = mountLink({ beforeEnter: () => false }, send, { page: 'admin' })

    const ev = click(anchor)

    expect(ev.defaultPrevented).toBe(true) // still intercepts
    expect(pushSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    pushSpy.mockRestore()
    handle.dispose()
  })

  it('a beforeEnter redirect rewrites the link navigation URL + message', () => {
    const send = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const { anchor, handle } = mountLink(
      { beforeEnter: (to) => (to.page === 'admin' ? { page: 'login' } : undefined) },
      send,
      { page: 'admin' },
    )

    click(anchor)

    expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/login')
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'login' } })

    pushSpy.mockRestore()
    handle.dispose()
  })

  it('an allowed link navigation pushes + dispatches the target', () => {
    const send = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const { anchor, handle } = mountLink(undefined, send, { page: 'article', slug: 'x' })

    click(anchor)

    expect(pushSpy).toHaveBeenCalledWith(expect.any(Object), '', '/article/x')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      route: { page: 'article', slug: 'x' },
    })

    pushSpy.mockRestore()
    handle.dispose()
  })

  it('link() updates currentRoute so a later beforeLeave sees the correct `from`', () => {
    const seen: Array<[Route, Route]> = []
    const beforeLeave = vi.fn((from: Route, to: Route) => {
      seen.push([from, to])
      return true
    })
    const routing = connectRouter(makeRouter(), { beforeLeave })
    const container = document.createElement('div')
    const send = vi.fn()
    const App = component({
      name: 'T',
      init: (): [null, never[]] => [null, []],
      update: (s: null): [null, never[]] => [s, []],
      view: () => [
        routing.link(send, { page: 'admin' }, { id: 'a' }, [text('a')]),
        routing.link(send, { page: 'article', slug: 'z' }, { id: 'b' }, [text('b')]),
      ],
    })
    const handle = mountApp(container, App)

    click(container.querySelector('#a') as HTMLAnchorElement) // home -> admin
    click(container.querySelector('#b') as HTMLAnchorElement) // admin -> article

    // Second beforeLeave must see `from` = admin (link updated currentRoute),
    // NOT the stale seeded home.
    expect(seen[1]![0]).toEqual({ page: 'admin' })
    expect(seen[1]![1]).toEqual({ page: 'article', slug: 'z' })

    handle.dispose()
  })

  it('bails when the anchor target is not self', () => {
    const send = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const { anchor, handle } = mountLink(undefined, send, { page: 'admin' }, { target: '_blank' })

    const ev = click(anchor)

    // Non-self target → let the browser handle it: no preventDefault, no nav.
    expect(ev.defaultPrevented).toBe(false)
    expect(pushSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    pushSpy.mockRestore()
    handle.dispose()
  })

  it('bails when a prior handler already called preventDefault', () => {
    const send = vi.fn()
    const routing = connectRouter(makeRouter())
    const container = document.createElement('div')
    const App = component({
      name: 'T',
      init: (): [null, never[]] => [null, []],
      update: (s: null): [null, never[]] => [s, []],
      view: () => [routing.link(send, { page: 'admin' }, {}, [text('go')])],
    })
    const handle = mountApp(container, App)
    const anchor = container.querySelector('a')!
    // Register a capture-phase listener that preempts the link.
    anchor.addEventListener('click', (e) => e.preventDefault(), { capture: true })
    const pushSpy = vi.spyOn(history, 'pushState')

    click(anchor)

    expect(pushSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    pushSpy.mockRestore()
    handle.dispose()
  })
})
