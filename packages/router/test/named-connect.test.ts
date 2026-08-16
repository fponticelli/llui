import { component, mountApp, text } from '@llui/dom'
import { describe, expect, it, vi } from 'vitest'
import {
  connectRouter,
  type ConnectedRouter,
  type RouterEffect,
  type RouterEnv,
} from '../src/connect'
import {
  createRouter,
  route,
  routeCodec,
  type RouteLocation,
  type StandardSchemaV1,
} from '../src/index'

const integerSchema: StandardSchemaV1<string, number> = {
  '~standard': {
    version: 1,
    vendor: 'integer-fixture',
    validate: (value) => {
      const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
      return Number.isSafeInteger(number)
        ? { value: number }
        : { issues: [{ message: 'Expected an integer' }] }
    },
  },
}

const integer = routeCodec(integerSchema, String)
const registry = {
  home: route('/'),
  user: route('/users/:id', { params: { id: integer } }),
  login: route('/login'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>

class TestEnv implements RouterEnv {
  hash: string
  pathname: string
  search = ''
  historyState: unknown = null
  historyLength = 1
  readonly writes: Array<{ action: string; url?: string }> = []
  readonly handlers = new Map<'popstate' | 'hashchange', Set<(hash?: string) => void>>()

  constructor(input: string, mode: 'hash' | 'history' = 'hash') {
    this.hash = mode === 'hash' ? input : ''
    this.pathname = mode === 'history' ? input : '/'
  }

  setHash(hash: string): void {
    this.hash = hash
    this.writes.push({ action: 'hash', url: hash })
  }

  pushState(state: unknown, url: string): void {
    this.historyState = state
    this.applyUrl(url)
    this.writes.push({ action: 'push', url })
  }

  replaceState(state: unknown, url?: string): void {
    this.historyState = state
    if (url !== undefined) this.applyUrl(url)
    this.writes.push({ action: 'replace', url })
  }

  back(): void {
    this.writes.push({ action: 'back' })
  }

  forward(): void {
    this.writes.push({ action: 'forward' })
  }

  go(delta: number): void {
    this.writes.push({ action: `go:${delta}` })
  }

  scrollTo(x: number, y: number): void {
    this.writes.push({ action: `scroll:${x},${y}` })
  }

  onUrlChange(event: 'popstate' | 'hashchange', handler: (newHash?: string) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
    return () => handlers.delete(handler)
  }

  emit(event: 'popstate' | 'hashchange'): void {
    for (const handler of this.handlers.get(event) ?? []) handler(this.hash)
  }

  private applyUrl(url: string): void {
    if (url.startsWith('#')) this.hash = url
    else {
      const parsed = new URL(url, 'https://example.test')
      this.pathname = parsed.pathname
      this.search = parsed.search
    }
  }
}

function mountListener(
  renderable: ReturnType<ReturnType<typeof connectRouter<Registry>>['listener']>,
) {
  const container = document.createElement('div')
  const App = component({
    name: 'RouterListenerTest',
    init: () => [null, []] as const,
    update: (state: null) => [state, []] as const,
    view: () => [...renderable, text('ready')],
  })
  return mountApp(container, App)
}

function runEffect<NavigateMessage, UnmatchedMessage>(
  routing: ConnectedRouter<Registry, NavigateMessage, UnmatchedMessage>,
  effect: RouterEffect,
  send = vi.fn(),
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
  return send
}

function withView(run: () => void): void {
  const container = document.createElement('div')
  const App = component({
    name: 'RouterViewTest',
    init: () => [null, []] as const,
    update: (state: null) => [state, []] as const,
    view: () => {
      run()
      return [text('ready')]
    },
  })
  mountApp(container, App).dispose()
}

describe('connected named routes', () => {
  it('uses the same typed destination to create normalized effects', () => {
    const env = new TestEnv('#/')
    const routing = connectRouter(createRouter(registry), { env })
    expect(routing.push('user', { id: 42 })).toEqual({
      type: '__router',
      action: 'push',
      path: '#/users/42',
      location: { name: 'user', params: { id: 42 } },
    })
  })

  it('makes navigation to the current canonical location a full no-op', () => {
    const env = new TestEnv('#/users/42')
    const beforeEnter = vi.fn<(to: Location) => void>()
    const routing = connectRouter(createRouter(registry), { env, beforeEnter })
    env.writes.length = 0
    const send = runEffect(routing, routing.navigate('user', { id: 42 }))
    expect(beforeEnter).not.toHaveBeenCalled()
    expect(env.writes).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it('canonicalizes a browser URL only after guards accept and dispatches once', () => {
    const env = new TestEnv('#/users/0042')
    const beforeEnter = vi.fn<(to: Location) => void>()
    const routing = connectRouter(createRouter(registry), { env, beforeEnter })
    const send = vi.fn()
    const mounted = mountListener(routing.listener(send))
    env.writes.length = 0
    env.emit('popstate')
    expect(beforeEnter).toHaveBeenCalledOnce()
    expect(env.writes).toEqual([{ action: 'replace', url: '#/users/42' }])
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'user', params: { id: 42 } },
    })
    mounted.dispose()
  })

  it('emits an explicit unmatched event with the original browser URL', () => {
    const env = new TestEnv('#/does-not-exist?kept=yes')
    const routing = connectRouter(createRouter(registry), { env })
    const send = vi.fn()
    const mounted = mountListener(routing.listener(send))
    env.writes.length = 0
    env.emit('popstate')
    expect(send).toHaveBeenCalledWith({ type: 'unmatched', url: '#/does-not-exist?kept=yes' })
    expect(env.writes).toEqual([])
    mounted.dispose()
  })

  it('emits unmatched when a codec formatter cannot reproduce the matched value', () => {
    const decimalSchema: StandardSchemaV1<string, number> = {
      '~standard': {
        version: 1,
        vendor: 'lossy-fixture',
        validate: (value) =>
          typeof value === 'string' && Number.isFinite(Number(value))
            ? { value: Number(value) }
            : { issues: [{ message: 'number required' }] },
      },
    }
    const lossy = routeCodec(decimalSchema, (value) => String(Math.trunc(value)))
    const env = new TestEnv('#/values/1.5')
    const routing = connectRouter(
      createRouter({ value: route('/values/:value', { params: { value: lossy } }) }),
      { env },
    )
    env.writes.length = 0
    const send = vi.fn()
    const mounted = mountListener(routing.listener(send))
    env.emit('popstate')
    expect(send).toHaveBeenCalledWith({ type: 'unmatched', url: '#/values/1.5' })
    expect(env.writes).toEqual([])
    mounted.dispose()
  })

  it('does not offer a codec result with non-serializable round-trip output to browser guards', () => {
    const asymmetricSchema: StandardSchemaV1<string, { value: string }> = {
      '~standard': {
        version: 1,
        vendor: 'asymmetric-fixture',
        validate: (input) => {
          const value = { value: 'semantic' }
          if (input === 'canonical') Object.defineProperty(value, 'hidden', { value: true })
          return { value }
        },
      },
    }
    const asymmetric = routeCodec(asymmetricSchema, () => 'canonical')
    const env = new TestEnv('#/values/source')
    const beforeEnter = vi.fn()
    const routing = connectRouter(
      createRouter({ value: route('/values/:value', { params: { value: asymmetric } }) }),
      { env, beforeEnter },
    )
    env.writes.length = 0
    const send = vi.fn()
    const mounted = mountListener(routing.listener(send))

    expect(() => env.emit('popstate')).toThrow(/serializable.*value/i)
    expect(beforeEnter).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(env.writes).toEqual([])
    mounted.dispose()
  })

  it('uses configurable navigation and unmatched messages at every connector boundary', () => {
    const env = new TestEnv('#/users/%ZZ')
    const routing = connectRouter(createRouter(registry), {
      env,
      navigateMsg: (location) => ({ type: 'changed', location }),
      unmatchedMsg: (url) => ({ type: 'not-found', url }),
    })
    const send = vi.fn()
    runEffect(routing, routing.navigate('user', { id: 5 }), send)
    expect(send).toHaveBeenCalledWith({
      type: 'changed',
      location: { name: 'user', params: { id: 5 } },
    })

    env.hash = '#/users/%ZZ'
    const mounted = mountListener(routing.listener(send))
    env.emit('popstate')
    expect(send).toHaveBeenCalledWith({ type: 'not-found', url: '#/users/%ZZ' })
    mounted.dispose()
  })

  it('retains redirect chaining with normalized named locations', () => {
    const env = new TestEnv('#/')
    const router = createRouter(registry)
    const routing = connectRouter(router, {
      env,
      beforeEnter: (to) => {
        if (to.name === 'user') return router.location('login')
        if (to.name === 'login') return router.location('home')
        return undefined
      },
    })
    env.writes.length = 0
    const send = runEffect(routing, routing.navigate('user', { id: 7 }))
    expect(env.writes).toEqual([])
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'home', params: {} },
    })
  })

  it('runs beforeLeave once before the redirect chain and blocks before entry', () => {
    const env = new TestEnv('#/')
    const calls: string[] = []
    const routing = connectRouter(createRouter(registry), {
      env,
      beforeLeave: () => {
        calls.push('leave')
        return false
      },
      beforeEnter: () => {
        calls.push('enter')
      },
    })
    env.writes.length = 0
    const send = runEffect(routing, routing.navigate('user', { id: 1 }))
    expect(calls).toEqual(['leave'])
    expect(env.writes).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it('retains the ten-hop redirect bound with a descriptive warning', () => {
    const env = new TestEnv('#/')
    const router = createRouter({ step: route('/step/:id', { params: { id: integer } }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const routing = connectRouter(router, {
      env,
      beforeEnter: (to) => router.location('step', { id: to.params.id + 1 }),
    })
    routing.handleEffect({
      effect: routing.navigate('step', { id: 1 }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/redirected 10 times/))
    expect(env.hash).toBe('#/step/11')
    warn.mockRestore()
  })

  it('restores a blocked stamped traversal without pushing a replacement entry', () => {
    const env = new TestEnv('#/')
    let blockHome = false
    const routing = connectRouter(createRouter(registry), {
      env,
      beforeEnter: (to) => (blockHome && to.name === 'home' ? false : undefined),
    })
    const homeStamp = env.historyState
    runEffect(routing, routing.navigate('user', { id: 9 }))
    blockHome = true
    env.hash = '#/'
    env.historyState = homeStamp
    const send = vi.fn()
    const mounted = mountListener(routing.listener(send))
    env.writes.length = 0
    env.emit('popstate')
    expect(env.writes).toEqual([{ action: 'go:1' }])
    expect(send).not.toHaveBeenCalled()
    mounted.dispose()
  })

  it('keeps push/replace URL-only while navigate dispatches', () => {
    const env = new TestEnv('#/')
    const routing = connectRouter(createRouter(registry), { env })
    env.writes.length = 0
    const send = vi.fn()
    runEffect(routing, routing.push('user', { id: 1 }), send)
    expect(send).not.toHaveBeenCalled()
    runEffect(routing, routing.replace('user', { id: 2 }), send)
    expect(send).not.toHaveBeenCalled()
    runEffect(routing, routing.navigate('user', { id: 3 }), send)
    expect(send).toHaveBeenCalledOnce()
    expect(env.writes.flatMap((write) => (write.url === undefined ? [] : [write.url]))).toEqual([
      '#/users/1',
      '#/users/2',
      '#/users/3',
    ])
  })

  it('leaves modified and download link clicks to the browser', () => {
    const env = new TestEnv('#/')
    const routing = connectRouter(createRouter(registry), { env })
    withView(() => {
      const modifiedSend = vi.fn()
      const modified = routing.link(modifiedSend, 'user', { id: 1 }, {}, [text('user')]).mount()
      const modifiedClick = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        button: 0,
      })
      modified.dispatchEvent(modifiedClick)
      expect(modifiedClick.defaultPrevented).toBe(false)
      expect(modifiedSend).not.toHaveBeenCalled()

      const downloadSend = vi.fn()
      const download = routing
        .link(downloadSend, 'user', { id: 1 }, { download: '' }, [text('download')])
        .mount()
      const downloadClick = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      download.dispatchEvent(downloadClick)
      expect(downloadClick.defaultPrevented).toBe(false)
      expect(downloadSend).not.toHaveBeenCalled()
    })
  })

  it('makes a current-location link a guard/history/dispatch no-op', () => {
    const env = new TestEnv('#/')
    const beforeEnter = vi.fn<(to: Location) => void>()
    const routing = connectRouter(createRouter(registry), { env, beforeEnter })
    env.writes.length = 0
    withView(() => {
      const send = vi.fn()
      const link = routing.link(send, 'home', {}, [text('home')]).mount()
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      expect(beforeEnter).not.toHaveBeenCalled()
      expect(env.writes).toEqual([])
      expect(send).not.toHaveBeenCalled()
    })
  })
})
