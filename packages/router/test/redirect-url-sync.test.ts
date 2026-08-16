import { component, mountApp, text } from '@llui/dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter, type RouterEnv } from '../src/connect'
import { createRouter, route, type RouteLocation } from '../src/index'

// Browser-driven redirects replace the entry the browser landed on. This keeps
// the address bar, dispatched location, stack position, and later restores in
// agreement without truncating forward history.
const registry = {
  home: route('/'),
  admin: route('/admin'),
  login: route('/login'),
  other: route('/other'),
  article: route('/article/:slug'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>

const LOGIN: Location = { name: 'login', params: {} }
const HOME: Location = { name: 'home', params: {} }
const hashRouter = () => createRouter(registry)
const historyRouter = () => createRouter(registry, { mode: 'history' })
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

async function waitForUrl(read: () => string, expected: string): Promise<string> {
  const deadline = Date.now() + 2000
  while (read() !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  return read()
}

function mountListener(routing: ReturnType<typeof connectRouter<Registry>>) {
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'RedirectUrlSyncHost',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [...routing.listener(send), text('')],
  })
  const handle = mountApp(container, App)
  return { send, dispose: () => handle.dispose() }
}

function ownStamp(state: unknown, index: number): Record<string, unknown> {
  const run =
    state !== null && typeof state === 'object'
      ? (state as Record<string, unknown>)['__llui_run']
      : null
  return typeof run === 'string' ? { __llui_idx: index, __llui_run: run } : { __llui_idx: index }
}

function navigate(
  routing: ReturnType<typeof connectRouter<Registry>>,
  destination: ['home' | 'admin' | 'login' | 'other'] | ['article', { slug: string }],
): void {
  const effect =
    destination[0] === 'article'
      ? routing.navigate('article', destination[1])
      : routing.navigate(destination[0])
  routing.handleEffect({ effect, send: vi.fn(), signal: new AbortController().signal })
}

describe('#143 browser-driven redirect URL synchronization', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/')
    location.hash = ''
    await settle()
  })

  it('history mode replaces the guarded landing and dispatches its named target', async () => {
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (guardOn && to.name === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, ['admin'])
    navigate(routing, ['other'])
    guardOn = true
    send.mockClear()

    history.back()
    expect(await waitForUrl(() => location.pathname, '/login')).toBe('/login')
    expect(send).toHaveBeenCalledWith({ type: 'navigate', location: LOGIN })
    dispose()
  })

  it('history mode preserves length and the forward entry', async () => {
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => (guardOn && to.name === 'admin' ? LOGIN : undefined),
    })
    const { dispose } = mountListener(routing)

    navigate(routing, ['admin'])
    navigate(routing, ['other'])
    const lengthBefore = history.length
    guardOn = true

    history.back()
    expect(await waitForUrl(() => location.pathname, '/login')).toBe('/login')
    expect(history.length).toBe(lengthBefore)
    history.forward()
    expect(await waitForUrl(() => location.pathname, '/other')).toBe('/other')
    dispose()
  })

  it('history mode keeps a later blocked back reachable from the rewritten entry', async () => {
    let guardOn = false
    const routing = connectRouter(historyRouter(), {
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.name === 'admin') return LOGIN
        if (to.name === 'other') return false
        return undefined
      },
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, ['other'])
    navigate(routing, ['admin'])
    navigate(routing, ['article', { slug: 'x' }])
    guardOn = true
    send.mockClear()

    history.back()
    expect(await waitForUrl(() => location.pathname, '/login')).toBe('/login')

    history.back()
    expect(await waitForUrl(() => location.pathname, '/other')).toBe('/other')
    expect(await waitForUrl(() => location.pathname, '/login')).toBe('/login')
    expect(send).toHaveBeenCalledTimes(1)

    history.back()
    expect(await waitForUrl(() => location.pathname, '/other')).toBe('/other')
    expect(await waitForUrl(() => location.pathname, '/login')).toBe('/login')
    expect(send).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('hash mode replaces the landing, dispatches once, and preserves length', async () => {
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => (guardOn && to.name === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, ['admin'])
    navigate(routing, ['other'])
    await settle()
    guardOn = true
    send.mockClear()
    const lengthBefore = history.length

    history.back()
    expect(await waitForUrl(() => location.hash, '#/login')).toBe('#/login')
    await settle()

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({ type: 'navigate', location: LOGIN })
    expect(history.length).toBe(lengthBefore)
    dispose()
  })

  it('hash mode preserves both the later blocked back and forward entry', async () => {
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.name === 'admin') return LOGIN
        if (to.name === 'other') return false
        return undefined
      },
    })
    const { dispose } = mountListener(routing)

    navigate(routing, ['other'])
    navigate(routing, ['admin'])
    navigate(routing, ['article', { slug: 'x' }])
    await settle()
    guardOn = true

    history.back()
    expect(await waitForUrl(() => location.hash, '#/login')).toBe('#/login')
    history.back()
    expect(await waitForUrl(() => location.hash, '#/other')).toBe('#/other')
    expect(await waitForUrl(() => location.hash, '#/login')).toBe('#/login')
    history.forward()
    expect(await waitForUrl(() => location.hash, '#/article/x')).toBe('#/article/x')
    dispose()
  })
})

