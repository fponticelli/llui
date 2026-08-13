import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import type { ConnectOptions } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #103 — a guard-blocked back must leave the history stack EXACTLY as it
// was, in both modes, and must never arm a suppression flag for a restore that
// did not happen. These tests drive real jsdom traversals (history.back /
// forward fire the real events asynchronously) and assert the whole
// back/forward trail, because the corruption is only visible in the entries the
// user can still reach — not in the URL right after the block.

type Route =
  | { page: 'home' }
  | { page: 'admin' }
  | { page: 'other' }
  | { page: 'article'; slug: string }

const defs = () => [
  route<Route>([], () => ({ page: 'home' })),
  route<Route>(['admin'], () => ({ page: 'admin' })),
  route<Route>(['other'], () => ({ page: 'other' })),
  route<Route>(['article', param('slug')], ({ slug }) => ({ page: 'article', slug: slug! })),
]

const hashRouter = () => createRouter<Route>(defs())
const historyRouter = () => createRouter<Route>(defs(), { mode: 'history' })

/** Let jsdom deliver the events queued by a synchronous URL write. */
const settle = () => new Promise((r) => setTimeout(r, 10))

/**
 * Wait for a TRAVERSAL to land. A traversal (back/forward/go) is delivered on a
 * later task than a fixed sleep can guarantee on a loaded machine, so poll for
 * the URL instead. jsdom updates the URL and fires the event in the same task,
 * so once this returns the listener has already seen it. Every call targets a
 * URL different from the current one, which is what makes the wait meaningful
 * — a blocked back is TWO traversals (the pop, then the restore) and both are
 * asserted.
 */
async function waitForUrl(read: () => string, expected: string): Promise<string> {
  const deadline = Date.now() + 2000
  while (read() !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2))
  }
  return read()
}

const path = () => location.pathname
const hash = () => location.hash

function mountListener(routing: ReturnType<typeof connectRouter<Route>>) {
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'L',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  return { send, dispose: () => handle.dispose() }
}

function navigate(routing: ReturnType<typeof connectRouter<Route>>, to: Route) {
  routing.handleEffect({
    effect: routing.navigate(to),
    send: vi.fn(),
    signal: new AbortController().signal,
  })
}

describe('#103 blocked back — history mode', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    await settle()
  })

  it('stamps an index onto the state-less entry the app loaded on', () => {
    // Without this seed a pop back onto the initial entry carries no index,
    // `currentIndex` never resyncs, and every later delta is inflated.
    expect(history.state).toBeNull()
    connectRouter(historyRouter())
    expect(history.state).toMatchObject({ __llui_idx: 0 })
  })

  it('leaves the URL on the pre-navigation route after a blocked back', async () => {
    // The issue's exact repro: load on a state-less entry, push, pop back onto
    // it (allowed — must resync the index), push again, then block the back.
    const routing = connectRouter(historyRouter(), {
      beforeLeave: (from) => from.page !== 'article',
    })
    const { dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    expect(location.pathname).toBe('/admin')

    history.back()
    expect(await waitForUrl(path, '/')).toBe('/') // allowed — leaving admin is fine

    navigate(routing, { page: 'article', slug: 'x' })
    expect(location.pathname).toBe('/article/x')

    history.back()
    expect(await waitForUrl(path, '/')).toBe('/') // the pop lands on the blocked entry
    // ...and the block must send us straight back to the route we never left.
    expect(await waitForUrl(path, '/article/x')).toBe('/article/x')

    dispose()
  })

  it('does not arm the suppression when the restore is a no-op', async () => {
    // An entry nobody stamped has no knowable position, so no delta can be
    // computed. The old code guessed 0, called history.go with an unreachable
    // delta, and left the flag armed — swallowing the user's NEXT genuine pop.
    history.replaceState({ __llui_idx: 5 }, '', '/')
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (to.page === 'article' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})

    // Blocked pop onto an entry carrying no index — nothing to restore to.
    history.replaceState(null, '', '/article/x')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(send).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()

    // A genuine pop that the guard allows must still dispatch.
    history.replaceState({ __llui_idx: 5 }, '', '/other')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 5 } }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'other' } })

    goSpy.mockRestore()
    dispose()
  })

  it('keeps history.length and the forward entries across a blocked back', async () => {
    let blockAdmin = false
    const options: ConnectOptions<Route> = {
      beforeEnter: (to) => (blockAdmin && to.page === 'admin' ? false : undefined),
    }
    const routing = connectRouter(historyRouter(), options)
    const { dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    navigate(routing, { page: 'article', slug: 'x' })
    const lengthBefore = history.length

    blockAdmin = true
    const trail: string[] = []

    history.back() // → /other (allowed)
    trail.push(await waitForUrl(path, '/other'))

    history.back() // → /admin (BLOCKED) → restored to /other
    trail.push(await waitForUrl(path, '/admin'))
    trail.push(await waitForUrl(path, '/other'))

    history.forward() // the forward entry must have survived the block
    trail.push(await waitForUrl(path, '/article/x'))

    expect(trail).toEqual(['/other', '/admin', '/other', '/article/x'])
    expect(history.length).toBe(lengthBefore)

    dispose()
  })
})

describe('#103 blocked back — hash mode', () => {
  beforeEach(async () => {
    location.hash = ''
    history.replaceState(null, '', '/')
    await settle()
  })

  it('keeps history.length and the forward entries across a blocked back', async () => {
    // `location.hash = restore` PUSHES by construction: it grew the stack on
    // every block and truncated every forward entry above the blocked one.
    let blockAdmin = false
    const options: ConnectOptions<Route> = {
      beforeEnter: (to) => (blockAdmin && to.page === 'admin' ? false : undefined),
    }
    const routing = connectRouter(hashRouter(), options)
    const { dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    navigate(routing, { page: 'article', slug: 'x' })
    expect(location.hash).toBe('#/article/x')
    const lengthBefore = history.length

    blockAdmin = true
    const trail: string[] = []

    history.back() // → #/other (allowed)
    trail.push(await waitForUrl(hash, '#/other'))

    history.back() // → #/admin (BLOCKED) → restored to #/other
    trail.push(await waitForUrl(hash, '#/admin'))
    trail.push(await waitForUrl(hash, '#/other'))

    history.forward() // #/article/x must still be reachable
    trail.push(await waitForUrl(hash, '#/article/x'))

    expect(trail).toEqual(['#/other', '#/admin', '#/other', '#/article/x'])
    expect(history.length).toBe(lengthBefore)

    dispose()
  })

  it('does not dispatch for the blocked pop or for its restore', async () => {
    let blockAdmin = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (blockAdmin && to.page === 'admin' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    await settle()
    send.mockClear()

    blockAdmin = true
    history.back() // → #/admin, blocked, restored to #/other
    expect(await waitForUrl(hash, '#/admin')).toBe('#/admin')
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    await settle() // let any dispatch the restore's echo could produce land

    expect(send).not.toHaveBeenCalled()

    dispose()
  })
})
