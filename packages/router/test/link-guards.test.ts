import { component, mountApp, text } from '@llui/dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter, type ConnectOptions } from '../src/connect'
import { createRouter, route, type RouteLocation } from '../src/index'

const registry = {
  home: route('/'),
  admin: route('/admin'),
  login: route('/login'),
  article: route('/article/:slug'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>

function makeRouter() {
  return createRouter(registry, { mode: 'history' })
}

function mountAdminLink(options?: ConnectOptions<Registry>, attrs: Record<string, unknown> = {}) {
  const routing = connectRouter(makeRouter(), options)
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'NamedGuardedLink',
    init: () => [null, []] as const,
    update: (state: null) => [state, []] as const,
    view: () => [routing.link(send, 'admin', attrs, [text('admin')])],
  })
  const mounted = mountApp(container, App)
  return { anchor: container.querySelector('a')!, mounted, routing, send }
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  anchor.dispatchEvent(event)
  return event
}

describe('named links use the guard pipeline', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('intercepts but neither writes nor dispatches when blocked', () => {
    const push = vi.spyOn(history, 'pushState')
    const { anchor, mounted, send } = mountAdminLink({ beforeEnter: () => false })

    expect(click(anchor).defaultPrevented).toBe(true)
    expect(push).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    push.mockRestore()
    mounted.dispose()
  })

  it('settles a redirect chain before its one write and dispatch', () => {
    const router = makeRouter()
    const seen: Location[] = []
    const push = vi.spyOn(history, 'pushState')
    const { anchor, mounted, send } = mountAdminLink({
      beforeEnter: (to) => {
        seen.push(to)
        if (to.name === 'admin') return router.location('login')
        if (to.name === 'login') return router.location('article', { slug: 'settled' })
        return undefined
      },
    })

    click(anchor)

    expect(seen).toEqual([
      { name: 'admin', params: {} },
      { name: 'login', params: {} },
      { name: 'article', params: { slug: 'settled' } },
    ])
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith(expect.any(Object), '', '/article/settled')
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'article', params: { slug: 'settled' } },
    })

    push.mockRestore()
    mounted.dispose()
  })

  it('updates the current location used by the next beforeLeave', () => {
    const seen: Array<[Location, Location]> = []
    const routing = connectRouter(makeRouter(), {
      beforeLeave: (from, to) => {
        seen.push([from, to])
        return true
      },
    })
    const container = document.createElement('div')
    const App = component({
      name: 'NamedLocationTrackingLinks',
      init: () => [null, []] as const,
      update: (state: null) => [state, []] as const,
      view: () => [
        routing.link(vi.fn(), 'admin', { id: 'admin' }, [text('admin')]),
        routing.link(vi.fn(), 'article', { slug: 'next' }, { id: 'article' }, [text('article')]),
      ],
    })
    const mounted = mountApp(container, App)

    click(container.querySelector('#admin')!)
    click(container.querySelector('#article')!)

    expect(seen.at(-1)).toEqual([
      { name: 'admin', params: {} },
      { name: 'article', params: { slug: 'next' } },
    ])
    mounted.dispose()
  })

  it.each([
    ['a non-self target', { target: '_blank' }],
    ['a download', { download: '' }],
  ])('leaves %s to the browser', (_label, attrs) => {
    const push = vi.spyOn(history, 'pushState')
    const { anchor, mounted, send } = mountAdminLink(undefined, attrs)
    let routerPrevented = true
    // Cancel only after the router's listener has had its turn so jsdom does
    // not attempt a real document navigation during the test.
    anchor.addEventListener('click', (event) => {
      routerPrevented = event.defaultPrevented
      event.preventDefault()
    })

    click(anchor)
    expect(routerPrevented).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    push.mockRestore()
    mounted.dispose()
  })

  it('honors an earlier handler that already prevented the click', () => {
    const push = vi.spyOn(history, 'pushState')
    const { anchor, mounted, send } = mountAdminLink()
    anchor.addEventListener('click', (event) => event.preventDefault(), { capture: true })

    click(anchor)

    expect(push).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    push.mockRestore()
    mounted.dispose()
  })
})