interface Recorded {
  env: RouterEnv
  calls: string[]
  land(state: unknown, url: string): void
  grow(): void
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
      return () => handlers.splice(handlers.indexOf(entry), 1)
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
      for (const { event, handler } of handlers) if (event === 'popstate') handler()
      if (fragmentChanged) {
        for (const { event, handler } of handlers) {
          if (event === 'hashchange') handler(landedHash)
        }
      }
      observedHash = hash
    },
  }
}

describe('#143 redirect mechanism at the environment seam', () => {
  it('writes nothing when an unchanged browser navigation is allowed', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), { env: rec.env })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '/other')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'other', params: {} },
    })
    dispose()
  })

  it('history mode performs one replace and preserves landed state and length', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.name === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)
    const lengthBefore = rec.env.historyLength

    rec.land({ __llui_idx: 3, host: 'keep' }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual(['replaceState:/login'])
    expect(rec.env.pathname).toBe('/login')
    expect(rec.env.historyState).toEqual({ __llui_idx: 3, host: 'keep' })
    expect(rec.env.historyLength).toBe(lengthBefore)
    expect(send).toHaveBeenCalledWith({ type: 'navigate', location: LOGIN })
    dispose()
  })

  it('hash mode performs one replace, never a pushing setHash', () => {
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.name === 'admin' ? LOGIN : undefined),
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
    expect(send).toHaveBeenCalledOnce()
    dispose()
  })

  it('arms no echo suppression for replaceState', () => {
    const rec = recordingEnv({ hash: '#/' })
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.name === 'admin' ? LOGIN : undefined),
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '#/admin')
    rec.fire()
    expect(send).toHaveBeenCalledOnce()

    rec.land({ __llui_idx: 4 }, '#/login')
    rec.fire()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ type: 'navigate', location: LOGIN })
    dispose()
  })

  it('rewrites an unknown-position entry without inventing an index', () => {
    const rec = recordingEnv({ pathname: '/' })
    let redirect = true
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        if (redirect) return to.name === 'admin' ? LOGIN : undefined
        return to.name === 'article' ? false : undefined
      },
    })
    const { dispose } = mountListener(routing)

    rec.land(null, '/admin')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual(['replaceState:/login'])
    expect(rec.env.historyState).toBeNull()

    redirect = false
    rec.land({ __llui_idx: 5 }, '/article/x')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual([])
    dispose()
  })

  it('leaves a later unstamped hash landing unknown despite foreign stack growth', () => {
    const rec = recordingEnv({ hash: '#/' })
    let guardOn = false
    const routing = connectRouter(hashRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        if (!guardOn) return undefined
        if (to.name === 'admin') return LOGIN
        if (to.name === 'article') return false
        return undefined
      },
    })
    const { dispose } = mountListener(routing)

    navigate(routing, ['admin'])
    rec.fire()
    navigate(routing, ['other'])
    rec.fire()
    rec.grow()
    guardOn = true

    rec.land({ __llui_idx: 1 }, '#/admin')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual(['replaceState:#/login'])

    rec.land(null, '#/other')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual([])
    expect(rec.env.historyState).toBeNull()

    rec.land({ __llui_idx: 0 }, '#/article/x')
    rec.calls.length = 0
    rec.fire()
    expect(rec.calls).toEqual([])
    dispose()
  })

  it('restores a blocked stamped landing only through history.go', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.name === 'admin' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, ['other'])
    rec.land(ownStamp(rec.env.historyState, 0), '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls.filter((call) => call.startsWith('replaceState'))).toEqual([])
    expect(rec.calls.some((call) => call.startsWith('go:'))).toBe(true)
    expect(rec.env.pathname).toBe('/admin')
    expect(send).not.toHaveBeenCalled()
    dispose()
  })

  it('settles listener redirect chains before one final URL write and dispatch', () => {
    const rec = recordingEnv({ pathname: '/' })
    const seen: Location[] = []
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => {
        seen.push(to)
        if (to.name === 'admin') return LOGIN
        if (to.name === 'login') return HOME
        return undefined
      },
    })
    const { send, dispose } = mountListener(routing)

    rec.land({ __llui_idx: 3 }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(seen).toEqual([{ name: 'admin', params: {} }, LOGIN, HOME])
    expect(rec.calls).toEqual(['replaceState:/'])
    expect(rec.env.pathname).toBe('/')
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({ type: 'navigate', location: HOME })
    dispose()
  })

  it.each([['history', '/admin'] as const, ['hash', '#/admin'] as const])(
    'skips a same-URL guard redirect in %s mode',
    (mode, url) => {
      const rec = recordingEnv(mode === 'hash' ? { hash: '#/' } : { pathname: '/' })
      const router = mode === 'hash' ? hashRouter() : historyRouter()
      const routing = connectRouter(router, {
        env: rec.env,
        beforeEnter: (to) => (to.name === 'admin' ? { name: 'admin', params: {} } : undefined),
      })
      const { send, dispose } = mountListener(routing)

      rec.land({ __llui_idx: 3, host: 'keep' }, url)
      rec.calls.length = 0
      rec.fire()

      expect(rec.calls).toEqual([])
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'admin', params: {} },
      })
      dispose()
    },
  )

  it('still writes a redirect whose canonical URL moves in both modes', () => {
    const historyRecord = recordingEnv({ pathname: '/' })
    const historyRouting = connectRouter(historyRouter(), {
      env: historyRecord.env,
      beforeEnter: (to) => (to.name === 'admin' ? LOGIN : undefined),
    })
    const historyHost = mountListener(historyRouting)
    historyRecord.land({ __llui_idx: 3 }, '/admin')
    historyRecord.calls.length = 0
    historyRecord.fire()
    expect(historyRecord.calls).toEqual(['replaceState:/login'])
    historyHost.dispose()

    const hashRecord = recordingEnv({ hash: '#/' })
    const hashRouting = connectRouter(hashRouter(), {
      env: hashRecord.env,
      beforeEnter: (to) => (to.name === 'admin' ? LOGIN : undefined),
    })
    const hashHost = mountListener(hashRouting)
    hashRecord.land({ __llui_idx: 3 }, '#/admin')
    hashRecord.calls.length = 0
    hashRecord.fire()
    expect(hashRecord.calls).toEqual(['replaceState:#/login'])
    hashHost.dispose()
  })

  it('does not rewind onto an entry numbered outside the current run', () => {
    const rec = recordingEnv({ pathname: '/' })
    const routing = connectRouter(historyRouter(), {
      env: rec.env,
      beforeEnter: (to) => (to.name === 'admin' ? false : undefined),
    })
    const { send, dispose } = mountListener(routing)

    navigate(routing, ['other'])
    rec.land({ __llui_idx: 0 }, '/admin')
    rec.calls.length = 0
    rec.fire()

    expect(rec.calls).toEqual([])
    expect(rec.env.pathname).toBe('/admin')
    expect(send).not.toHaveBeenCalled()
    dispose()
  })
})
