import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter } from '../src/connect'
import type { RouterEnv } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #143 — the popstate/hashchange listener honoured a guard REDIRECT in the
// message it dispatched but never wrote the redirected URL, so `state.route` said
// `/login` while `location` still said `/admin`: a reload, a share or a bookmark
// went straight back to the guarded route. Same desync class as #110.3 (there the
// URL was right and the message missing; here the message was right and the URL
// missing).
//
// The fix REPLACES the entry the browser landed on — see `rewriteLandedUrl` in
// `connect.ts` for the full rationale. These tests pin the three halves that can
// silently regress: the URL actually moves, the stack is not disturbed (length,
// forward entries, no echo dispatch), and the index on the resulting entry keeps
// a LATER blocked back reachable.

type Route =
  | { page: 'home' }
  | { page: 'admin' }
  | { page: 'login' }
  | { page: 'other' }
  | { page: 'article'; slug: string }

const defs = () => [
  route<Route>([], () => ({ page: 'home' })),
  route<Route>(['admin'], () => ({ page: 'admin' })),
  route<Route>(['login'], () => ({ page: 'login' })),
  route<Route>(['other'], () => ({ page: 'other' })),
  route<Route>(['article', param('slug')], ({ slug }) => ({ page: 'article', slug: slug! })),
]

/** The redirect target, as a Route — an inline literal widens to `{page: string}`. */
const LOGIN: Route = { page: 'login' }
/** The second hop of a redirect CHAIN, which is never taken (#161). */
const HOME: Route = { page: 'home' }

const hashRouter = () => createRouter<Route>(defs())
const historyRouter = () => createRouter<Route>(defs(), { mode: 'history' })

/** Let jsdom deliver the events queued by a synchronous URL write. */
const settle = () => new Promise((r) => setTimeout(r, 10))

/**
 * Wait for a TRAVERSAL to land (see `history-integrity.test.ts` — a traversal is
 * delivered on a later task than a fixed sleep can guarantee, so poll).
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
    name: 'RedirectUrlSyncHost',
    init: (): [null, never[]] => [null, []],
    update: (s: null): [null, never[]] => [s, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  return { send, dispose: () => handle.dispose() }
}

/**
 * A stamp of the kind the router writes ITSELF: an index plus the RUN it is
 * currently numbering in, read off the entry it last stamped. An index is only a
 * position WITHIN its run, so one fabricated outside the router's run is
 * correctly refused as a delta endpoint (#150 review).
 */
function ownStamp(state: unknown, index: number): Record<string, unknown> {
  const run = state !== null && typeof state === 'object' ? (state as never)['__llui_run'] : null
  return typeof run === 'string' ? { __llui_idx: index, __llui_run: run } : { __llui_idx: index }
}

/** Drive a `navigate()` effect with its own send, so the listener's stays clean. */
function navigate(routing: ReturnType<typeof connectRouter<Route>>, to: Route) {
  routing.handleEffect({
    effect: routing.navigate(to),
    send: vi.fn(),
    signal: new AbortController().signal,
  })
}

