import { afterEach, describe, expect, it, vi } from 'vitest'
import { component, mountApp, text } from '@llui/dom'
import { createRouter, route, type RouteLocation } from '../src/index'
import {
  browserRouterEnv,
  connectRouter,
  type RouterEnv,
  type RouterNavigateEvent,
} from '../src/connect'
import { sessionHistory, type SessionHistory } from './support/session-history'

// The Navigation API path of a guard-blocked traversal's undo (`nav` in
// `connect.ts`), against the in-memory fake in `support/session-history.ts`
// (jsdom has no Navigation API). Each shape the History API path cannot undo is
// run on BOTH paths: the Navigation API must end consistent, and the History
// path's documented outcome is pinned beside it so the difference is measured,
// not asserted. Real Chromium runs the same shapes in
// `navigation-api.browser.test.ts`; the event-order sweeps are in
// `traversal-event-order.test.ts`.

const registry = {
  home: route('/'),
  a: route('/a'),
  b: route('/b'),
  c: route('/c'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>
type RouteName = keyof Registry & string

const signal = new AbortController().signal

/**
 * A router with a listener mounted on `env`, recording every dispatch — a
 * `navigate` as its route name, an `unmatched` as `unmatched <url>`.
 */
function mountRouter(env: RouterEnv, mode: 'hash' | 'history', blocked: ReadonlySet<string>) {
  const guarded: string[] = []
  const routing = connectRouter(createRouter(registry, { mode }), {
    env,
    beforeEnter: (to) => {
      guarded.push(to.name)
      return blocked.has(to.name) ? false : undefined
    },
  })
  const dispatches: string[] = []
  const record = (message: unknown): void => {
    const msg = message as { type: string; location?: Location; url?: string }
    dispatches.push(msg.type === 'navigate' ? msg.location!.name : `unmatched ${msg.url}`)
  }
  const handle = mountApp(
    document.createElement('div'),
    component({
      name: 'NavigationApiRouter',
      init: (): [null, never[]] => [null, []],
      update: (state: null): [null, never[]] => [state, []],
      view: () => [...routing.listener(record), text('')],
    }),
  )
  return {
    dispatches,
    guarded,
    navigate(name: RouteName) {
      routing.handleEffect({ effect: routing.navigate(name), send: record, signal })
    },
    dispose: () => handle.dispose(),
  }
}

/** Run every queued task, traversals first — the order is not what these test. */
const drain = (history: SessionHistory): void => history.drain(() => 0)

/** Where each shape ends: the app's route, the URL's, and the stack. */
function outcome(
  history: SessionHistory,
  router: ReturnType<typeof mountRouter>,
  app: string,
): { app: string; url: string; index: number; urls: string[]; dispatches: string[] } {
  return {
    app: router.dispatches.at(-1) ?? app,
    url: history.at().url,
    index: history.at().index,
    urls: history.urls(),
    dispatches: [...router.dispatches],
  }
}

const PATHS = [
  { path: 'Navigation API', navigation: true },
  { path: 'History API', navigation: false },
] as const

describe('the shapes the History API path cannot undo', () => {
  it('a foreign pushState below the entry the app is on (history mode)', () => {
    const results = PATHS.map(({ navigation }) => {
      const history = sessionHistory('/', { mode: 'history', navigation })
      const blocked = new Set<string>()
      const router = mountRouter(history.env, 'history', blocked)
      // Analytics, a widget, another framework: an entry the router never sees.
      history.foreignPush('/tracker')
      router.navigate('a')
      blocked.add('home')
      router.dispatches.length = 0
      history.userGo(-2)
      drain(history)
      const result = outcome(history, router, 'a')
      router.dispose()
      return result
    })
    expect(results).toEqual([
      // Navigation API: `traverseTo` names the entry the app shows, so the
      // foreign entry between is irrelevant. The stack is untouched.
      { app: 'a', url: '/a', index: 2, urls: ['/', '/tracker', '/a'], dispatches: [] },
      // History API: the push above the foreign entry opened a new run, the two
      // positions are incomparable, and the URL is left on the refused route.
      { app: 'a', url: '/', index: 0, urls: ['/', '/tracker', '/a'], dispatches: [] },
    ])
  })

  /** `#/ | #/a | #/b (typed) | #/c`, standing on `c`. */
  function typedStack(navigation: boolean, blocked: Set<string>) {
    const history = sessionHistory('#/', { navigation })
    const router = mountRouter(history.env, 'hash', blocked)
    router.navigate('a')
    drain(history)
    // A fragment typed into the address bar: the router sees it through its
    // listener and dispatches it, but it has no position to stamp on it.
    history.typeFragment('#/b')
    drain(history)
    router.navigate('c')
    drain(history)
    expect(router.dispatches).toEqual(['a', 'b', 'c'])
    router.dispatches.length = 0
    return { history, router }
  }

  it('a blocked traversal ACROSS a hand-typed fragment (hash mode)', () => {
    const results = PATHS.map(({ navigation }) => {
      const blocked = new Set<string>()
      const { history, router } = typedStack(navigation, blocked)
      blocked.add('a')
      history.userGo(-2)
      drain(history)
      const result = outcome(history, router, 'c')
      router.dispose()
      return result
    })
    const urls = ['#/', '#/a', '#/b', '#/c']
    expect(results).toEqual([
      { app: 'c', url: '#/c', index: 3, urls, dispatches: [] },
      { app: 'c', url: '#/a', index: 1, urls, dispatches: [] },
    ])
  })

  it('a blocked traversal ONTO a hand-typed fragment (hash mode)', () => {
    const results = PATHS.map(({ navigation }) => {
      const blocked = new Set<string>()
      const { history, router } = typedStack(navigation, blocked)
      blocked.add('b')
      history.userGo(-1)
      drain(history)
      const result = outcome(history, router, 'c')
      router.dispose()
      return result
    })
    const urls = ['#/', '#/a', '#/b', '#/c']
    expect(results).toEqual([
      { app: 'c', url: '#/c', index: 3, urls, dispatches: [] },
      { app: 'c', url: '#/b', index: 2, urls, dispatches: [] },
    ])
  })

  it('a blocked traversal while the app shows an UNMATCHED url returns to that url', () => {
    const results = PATHS.map(({ navigation }) => {
      const history = sessionHistory('#/', { navigation })
      const blocked = new Set<string>()
      const router = mountRouter(history.env, 'hash', blocked)
      router.navigate('a')
      drain(history)
      history.typeFragment('#/nowhere')
      drain(history)
      expect(router.dispatches).toEqual(['a', 'unmatched #/nowhere'])
      blocked.add('a')
      router.dispatches.length = 0
      history.userGo(-1)
      drain(history)
      const result = outcome(history, router, 'unmatched #/nowhere')
      router.dispose()
      return result
    })
    const urls = ['#/', '#/a', '#/nowhere']
    expect(results).toEqual([
      // The app reported `#/nowhere`, so that entry is what it shows.
      { app: 'unmatched #/nowhere', url: '#/nowhere', index: 2, urls, dispatches: [] },
      // The History path restores only from a matched route (`currentLocation`).
      { app: 'unmatched #/nowhere', url: '#/a', index: 1, urls, dispatches: [] },
    ])
  })
})

describe('attribution by the navigate event', () => {
  it('the router’s own landing is neither guarded nor dispatched', () => {
    const history = sessionHistory('#/', { navigation: true })
    const blocked = new Set<string>()
    const router = mountRouter(history.env, 'hash', blocked)
    router.navigate('a')
    drain(history)
    blocked.add('home')
    router.guarded.length = 0
    router.dispatches.length = 0
    history.userGo(-1)
    drain(history)
    // Guarded once — the user's landing on `home` — and never for the restore.
    expect(router.guarded).toEqual(['home'])
    expect(router.dispatches).toEqual([])
    expect(history.landings.map((l) => `${l.by}(${l.delta})→${l.url}`)).toEqual([
      'user(-1)→#/',
      'router(1)→#/a',
    ])
    router.dispose()
  })

  it('two routers on one history never take each other’s traversals for their own', () => {
    const history = sessionHistory('/', { mode: 'history', navigation: true })
    const strict = new Set<string>()
    const first = mountRouter(history.env, 'history', strict)
    const second = mountRouter(history.env, 'history', new Set())
    first.navigate('a')
    strict.add('home')
    first.dispatches.length = 0
    second.dispatches.length = 0
    history.userGo(-1)
    drain(history)
    // The first router refuses `home` and restores `a`. To the second router
    // that restore is somebody else's traversal, like the user's before it.
    expect(first.dispatches).toEqual([])
    expect(second.dispatches).toEqual(['home', 'a'])
    expect(history.at().url).toBe('/a')
    first.dispose()
    second.dispose()
  })

  it('a restore another listener cancels is not waited for', () => {
    const history = sessionHistory('#/', { navigation: true })
    const blocked = new Set<string>()
    const router = mountRouter(history.env, 'hash', blocked)
    router.navigate('a')
    drain(history)
    blocked.add('home')
    router.dispatches.length = 0
    history.userGo(-1)
    // The user's landing on `home` is refused and the router queues
    // `traverseTo(a)`, which announces itself and is then cancelled by someone
    // else's `navigate` listener.
    history.step()
    history.cancelNextTraversal()
    drain(history)
    expect(history.landings.map((l) => `${l.by}→${l.url}`)).toEqual(['user→#/', 'router→null'])
    expect(history.at().url).toBe('#/')
    // The next traversal onto `a` is the user's, and it must be judged as one:
    // the stale announcement names `a` too, but a newer `navigate` replaced it.
    blocked.clear()
    history.userGo(1)
    drain(history)
    expect(router.dispatches).toEqual(['a'])
    expect(history.at().url).toBe('#/a')
    router.dispose()
  })

  it('a restore whose entry a push removed lapses without a trace', () => {
    const history = sessionHistory('/', { mode: 'history', navigation: true })
    const blocked = new Set<string>()
    const router = mountRouter(history.env, 'history', blocked)
    router.navigate('a')
    router.navigate('b')
    blocked.add('a')
    router.dispatches.length = 0
    history.userGo(-1)
    // Refused `a`, restore to `b` queued — and before it runs a foreign push
    // from `a` truncates `b` away. The queued `traverseTo(b)` finds no entry.
    history.step()
    history.foreignPush('/tracker')
    drain(history)
    expect(history.landings.map((l) => `${l.by}→${l.url}`)).toEqual(['user→/a', 'router→null'])
    expect(history.urls()).toEqual(['/', '/a', '/tracker'])
    // Nothing armed: the next genuine traversal is guarded and dispatched once.
    blocked.clear()
    history.userGo(-1)
    drain(history)
    expect(router.dispatches).toEqual(['a'])
    router.dispose()
  })

  it('reads env.navigation once, and unsubscribes from navigate with the listener', () => {
    const history = sessionHistory('#/', { navigation: true })
    let reads = 0
    const env: RouterEnv = Object.create(history.env, {
      navigation: {
        get: () => {
          reads++
          return history.env.navigation
        },
      },
    })
    const router = mountRouter(env, 'hash', new Set())
    router.navigate('a')
    drain(history)
    history.userGo(-1)
    drain(history)
    expect(reads).toBe(1)
    expect(history.subscriptions()).toEqual({ url: 2, navigate: 1 })
    router.dispose()
    expect(history.subscriptions()).toEqual({ url: 0, navigate: 0 })
  })
})

// ── browserRouterEnv's adapter ───────────────────────────────────────────────

/** A stand-in for `window.navigation`, dispatching plain events as `navigate`. */
class FakeNavigation extends EventTarget {
  currentEntry: { key: string } | null = { key: 'entry-1' }
  readonly calls: Array<{ key: string; options: unknown }> = []
  result: { committed?: Promise<unknown>; finished?: Promise<unknown> } = {}
  traverseTo(key: string, options: unknown) {
    this.calls.push({ key, options })
    return this.result
  }
  announce(event: Partial<RouterNavigateEvent> & { destination?: { key: string } }): void {
    const { navigationType, info, destination } = event
    this.dispatchEvent(Object.assign(new Event('navigate'), { navigationType, info, destination }))
  }
}

describe('browserRouterEnv() and the Navigation API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers no Navigation API where the browser has none (jsdom)', () => {
    expect('navigation' in globalThis).toBe(false)
    expect(browserRouterEnv().navigation).toBeUndefined()
  })

  it('feature-detects on read, and honours { navigation: false }', () => {
    const env = browserRouterEnv()
    const forcedOff = browserRouterEnv({ navigation: false })
    expect(env.navigation).toBeUndefined()
    const fake = new FakeNavigation()
    vi.stubGlobal('navigation', fake)
    expect(env.navigation?.currentKey).toBe('entry-1')
    expect(forcedOff.navigation).toBeUndefined()
    // A document that is not fully active reads every key as ''.
    fake.currentEntry = { key: '' }
    expect(env.navigation?.currentKey).toBeNull()
    // A document with no current entry (opaque origin, not fully active) has
    // nothing to name a destination by.
    fake.currentEntry = null
    expect(browserRouterEnv().navigation).toBeUndefined()
  })

  it('forwards traverseTo with the info, and absorbs a traversal that cannot happen', async () => {
    const fake = new FakeNavigation()
    vi.stubGlobal('navigation', fake)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      fake.result = {
        committed: Promise.reject(new Error('InvalidStateError')),
        finished: Promise.reject(new Error('InvalidStateError')),
      }
      browserRouterEnv().navigation!.traverseTo('entry-0', 'llui-router:x')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fake.calls).toEqual([{ key: 'entry-0', options: { info: 'llui-router:x' } }])
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('maps navigate events, with a destination key only for a traversal', () => {
    const fake = new FakeNavigation()
    vi.stubGlobal('navigation', fake)
    const seen: RouterNavigateEvent[] = []
    const unsubscribe = browserRouterEnv().navigation!.onNavigate((event) => seen.push(event))
    fake.announce({ navigationType: 'traverse', destination: { key: 'k' }, info: 'mine' })
    fake.announce({ navigationType: 'push', destination: { key: '' }, info: undefined })
    unsubscribe()
    fake.announce({ navigationType: 'traverse', destination: { key: 'late' }, info: undefined })
    expect(seen).toEqual([
      { navigationType: 'traverse', destinationKey: 'k', info: 'mine' },
      { navigationType: 'push', destinationKey: null, info: undefined },
    ])
  })
})
