import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, route } from '../src/index'
import { connectRouter } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// #150 review, finding B2 — a stamp written by a build that predates
// `__llui_run` carries an index and nothing else. Reading that absence as ONE
// distinguished "legacy run" (so the numbering could be adopted and continued)
// rests on a premise that is FALSE for every build that ever shipped one:
// `origin/fix/router-143`, the #139 build and this PR's own revision `3d3e0ca7`
// all RESTART their numbering across an entry they cannot place, and none of
// them record the restart. So an absent key names every run every prior build
// ever opened, collapsed into one comparable id — the degenerate counter
// `mintRun` exists to rule out — and a delta gets computed straight across a
// boundary the mechanism was built to refuse.
//
// Both tests below are the reviewer's measured probes, kept as regression
// tests. Against a build whose `readRun` returns a shared constant for an absent
// key they fail with the wrong landing (`#/article/hand`, `/tracker`); the third
// is the other direction, and fails if refusing across a legacy boundary turns
// into refusing always.

const registry = {
  home: route('/'),
  admin: route('/admin'),
  other: route('/other'),
  article: route('/article/:slug'),
}
type Registry = typeof registry

const hashRouter = () => createRouter(registry)
const historyRouter = () => createRouter(registry, { mode: 'history' })

const settle = () => new Promise((r) => setTimeout(r, 15))
const hash = () => location.hash
const path = () => location.pathname

async function waitForUrl(read: () => string, expected: string): Promise<string> {
  const deadline = Date.now() + 2000
  while (read() !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2))
  }
  return read()
}

// Tear down whatever a test mounted even when an assertion throws first: a
// leaked `hashchange` listener stamps the NEXT test's fixture writes, so a
// mutation run would report failures at a shared setup instead of on each
// test's own merits (#150 review, finding N1).
const mountedListeners: Array<() => void> = []
afterEach(() => {
  while (mountedListeners.length > 0) mountedListeners.pop()!()
  // …and the `history.go` spy, for the same reason: a spy that outlives a
  // failing test is re-wrapped by the next one's `spyOn`, and the bound
  // "original" it calls IS the previous spy — infinite recursion instead of the
  // failure the mutation actually caused.
  vi.restoreAllMocks()
})

function mountListener(routing: ReturnType<typeof connectRouter<Registry>>) {
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'L',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    handle.dispose()
  }
  mountedListeners.push(dispose)
  return { send, dispose }
}

/** Push a hash entry and stamp it the way a build WITHOUT run ids did. */
async function legacyEntry(h: string, index: number | null): Promise<void> {
  location.hash = h
  await settle()
  if (index !== null) history.replaceState({ __llui_idx: index }, '', location.href)
}

/** Record every `history.go` the ROUTER issues, while still performing it. */
function recordGo(): { calls: number[]; restore: () => void } {
  const calls: number[] = []
  const real = history.go.bind(history)
  const spy = vi.spyOn(history, 'go').mockImplementation((delta?: number) => {
    calls.push(delta ?? 0)
    real(delta)
  })
  return { calls, restore: () => spy.mockRestore() }
}

