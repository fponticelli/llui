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

/**
 * Poll for a condition a URL comparison cannot express — notably a traversal
 * onto an entry showing the SAME url (a foreign `pushState` to `location.href`),
 * which moves `history.state` and nothing else.
 */
async function waitUntil(pred: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (!pred() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2))
  }
  if (!pred()) throw new Error(`timed out waiting for ${what}`)
}

/** The router's stamp on a history entry, or `undefined` when it never wrote one. */
function stampedIndex(state: unknown): unknown {
  return state !== null && typeof state === 'object'
    ? (state as Record<string, unknown>).__llui_idx
    : undefined
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

  it('consumes the pending restore even when the traversal lands elsewhere', async () => {
    // The arm is keyed on the index being restored TO, and is consumed
    // UNCONDITIONALLY: `history.go` is asynchronous and may land somewhere else
    // entirely (the user pressing back again while it is in flight). An arm
    // that survives a non-matching landing swallows a LATER genuine popstate —
    // the same stuck-flag failure the boolean had (#103).
    history.replaceState({ __llui_idx: 2 }, '', '/other')
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (to.page === 'article' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)
    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})

    // A blocked pop onto a stamped entry arms the restore back to index 2.
    history.replaceState({ __llui_idx: 1 }, '', '/article/x')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 1 } }))
    expect(goSpy).toHaveBeenCalledWith(1)
    expect(send).not.toHaveBeenCalled()

    // The next popstate lands on a DIFFERENT index than the restore expected:
    // it is a genuine navigation and must NOT be swallowed.
    history.replaceState({ __llui_idx: 0 }, '', '/other')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 0 } }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith({ type: 'navigate', route: { page: 'other' } })

    // ...and the arm must be gone, or this one — which DOES carry the index the
    // restore was waiting for — is swallowed instead of dispatching.
    history.replaceState({ __llui_idx: 2 }, '', '/admin')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 2 } }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ type: 'navigate', route: { page: 'admin' } })

    goSpy.mockRestore()
    dispose()
  })

  it('does not inflate the index when the app pushes while a restore is pending', async () => {
    // `history.go` is asynchronous, so an app that navigates in the same tick as
    // a blocked pop pushes from the BLOCKED entry — which truncates everything
    // above it. Numbering the new entry from the index we held before the block
    // claims a depth the stack no longer has, and the next blocked back then
    // computes an unreachable delta and leaves the URL sitting on the route it
    // just blocked: #103's original symptom, re-reachable.
    history.replaceState({ __llui_idx: 2 }, '', '/other')
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (to.page === 'article' ? false : undefined),
    })
    const { dispose } = mountListener(routing)
    const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {})

    // Blocked pop onto the entry stamped 1; its restore is armed but in flight.
    history.replaceState({ __llui_idx: 1 }, '', '/article/x')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 1 } }))
    expect(goSpy).toHaveBeenCalledWith(1)

    // The app navigates before the restore lands: the new entry sits directly
    // above the one we are STANDING on, so it is 2 — never 3.
    navigate(routing, { page: 'admin' })
    expect(history.state).toMatchObject({ __llui_idx: 2 })

    // …and a later blocked back is reachable: delta 1, not an overshoot of 2.
    goSpy.mockClear()
    history.replaceState({ __llui_idx: 1 }, '', '/article/x')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __llui_idx: 1 } }))
    expect(goSpy).toHaveBeenCalledWith(1)

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

  it('never guesses the position of an entry that pre-dates the router', async () => {
    // A `hashchange` onto an entry we never stamped is NOT necessarily a new
    // fragment navigation: every entry created before `connectRouter` ran is
    // unstamped too. Treating a traversal onto one as a push stamped it ABOVE
    // the entry it sits below, and the next blocked back then computed a
    // NEGATIVE delta and traversed further BACKWARDS — landing two entries
    // away and dispatching a navigate the user never asked for.
    location.hash = '#/'
    await settle()
    location.hash = '#/other'
    await settle()

    let blockHome = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (blockHome && to.page === 'home' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    // Back onto the pre-existing (unstamped) entry, then forward again: the
    // router must not conclude anything about where that entry sits.
    history.back()
    expect(await waitForUrl(hash, '#/')).toBe('#/')
    history.forward()
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    send.mockClear()

    blockHome = true
    history.back()
    expect(await waitForUrl(hash, '#/')).toBe('#/')

    // The blocked entry's position is UNKNOWN, so nothing is restored — but
    // nothing may be guessed either. Waiting for the corrupted outcome (a
    // traversal PAST the blocked entry, onto the pre-hash entry) and never
    // seeing it is the assertion; it cannot pass early on a slow machine.
    expect(await waitForUrl(hash, '')).toBe('#/')
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('leaves the URL on the blocked route when the popped entry was hand-edited (#150)', async () => {
    // THE ONE COST of #150, asserted rather than merely written down: a hash the
    // USER typed lands on an entry the router never stamped, and #150 treats
    // every unstamped entry as UNKNOWN. So a guard-blocked traversal OFF such an
    // entry cannot be undone — the URL is left showing the route the guard
    // refused, until the next navigation.
    //
    // This test is the exact INVERSE of the one it replaces ("still tracks a
    // genuine new fragment navigation"), which asserted the restore this gives
    // up. The trade is deliberate: the `history.length` discriminator that
    // bought it is stale-by-construction (a foreign `pushState` or an iframe
    // navigation grows the stack behind the router's back), and reading a
    // traversal as a push stamps an INVERTED index that sends the NEXT blocked
    // back two entries the wrong way — #103's failure, from a guess.
    //
    // The second half pins what SURVIVES: an entry the router created itself
    // still carries its position, so a block there is still undone. Without it
    // "treat everything as unknown, always" would pass this file.
    let blockHome = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (blockHome && to.page === 'home' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    location.hash = '#/other' // not through the router — a user navigation
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    // jsdom moves the URL synchronously and queues the event, so the listener
    // has NOT run yet at this point — settle before reading what it did.
    await settle()
    // Nothing was written onto the entry the edit created: its position is
    // unknown, and #150 refuses to invent one.
    expect(stampedIndex(history.state)).toBeUndefined()
    send.mockClear()

    blockHome = true
    history.back() // → the entry the router loaded on (bare '', i.e. `#/`)
    expect(await waitForUrl(hash, '')).toBe('')

    // Nothing is restored. Waiting for the pre-#150 outcome — a traversal back
    // onto `#/other` — and never seeing it is the assertion; a fixed sleep could
    // pass early on a loaded machine.
    expect(await waitForUrl(hash, '#/other')).toBe('')
    expect(send).not.toHaveBeenCalled()

    // …and the capability that is NOT given up: two entries the ROUTER created
    // carry their positions, so a block between them is still undone by a
    // traversal. Push a pair of them and block the back onto the seeded root.
    blockHome = false
    navigate(routing, { page: 'other' })
    navigate(routing, { page: 'admin' })
    await settle()

    blockHome = true
    send.mockClear()
    history.back() // → `#/other` (allowed — the guard only blocks `home`)
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    expect(send).toHaveBeenCalledTimes(1)

    send.mockClear()
    history.back() // → the seeded root, i.e. `home` — BLOCKED
    expect(await waitForUrl(hash, '')).toBe('')
    // Known index on both sides → the block IS undone, by a traversal.
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('preserves foreign history.state across a hash-mode replace', async () => {
    // `stampCurrent`/`replaceUrl` deliberately merge into whatever the host app
    // (or another library) already put on the entry. The hash `replace` branch
    // re-stamps an entry too — `location.replace` drops its state — so it must
    // put back what was there instead of writing our index alone.
    location.hash = '#/other'
    await settle()
    history.replaceState({ ...(history.state as object), host: 'keep' }, '')

    const routing = connectRouter(hashRouter())
    routing.handleEffect({
      effect: routing.replace({ page: 'admin' }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(location.hash).toBe('#/admin')
    expect(history.state).toMatchObject({ host: 'keep', __llui_idx: expect.any(Number) })
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

describe('#150 history that grew behind the router — hash mode', () => {
  // #139 classified an unstamped `hashchange` landing with `history.length >
  // knownLength`: a push grows the session history, a traversal does not. But
  // `knownLength` was only refreshed where the ROUTER observed or changed
  // history, so growth it never saw left it stale-LOW — and stale-low reads a
  // TRAVERSAL as a push, stamping an INVERTED index (the entry BELOW numbered
  // ABOVE the one it sits under). #150 deletes the discriminator: every
  // unstamped entry is UNKNOWN, in both modes.
  //
  // The growth here is a foreign `history.pushState` onto `location.href` —
  // analytics, an embedded widget, another framework on the page. Same URL, so
  // it fires no `hashchange`, and neither does the traversal back off it: the
  // router sees NEITHER, which is exactly how the cached length goes stale. (An
  // iframe navigation grows the joint session history the same way; jsdom cannot
  // drive one, and the defect needs no iframe.)

  beforeEach(async () => {
    location.hash = ''
    history.replaceState(null, '', '/')
    await settle()
  })

  /**
   * `#/ | #/other | #/admin` — three entries that pre-date the router — with
   * `connectRouter` seeding the one it loads on (`#/admin`, index 0), then one
   * entry of foreign growth above it and a traversal back down onto it.
   */
  async function grownBehindTheRouter(options?: ConnectOptions<Route>) {
    location.hash = '#/'
    await settle()
    location.hash = '#/other'
    await settle()
    location.hash = '#/admin'
    await settle()

    const routing = connectRouter(hashRouter(), options)
    const mounted = mountListener(routing)
    expect(stampedIndex(history.state)).toBe(0)

    history.pushState({ foreign: 'analytics' }, '', location.href)
    history.back() // back onto our seeded entry — same url, so NO hashchange
    await waitUntil(() => stampedIndex(history.state) === 0, 'the traversal onto #/admin')
    expect(location.hash).toBe('#/admin')

    return { routing, ...mounted }
  }

  it('stamps NOTHING on an entry it traverses onto, however stale a length would be', async () => {
    const { send, dispose } = await grownBehindTheRouter()

    history.back() // → the unstamped `#/other`, and this one DOES fire
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    await settle()

    // With the discriminator this read as a push and wrote `{ __llui_idx: 1 }`
    // onto an entry sitting BELOW the one stamped `0`. Its position is unknown
    // and unknowable, so nothing at all is written.
    expect(stampedIndex(history.state)).toBeUndefined()
    // The navigation itself is unaffected — only the bookkeeping is refused.
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'other' } })

    dispose()
  })

  it('a later blocked back stays put instead of traversing past the blocked entry', async () => {
    let blockOther = false
    const { send, dispose } = await grownBehindTheRouter({
      beforeEnter: (to) => (blockOther && to.page === 'other' ? false : undefined),
    })

    history.back() // → `#/other` (unstamped → UNKNOWN)
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    history.forward() // → back onto `#/admin`, which IS stamped (0)
    expect(await waitForUrl(hash, '#/admin')).toBe('#/admin')
    send.mockClear()

    const goSpy = vi.spyOn(history, 'go')
    blockOther = true
    history.back() // → `#/other`, blocked
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')

    // The fabricated stamp made this the worst case rather than a no-op: `1`
    // against the landed `0` is a NEGATIVE delta, so `history.go(-1)` traversed
    // FURTHER BACK onto `#/`, two entries from where the user pressed back once.
    // Waiting for that landing and never seeing it is the assertion.
    expect(await waitForUrl(hash, '#/')).toBe('#/other')
    expect(goSpy).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    goSpy.mockRestore()
    dispose()
  })
})
