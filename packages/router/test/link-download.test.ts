import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #109 — `download` means the href is a FILE the browser must save, not
// a route. Intercepting the click cancelled the download and navigated
// instead; the file never arrived.

type Route = { page: 'home' } | { page: 'admin' }

const makeRouter = () =>
  createRouter<Route>(
    [route([], () => ({ page: 'home' })), route(['admin'], () => ({ page: 'admin' }))],
    { mode: 'history' },
  )

function mountLink(send: (msg: unknown) => void, attrs: Record<string, unknown>) {
  const routing = connectRouter(makeRouter())
  const container = document.createElement('div')
  const App = component({
    name: 'T',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [routing.link(send, { page: 'admin' }, attrs, [text('go')])],
  })
  const handle = mountApp(container, App)
  return { anchor: container.querySelector('a')!, dispose: () => handle.dispose() }
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  anchor.dispatchEvent(ev)
  return ev
}

describe('#109 link() does not intercept a download anchor', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('lets the download proceed — no preventDefault, no navigation', () => {
    const send = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const { anchor, dispose } = mountLink(send, { download: 'file.txt' })

    // The attribute must actually reach the DOM, or the check is untested.
    expect(anchor.hasAttribute('download')).toBe(true)

    const ev = click(anchor)

    expect(ev.defaultPrevented).toBe(false)
    expect(pushSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    pushSpy.mockRestore()
    dispose()
  })

  it('honours a valueless download attribute', () => {
    const send = vi.fn()
    const { anchor, dispose } = mountLink(send, { download: '' })

    expect(anchor.hasAttribute('download')).toBe(true)
    expect(click(anchor).defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('still intercepts an ordinary link (positive control)', () => {
    const send = vi.fn()
    const { anchor, dispose } = mountLink(send, {})

    expect(click(anchor).defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'admin' } })

    dispose()
  })
})