describe('#143 a guard redirect on a browser-driven navigation — history mode', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    await settle()
  })

  it('leaves location on the redirect target after a back onto a guarded route', async () => {
    // AC 1. Without the fix the address bar keeps showing /admin for a
    // `state.route` of /login — the whole defect.
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (guardOn && to.page === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    guardOn = true
    send.mockClear()

    history.back() // → /admin, redirected to /login
    expect(await waitForUrl(path, '/login')).toBe('/login')
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'login' } })

    dispose()
  })

  it('replaces rather than pushes: history.length and the forward entry survive', async () => {
    // AC 3. A `go` + push would have truncated /other and grown the stack.
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (guardOn && to.page === 'admin' ? LOGIN : undefined),
    })
    const { dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    const lengthBefore = history.length
    guardOn = true

    history.back()
    expect(await waitForUrl(path, '/login')).toBe('/login')
    expect(history.length).toBe(lengthBefore)

    // The entry ABOVE the redirected one is still reachable — a push would have
    // thrown it away.
    history.forward()
    expect(await waitForUrl(path, '/other')).toBe('/other')

    dispose()
  })

  it('keeps a LATER blocked back reachable from the redirected entry', async () => {
    // AC 4. The two-step sequence, not the redirect in isolation: the redirect
    // must leave `currentIndex` on the entry it rewrote, or the next blocked
    // back computes its `history.go` delta from a position it is not standing
    // on and overshoots (#103's failure, re-reached through #143's write).
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.page === 'admin') return LOGIN
        if (to.page === 'other') return false
        return undefined
      },
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, { page: 'other' }) // idx 1
    navigate(routing, { page: 'admin' }) // idx 2
    navigate(routing, { page: 'article', slug: 'x' }) // idx 3
    guardOn = true
    send.mockClear()

    history.back() // → idx 2 (/admin) → redirected to /login IN PLACE
    expect(await waitForUrl(path, '/login')).toBe('/login')

    history.back() // → idx 1 (/other) → BLOCKED → restored to idx 2
    expect(await waitForUrl(path, '/other')).toBe('/other')
    expect(await waitForUrl(path, '/login')).toBe('/login')

    // The restore is OUR OWN traversal, so it is recognised and swallowed. It is
    // recognised by the index stamped on the entry it lands on — the one the
    // redirect rewrote — so a stamp that drifted by one turns the rewind into an
    // apparent user navigation: an extra dispatch here, and a `currentIndex`
    // adopted from the drifted stamp.
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'login' } })

    // …which the SECOND blocked back would then measure its delta from. Repeating
    // it is the actual acceptance criterion: the delta must still be reachable,
    // and must not overshoot forward onto /article/x.
    history.back()
    expect(await waitForUrl(path, '/other')).toBe('/other')
    expect(await waitForUrl(path, '/login')).toBe('/login')
    expect(send).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('writes nothing when the guard allows the navigation unchanged', async () => {
    // The URL write is scoped to a REDIRECT: an allowed pop must stay a pure
    // read, or every back/forward would re-stamp an entry it had no business
    // touching.
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), { env: rec.env })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '/other')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'other' } })

    dispose()
  })
})

describe('#143 a guard redirect on a browser-driven navigation — hash mode', () => {
  beforeEach(async () => {
    location.hash = ''
    history.replaceState(null, '', '/')
    await settle()
  })

  it('leaves location on the redirect target, dispatching EXACTLY once', async () => {
    // AC 2. The echo case is the real hazard here: a URL write in hash mode can
    // itself produce a `hashchange`, which the listener would run guards on and
    // dispatch a SECOND time (#108's failure shape). `replaceState` fires no
    // event at all, so nothing is armed and nothing is swallowed — asserted by
    // the count AFTER a settle, which is when a queued echo would have landed.
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (guardOn && to.page === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'other' })
    await settle()
    guardOn = true
    send.mockClear()
    const lengthBefore = history.length

    history.back() // → #/admin, redirected to #/login
    expect(await waitForUrl(hash, '#/login')).toBe('#/login')
    await settle() // let any echo the write could have queued arrive

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'login' } })
    expect(history.length).toBe(lengthBefore)

    dispose()
  })

  it('keeps the forward entry and a later blocked back reachable', async () => {
    // AC 3 + AC 4 in hash mode, where a blocked back is undone by a suppressed
    // traversal rather than by `pendingRestore`.
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.page === 'admin') return LOGIN
        if (to.page === 'other') return false
        return undefined
      },
    })
    const { dispose } = mountListener(routing)

    navigate(routing, { page: 'other' })
    navigate(routing, { page: 'admin' })
    navigate(routing, { page: 'article', slug: 'x' })
    await settle()
    guardOn = true

    history.back() // → #/admin → redirected to #/login in place
    expect(await waitForUrl(hash, '#/login')).toBe('#/login')

    history.back() // → #/other → BLOCKED → restored to the redirected entry
    expect(await waitForUrl(hash, '#/other')).toBe('#/other')
    expect(await waitForUrl(hash, '#/login')).toBe('#/login')

    // …and the entry above it is still there.
    history.forward()
    expect(await waitForUrl(hash, '#/article/x')).toBe('#/article/x')

    dispose()
  })
})

// ── The mechanism, at the env seam ───────────────────────────────
//
// jsdom agrees with the spec about `replaceState` (it changes the URL in place
// and fires no event), but "the URL ended up right" cannot tell a replace from a
// `go` + push that happened to settle on the same address. These assert the
// EXACT env calls, so the mechanism is pinned rather than its outcome.

interface Recorded {
  env: RouterEnv
  calls: string[]
  /** Move the synthetic browser onto another entry, invisibly to the recorder. */
  land(state: unknown, url: string): void
  /**
   * Grow the session history by one entry WITHOUT the router observing it — a
   * foreign `pushState` or an iframe navigation, the #150 shape. It is what made
   * any cached `history.length` stale-LOW; since #150 nothing reads the length
   * except the seed's "is there a history here" test, so this must now change
   * NOTHING about how a landing is classified.
   */
  grow(): void
  /** Deliver the browser-driven URL change to the mounted listener. */
  fire(): void
}

