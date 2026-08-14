import { describe, it, expect, vi } from 'vitest'
import { createRouter, route, param } from '../src/index'
import { connectRouter, browserRouterEnv } from '../src/connect'
import type { RouterEnv } from '../src/connect'
import { mountApp, component, text } from '@llui/dom'

// Issue #111 (residual 2) — `connectRouter` reached for `location` / `history` /
// `window` directly, guarded in two places and unguarded in seven. Verified not
// to crash SSR today (`@llui/vike` dispatches init() effects on the CLIENT, and
// `link()`/`href()` are pure), so this is design debt rather than a live defect
// — but the fix is the same one `@llui/dom`'s `dom-env.ts` already models:
// inject the surface instead of reaching for the globals.

type Route = { page: 'home' } | { page: 'article'; slug: string }

function makeRouter(mode: 'hash' | 'history') {
  return createRouter<Route>(
    [
      route([], () => ({ page: 'home' })),
      route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
    ],
    { mode, fallback: { page: 'home' } },
  )
}

interface Recorded {
  env: RouterEnv
  calls: string[]
  handlers: Array<{ event: string; handler: () => void }>
}

/** A fully synthetic env — nothing here touches a browser global. */
function recordingEnv(initial?: { hash?: string; pathname?: string; search?: string }): Recorded {
  const calls: string[] = []
  const handlers: Array<{ event: string; handler: () => void }> = []
  let hash = initial?.hash ?? ''
  let pathname = initial?.pathname ?? '/'
  const search = initial?.search ?? ''
  let historyState: unknown = null

  const env: RouterEnv = {
    get hash() {
      return hash
    },
    get pathname() {
      return pathname
    },
    get search() {
      return search
    },
    get historyState() {
      return historyState
    },
    setHash(next) {
      calls.push(`setHash:${next}`)
      hash = next
    },
    replaceLocation(url) {
      calls.push(`replaceLocation:${url}`)
      hash = url
    },
    pushState(state, url) {
      calls.push(`pushState:${url}`)
      historyState = state
      pathname = url
    },
    replaceState(state, url) {
      calls.push(`replaceState:${url}`)
      historyState = state
      pathname = url
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
      calls.push(`subscribe:${event}`)
      return () => {
        handlers.splice(handlers.indexOf(entry), 1)
        calls.push(`unsubscribe:${event}`)
      }
    },
  }

  return { env, calls, handlers }
}

const signal = new AbortController().signal