describe('#150 review B2 — an index with no run is not a position (hash mode)', () => {
  beforeEach(async () => {
    location.hash = ''
    history.replaceState(null, '', '/')
    await settle()
  })

  it('refuses a blocked traversal across a legacy stack whose numbering restarted', async () => {
    // Exactly the stack revision `3d3e0ca7` leaves behind: seed 0, push 1, a
    // hand edit it (correctly) would not number, then a push numbered 1 AGAIN
    // from the `?? 0` floor, then 2. Five entries, four indices, one silent
    // restart — and no run key anywhere to say so.
    await legacyEntry('#/', 0)
    await legacyEntry('#/other', 1)
    await legacyEntry('#/article/hand', null)
    await legacyEntry('#/admin', 1)
    await legacyEntry('#/article/top', 2)
    expect(hash()).toBe('#/article/top')
    expect(history.state).toEqual({ __llui_idx: 2 })

    let blockHome = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (blockHome && to.name === 'home' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)
    // The seed did not adopt the legacy index: it re-stamped the entry into a
    // run of its own, so nothing above or below is subtractable from it.
    expect(history.state).toEqual({ __llui_idx: 0, __llui_run: expect.any(String) })

    const go = recordGo()
    blockHome = true
    send.mockClear()
    history.go(-4) // straight down to `#/` — BLOCKED
    expect(await waitForUrl(hash, '#/')).toBe('#/')
    // Waiting for the corrupted landing and never seeing it is the assertion: a
    // fixed sleep could pass early on a loaded machine.
    expect(await waitForUrl(hash, '#/article/hand')).toBe('#/')

    // Refused: the URL is left on the route the guard rejected, nothing was
    // dispatched, and the ONLY `go` is the test's own. Adopting the legacy
    // numbering instead answered with `go(2)` — a restore computed across a run
    // boundary the router had declared comparable — and landed the user on
    // `#/article/hand`, an entry nobody asked for.
    expect(go.calls).toEqual([-4])
    expect(hash()).toBe('#/')
    expect(send).not.toHaveBeenCalled()
    go.restore()
    dispose()
  })

  it('still rewinds a blocked back between two entries IT numbered above a legacy stack', async () => {
    // The other direction. Refusing across a legacy boundary must not become
    // refusing always: the entries this run numbers itself are in ONE run and
    // stay subtractable, legacy stack underneath or not.
    await legacyEntry('#/', 0)
    await legacyEntry('#/article/hand', null)
    await legacyEntry('#/other', 1)

    let blockOther = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (blockOther && to.name === 'other' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    // Two entries of our own, numbered consecutively from the re-seeded root.
    routing.handleEffect({
      effect: routing.push('admin'),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(await waitForUrl(hash, '#/admin')).toBe('#/admin')
    await settle()
    send.mockClear()

    blockOther = true
    history.back() // → `#/other`, BLOCKED → restored to `#/admin`
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    expect(await waitForUrl(hash, '#/admin')).toBe('#/admin')
    expect(send).not.toHaveBeenCalled()
    dispose()
  })
})

describe('#150 review B2 — an index with no run is not a position (history mode)', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    await settle()
  })

  it('refuses a blocked traversal across a foreign entry an older build numbered through', async () => {
    // No hand edit needed, and no hash mode: this is the stack
    // `origin/fix/router-143` ITSELF produces. It seeds `{idx:0}`, never sees
    // the foreign `pushState` (which fires nothing), and numbers its own next
    // push from the index it still holds — one index across two physical
    // entries, with no run key to make the gap visible.
    history.replaceState({ __llui_idx: 0 }, '', '/')
    history.pushState({ analytics: true }, '', '/tracker')
    history.pushState({ __llui_idx: 1 }, '', '/admin')
    await settle()
    expect(path()).toBe('/admin')

    let blockHome = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (blockHome && to.name === 'home' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)
    expect(history.state).toEqual({ __llui_idx: 0, __llui_run: expect.any(String) })

    const go = recordGo()
    blockHome = true
    send.mockClear()
    history.go(-2) // down to '/', BLOCKED
    expect(await waitForUrl(path, '/')).toBe('/')
    // As above: the failure is a LATER traversal onto the foreign entry, so
    // wait for it and require that it never comes.
    expect(await waitForUrl(path, '/tracker')).toBe('/')

    // Refused. Continuing the older build's numbering answered with `go(1)`,
    // which deposits the user on the analytics entry — and dispatched nothing,
    // so `state.route` desynced from the URL as well.
    expect(go.calls).toEqual([-2])
    expect(path()).toBe('/')
    expect(send).not.toHaveBeenCalled()
    go.restore()
    dispose()
  })
})