function recordingEnv(initial?: { hash?: string; pathname?: string }): Recorded {
  const calls: string[] = []
  const handlers: Array<{
    event: 'popstate' | 'hashchange'
    handler: (newHash?: string) => void
  }> = []
  let hash = initial?.hash ?? ''
  let pathname = initial?.pathname ?? '/'
  let historyState: unknown = null
  let historyLength = 1
  let observedHash = hash

  /** A fragment-only url addresses the hash; anything else the path. */
  const applyUrl = (url: string) => {
    if (url.startsWith('#')) hash = url
    else pathname = url
  }

  const env: RouterEnv = {
    get hash() {
      return hash
    },
    get pathname() {
      return pathname
    },
    get search() {
      return ''
    },
    get historyState() {
      return historyState
    },
    get historyLength() {
      return historyLength
    },
    setHash(next) {
      calls.push(`setHash:${next}`)
      hash = next
      historyLength++
    },
    pushState(state, url) {
      calls.push(`pushState:${url}`)
      historyState = state
      applyUrl(url)
      historyLength++
    },
    replaceState(state, url) {
      calls.push(`replaceState:${url ?? '<no url>'}`)
      historyState = state
      if (url !== undefined) applyUrl(url)
    },
    back() {
      calls.push('back')
    },
    forward() {
      calls.push('forward')
    },
    go(delta) {
      calls.push(`go:${delta}`)
    },
    scrollTo(x, y) {
      calls.push(`scrollTo:${x},${y}`)
    },
    onUrlChange(event, handler) {
      const entry = { event, handler }
      handlers.push(entry)
      return () => {
        handlers.splice(handlers.indexOf(entry), 1)
      }
    },
  }

  return {
    env,
    calls,
    land(state, url) {
      historyState = state
      applyUrl(url)
    },
    grow() {
      historyLength++
    },
    fire() {
      const landedHash = hash
      const fragmentChanged = observedHash !== hash
      handlers.filter(({ event }) => event === 'popstate').forEach(({ handler }) => handler())
      if (fragmentChanged) {
        handlers
          .filter(({ event }) => event === 'hashchange')
          .forEach(({ handler }) => handler(landedHash))
      }
      observedHash = hash
    },
  }
}