describe('connectRouter routes history/location through an injectable env', () => {
  it('push goes through env.pushState in history mode', () => {
    const rec = recordingEnv()
    const routing = connectRouter(makeRouter('history'), { env: rec.env })
    routing.handleEffect({
      effect: routing.push({ page: 'article', slug: 'x' }),
      send: vi.fn(),
      signal,
    })
    expect(rec.calls).toEqual(['pushState:/article/x'])
  })

  it('replace goes through env.replaceState in history mode', () => {
    const rec = recordingEnv()
    const routing = connectRouter(makeRouter('history'), { env: rec.env })
    routing.handleEffect({ effect: routing.replace({ page: 'home' }), send: vi.fn(), signal })
    expect(rec.calls).toEqual(['replaceState:/'])
  })

  it('navigate pushes through the env AND dispatches', () => {
    const rec = recordingEnv()
    const routing = connectRouter(makeRouter('history'), { env: rec.env })
    const send = vi.fn()
    routing.handleEffect({ effect: routing.navigate({ page: 'article', slug: 'y' }), send, signal })
    expect(rec.calls).toEqual(['pushState:/article/y'])
    expect(send).toHaveBeenCalledWith({ type: 'navigate', route: { page: 'article', slug: 'y' } })
  })

  it('hash mode writes the hash through the env', () => {
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(makeRouter('hash'), { env: rec.env })
    routing.handleEffect({
      effect: routing.push({ page: 'article', slug: 'z' }),
      send: vi.fn(),
      signal,
    })
    expect(rec.calls).toEqual(['setHash:#/article/z'])
  })

  it('hash-mode replace goes through env.replaceLocation', () => {
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(makeRouter('hash'), { env: rec.env })
    routing.handleEffect({
      effect: routing.replace({ page: 'article', slug: 'z' }),
      send: vi.fn(),
      signal,
    })
    expect(rec.calls).toEqual(['replaceLocation:#/article/z'])
  })

  it('back / forward / scroll go through the env', () => {
    const rec = recordingEnv()
    const routing = connectRouter(makeRouter('history'), { env: rec.env })
    routing.handleEffect({ effect: routing.back(), send: vi.fn(), signal })
    routing.handleEffect({ effect: routing.forward(), send: vi.fn(), signal })
    routing.handleEffect({ effect: routing.scroll(10, 20), send: vi.fn(), signal })
    expect(rec.calls).toEqual(['back', 'forward', 'scrollTo:10,20'])
  })

  it('seeds the starting route from the env, not from the real location', () => {
    // The real jsdom location is `/`; the env says `/article/seeded`, and the
    // guard must see THAT as `from`.
    const rec = recordingEnv({ pathname: '/article/seeded' })
    const seen: Array<Route | null> = []
    const routing = connectRouter(makeRouter('history'), {
      env: rec.env,
      beforeEnter: (_to, from) => {
        seen.push(from)
      },
    })
    routing.handleEffect({ effect: routing.push({ page: 'home' }), send: vi.fn(), signal })
    expect(seen).toEqual([{ page: 'article', slug: 'seeded' }])
  })

  it('listener() subscribes and unsubscribes through the env', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(makeRouter('history'), { env: rec.env })
    const send = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(
      container,
      component<{ n: number }, { type: 'noop' }, never>({
        name: 'RouterEnvHost',
        init: () => ({ n: 0 }),
        update: (s) => [s, []],
        view: () => [text('x'), ...routing.listener(send)],
      }),
    )

    expect(rec.calls).toContain('subscribe:popstate')
    expect(rec.handlers).toHaveLength(1)

    // A browser-driven change delivered through the env's own subscription.
    rec.env.pushState(null, '/article/popped')
    rec.calls.length = 0
    rec.handlers[0]!.handler()
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      route: { page: 'article', slug: 'popped' },
    })

    app.dispose()
    expect(rec.calls).toContain('unsubscribe:popstate')
    document.body.removeChild(container)
  })

  it('a blocked browser-driven navigation rewinds through env.go', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(makeRouter('history'), {
      env: rec.env,
      // Blocks only the popped-to route, so the setup push still lands and
      // advances the index the rewind is measured against.
      beforeEnter: (to) => (to.page === 'article' ? false : undefined),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(
      container,
      component<{ n: number }, { type: 'noop' }, never>({
        name: 'RouterEnvGuardHost',
        init: () => ({ n: 0 }),
        update: (s) => [s, []],
        view: () => [text('x'), ...routing.listener(vi.fn())],
      }),
    )

    // Two of our own pushes, then a pop back to the first.
    routing.handleEffect({ effect: routing.push({ page: 'home' }), send: vi.fn(), signal })
    rec.env.pushState({ __llui_idx: 0 }, '/article/blocked')
    rec.calls.length = 0
    rec.handlers[0]!.handler()

    // The exact delta, not merely "a go happened": our own push took the index
    // to 1, the popped-to entry carries 0, so the rewind is exactly +1. What the
    // index arithmetic computes is the whole point of rewinding with `go` rather
    // than pushing (#111 residual 2 / finding 2c), and it is what the concurrent
    // #103 work changes — a `some(startsWith('go:'))` would not notice.
    expect(rec.calls).toEqual(['go:1'])
    app.dispose()
    document.body.removeChild(container)
  })
})

describe('browserRouterEnv()', () => {
  it('is the default and reads the real location', () => {
    history.replaceState(null, '', '/article/real')
    const routing = connectRouter(makeRouter('history'))
    const seen: Array<Route | null> = []
    const guarded = connectRouter(makeRouter('history'), {
      beforeEnter: (_to, from) => {
        seen.push(from)
      },
    })
    guarded.handleEffect({ effect: guarded.push({ page: 'home' }), send: vi.fn(), signal })
    expect(seen).toEqual([{ page: 'article', slug: 'real' }])
    expect(typeof routing.push).toBe('function')
    history.replaceState(null, '', '/')
  })

  it('constructs without touching the globals, so module load is DOM-free', () => {
    // The getters delegate lazily — the same contract `browserEnv()` keeps.
    expect(() => browserRouterEnv()).not.toThrow()
  })
})