describe('#143 the redirect writes ONE replace, carrying the landed index', () => {
  it('history mode: replaceState with the path, index and length untouched', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)
    const lengthBefore = rec.env.historyLength

    rec.land({ __llui_idx: 3, host: 'keep' }, '/admin')
    rec.calls.length = 0
    rec.fire()

    // ONE call, and it is a REPLACE carrying the url — not a pushState, not a
    // `go`, not a `setHash`.
    expect(rec.calls).toEqual(['replaceState:/login'])
    expect(rec.env.pathname).toBe('/login')
    // The entry did not move, so it keeps its index — and the host's own key on
    // that entry survives, like every other stamp in this file.
    expect(rec.env.historyState).toEqual({ __llui_idx: 3, host: 'keep' })
    expect(rec.env.historyLength).toBe(lengthBefore)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'login' } })

    dispose()
  })

  it('hash mode: replaceState with the fragment — never setHash (which pushes)', () => {
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)
    const lengthBefore = rec.env.historyLength

    rec.land({ __llui_idx: 3 }, '#/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual(['replaceState:#/login'])
    expect(rec.env.hash).toBe('#/login')
    expect(rec.env.historyState).toEqual({ __llui_idx: 3 })
    expect(rec.env.historyLength).toBe(lengthBefore)
    expect(send).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('arms no echo suppression, so the next genuine hashchange still dispatches', () => {
    // The other half of the hash-mode decision. `replaceState` fires no event,
    // so there is nothing to suppress — and suppressing DEFENSIVELY would not be
    // free: a pending echo is only discarded when the URL moves off the hash it
    // was armed for, so a genuine navigation onto ANOTHER entry showing the same
    // hash (a second `#/login` entry — ordinary once a redirect can produce one)
    // would be swallowed instead of dispatched.
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '#/admin')
    rec.fire() // redirected to #/login
    expect(send).toHaveBeenCalledTimes(1)

    rec.land({ __llui_idx: 4 }, '#/login')
    rec.fire()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ type: 'navigate', route: { page: 'login' } })

    dispose()
  })

  it('writes the URL but INVENTS NO INDEX for an entry of unknown position', () => {
    // The #103 constraint the write must not break: a traversal onto an entry
    // nobody stamped has no knowable position. The redirect still has to reach
    // the address bar, but stamping a guessed index there would make the NEXT
    // blocked back compute a delta from a fiction and traverse the wrong way.
    const rec = recordingEnv({ pathname: '/' })
    let redirect = true
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        if (redirect) return to.page === 'admin' ? LOGIN : undefined
        return to.page === 'article' ? false : undefined
      },
    })
    const { dispose } = mountListener(routing)

    rec.land(null, '/admin') // unstamped: position UNKNOWN
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual(['replaceState:/login'])
    expect(rec.env.pathname).toBe('/login')
    expect(rec.env.historyState).toBeNull()

    // A later blocked pop must therefore still refuse to guess a delta.
    redirect = false
    rec.land({ __llui_idx: 5 }, '/article/x')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual([])

    dispose()
  })

  it('leaves a LATER unstamped hashchange unstamped, however the stack grew (#150)', () => {
    // The redirect path is where the deleted `history.length` discriminator was
    // at its most stale. `adoptLandedEntry` returned early on a STAMPED entry —
    // which is the entry every redirect lands on — so a traversal through the
    // router's own entries never refreshed the cached length, and growth the
    // router never saw (a foreign `pushState`, an iframe navigation) stayed
    // invisible indefinitely. #143 patched that one hole with a re-read here;
    // #150 removed the cache instead.
    //
    // Stale-LOW was the dangerous direction: it made the next unstamped
    // `hashchange` read as a PUSH, stamping an INVENTED index onto an entry
    // whose position the router does not know, and every later blocked back then
    // computed its `history.go` delta from that fiction (#103's failure). This
    // is the same trace at the injected-env seam that `history-integrity.test.ts`
    // drives through real jsdom traversals: whatever the length says, an
    // unstamped entry is UNKNOWN and nothing is written onto it.
    const rec = recordingEnv({ hash: '#/' })
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.page === 'admin') return LOGIN
        if (to.page === 'article') return false
        return undefined
      },
    })
    const { dispose } = mountListener(routing)

    // #/ (idx 0, seeded) → #/admin (idx 1) → #/other (idx 2), each write's echo
    // consumed.
    navigate(routing, { page: 'admin' })
    rec.fire()
    navigate(routing, { page: 'other' })
    rec.fire()

    // …then the stack grows behind the router's back.
    rec.grow()
    guardOn = true

    // A traversal back onto the STAMPED #/admin entry, redirected to #/login —
    // the landing `adoptLandedEntry` adopts and returns from, and the one a
    // length cache could never learn anything from.
    rec.land({ __llui_idx: 1 }, '#/admin')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual(['replaceState:#/login'])

    // Now a traversal onto an entry NOBODY stamped. Its position is genuinely
    // unknown, and the router must say so: no stamp, no state written.
    rec.land(null, '#/other')
    rec.calls.length = 0
    rec.fire()

    // Under a push classifier this is `['replaceState:<no url>']` with the entry
    // stamped `{ __llui_idx: 2 }` — an index invented for an entry the router
    // has never seen.
    expect(rec.calls).toEqual([])
    expect(rec.env.historyState).toBeNull()

    // …and the consequence that makes it matter: a later blocked navigation must
    // still refuse to guess a delta. With the invented stamp it issues a
    // `history.go` measured from a position it is not standing on.
    rec.land({ __llui_idx: 0 }, '#/article/x')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual([])

    dispose()
  })

  it('leaves the BLOCKED path exactly as it was — a rewind, no URL write', () => {
    // AC 5, asserted at the seam as well as through `history-integrity.test.ts`:
    // a block still undoes itself with a traversal and writes no URL.
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.push({ page: 'other' }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    // Stamped in the run the router is numbering in — the entry below one of
    // its own pushes. An index alone is not a position: it only means something
    // against another index from the SAME run, so a bare `{ __llui_idx: 0 }`
    // here is an entry the router could not have created and the rewind is
    // (correctly) refused (#150 review).
    rec.land(ownStamp(rec.env.historyState, 0), '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls.filter((c) => c.startsWith('replaceState'))).toEqual([])
    expect(rec.calls.some((c) => c.startsWith('go:'))).toBe(true)
    expect(rec.env.pathname).toBe('/admin')
    expect(send).not.toHaveBeenCalled()

    dispose()
  })

  it('#161 the LISTENER chains to the fixed point, and writes it ONCE', () => {
    // The call site #161 was reported from, asserted here at the env seam
    // because this is the path that also WRITES the URL. Two things have to
    // hold: the chain settles on `/home` (the guard is re-asked about `login`),
    // and the intermediate hops write NOTHING — the URL is rewritten once, from
    // the resolved outcome, so #143's agreement lands on the settled route
    // rather than on a hop the guard would have moved on from.
    const rec = recordingEnv({ pathname: '/' })
    const seen: Route[] = []
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        seen.push(to)
        if (to.page === 'admin') return LOGIN
        if (to.page === 'login') return HOME
        return undefined
      },
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(seen).toEqual([{ page: 'admin' }, { page: 'login' }, { page: 'home' }])
    expect(rec.calls).toEqual(['replaceState:/'])
    expect(rec.env.pathname).toBe('/')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: HOME })

    dispose()
  })

  it('#162 a same-URL guard redirect writes NOTHING — history mode', () => {
    // `runGuards` reports `redirected: true` for ANY non-`false`, non-nullish
    // `beforeEnter` return, deliberately: routes are generic `R` and may be
    // primitives, so there is no equality it could infer the flag from. A guard
    // that NORMALISES its argument and hands back a structurally equal route is
    // therefore a redirect as far as the listener is concerned — and used to
    // issue a `replaceState` whose url was byte-identical to the one already
    // showing, on every guarded browser navigation.
    //
    // Harmless in behaviour (no event, no length change, the same stamp written
    // back), but the other two URL writes in this file already short-circuit on
    // exactly this question, so a reader who learned the rule from `setHash`
    // assumed this path had it too.
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      // Structurally equal, different identity.
      beforeEnter: (to) => (to.page === 'admin' ? ({ page: 'admin' } as Route) : undefined),
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3, host: 'keep' }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    // Everything else is unchanged: the URL, the entry's state, and the dispatch
    // of the route the guard actually returned.
    expect(rec.env.pathname).toBe('/admin')
    expect(rec.env.historyState).toEqual({ __llui_idx: 3, host: 'keep' })
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'admin' } })

    dispose()
  })

  it('#162 a same-URL guard redirect writes NOTHING — hash mode', () => {
    // The two modes address DIFFERENT parts of the URL, so the short-circuit is
    // not one string equality: this half is `sameHash`, which is also what
    // `setHash` and the `replace()` effect ask.
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? ({ page: 'admin' } as Route) : undefined),
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '#/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    expect(rec.env.hash).toBe('#/admin')
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'admin' } })

    dispose()
  })

  it('#162 a redirect that DOES move the URL still writes it, in both modes', () => {
    // The other direction, and the reason the short-circuit compares URLs rather
    // than trusting `redirected`: over-applying it would silently switch #143's
    // whole fix off. A one-character-different destination must still be written.
    const hist = recordingEnv({ pathname: '/' })
    const histRouting = connectRouter(historyRouter(), {
      env: hist.env,
      beforeEnter: (to) => (to.page === 'admin' ? LOGIN : undefined),
    })
    const histHost = mountListener(histRouting)
    hist.land({ __llui_idx: 3 }, '/admin')
    hist.calls.length = 0
    hist.fire()
    expect(hist.calls).toEqual(['replaceState:/login'])
    expect(hist.env.pathname).toBe('/login')
    histHost.dispose()

    const hashRec = recordingEnv({ hash: '#/' })
    const hashRouting = connectRouter(hashRouter(), {
      env: hashRec.env,
      beforeEnter: (to) => (to.page === 'admin' ? LOGIN : undefined),
    })
    const hashHost = mountListener(hashRouting)
    hashRec.land({ __llui_idx: 3 }, '#/admin')
    hashRec.calls.length = 0
    hashRec.fire()
    expect(hashRec.calls).toEqual(['replaceState:#/login'])
    expect(hashRec.env.hash).toBe('#/login')
    hashHost.dispose()
  })

  it('rewinds NOTHING onto an entry numbered outside its run (#150)', async () => {
    // The inverse of the test above, and why the construction-time seed opens a
    // RUN of its own rather than joining whatever numbering is already on the
    // stack. `connectRouter` here loads on an unstamped entry and numbers it `0`
    // — a number with no relation to an index some earlier lifetime of the
    // router (or an older build, which stamped an index and no run) may have
    // left on the entries BELOW it.
    //
    // Subtracting the two anyway is #103's failure from a guess: `1 - 0 = 1`
    // here, against a physical distance nobody knows.
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.page === 'admin' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    routing.handleEffect({
      effect: routing.push({ page: 'other' }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    // A bare index, with no run: not an entry this router numbered.
    rec.land({ __llui_idx: 0 }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    expect(rec.env.pathname).toBe('/admin')
    expect(send).not.toHaveBeenCalled()

    dispose()
  })
})
