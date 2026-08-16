import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter } from '../src/connect'
import { createRouter, route, type RouteLocation } from '../src/index'

const registry = {
  home: route('/'),
  admin: route('/admin'),
  login: route('/login'),
  article: route('/article/:slug'),
}

type Location = RouteLocation<typeof registry>

function makeRouter() {
  return createRouter(registry, { mode: 'history' })
}

function run(
  effect: ReturnType<ReturnType<typeof connectRouter<typeof registry>>['navigate']>,
  routing: ReturnType<typeof connectRouter<typeof registry>>,
  send = vi.fn(),
) {
  routing.handleEffect({ effect, send, signal: new AbortController().signal })
  return send
}

describe('named route guards', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it('passes normalized locations to beforeEnter and accepts a void verdict', () => {
    const beforeEnter = vi.fn()
    const routing = connectRouter(makeRouter(), { beforeEnter })
    const push = vi.spyOn(history, 'pushState')

    run(routing.push('admin'), routing)

    expect(beforeEnter).toHaveBeenCalledWith(
      { name: 'admin', params: {} },
      { name: 'home', params: {} },
    )
    expect(push).toHaveBeenCalledWith(expect.any(Object), '', '/admin')
    push.mockRestore()
  })

  it('blocks before writing history and runs beforeLeave before beforeEnter', () => {
    const beforeEnter = vi.fn()
    const beforeLeave = vi.fn(() => false)
    const routing = connectRouter(makeRouter(), { beforeEnter, beforeLeave })
    const push = vi.spyOn(history, 'pushState')

    run(routing.push('admin'), routing)

    expect(beforeLeave).toHaveBeenCalledWith(
      { name: 'home', params: {} },
      { name: 'admin', params: {} },
    )
    expect(beforeEnter).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })

  it.each(['push', 'replace', 'navigate'] as const)(
    '%s follows every redirect to its accepted fixed point',
    (action) => {
      const router = makeRouter()
      const seen: Location[] = []
      const routing = connectRouter(router, {
        beforeEnter: (to) => {
          seen.push(to)
          if (to.name === 'admin') return router.location('login')
          if (to.name === 'login') return router.location('home')
          return undefined
        },
      })
      const send = vi.fn()

      run(routing[action]('admin'), routing, send)

      expect(seen).toEqual([
        { name: 'admin', params: {} },
        { name: 'login', params: {} },
        { name: 'home', params: {} },
      ])
      expect(location.pathname).toBe('/')
      expect(send).toHaveBeenCalledWith({
        type: 'navigate',
        location: { name: 'home', params: {} },
      })
    },
  )

  it('lets a later redirect verdict block the whole navigation', () => {
    const router = makeRouter()
    const seen: Location[] = []
    const routing = connectRouter(router, {
      beforeEnter: (to) => {
        seen.push(to)
        if (to.name === 'admin') return router.location('login')
        if (to.name === 'login') return false
        return undefined
      },
    })
    const push = vi.spyOn(history, 'pushState')
    const send = run(routing.navigate('admin'), routing)

    expect(seen).toEqual([
      { name: 'admin', params: {} },
      { name: 'login', params: {} },
    ])
    expect(push).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/')
    push.mockRestore()
  })

  it('asks beforeLeave once about the originally requested location and keeps from stable', () => {
    const router = makeRouter()
    const left: Array<[Location, Location]> = []
    const froms: Array<Location | null> = []
    const routing = connectRouter(router, {
      beforeLeave: (from, to) => {
        left.push([from, to])
        return true
      },
      beforeEnter: (to, from) => {
        froms.push(from)
        if (to.name === 'admin') return router.location('login')
        if (to.name === 'login') return router.location('article', { slug: 'x' })
        return undefined
      },
    })

    run(routing.navigate('admin'), routing)

    expect(left).toEqual([
      [
        { name: 'home', params: {} },
        { name: 'admin', params: {} },
      ],
    ])
    expect(froms).toEqual([
      { name: 'home', params: {} },
      { name: 'home', params: {} },
      { name: 'home', params: {} },
    ])
  })

  it('settles an equivalent redirect after one verdict', () => {
    const router = makeRouter()
    const beforeEnter = vi.fn((to: Location) =>
      to.name === 'admin' ? router.location('admin') : undefined,
    )
    const routing = connectRouter(router, { beforeEnter })
    const send = run(routing.navigate('admin'), routing)

    expect(beforeEnter).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'admin', params: {} },
    })
  })

  it('lands on the tenth redirect hop and warns when a chain never settles', () => {
    const router = makeRouter()
    const seen: Location[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const routing = connectRouter(router, {
      beforeEnter: (to) => {
        seen.push(to)
        return to.name === 'admin' ? router.location('login') : router.location('admin')
      },
    })
    const send = run(routing.navigate('admin'), routing)

    expect(seen).toHaveLength(10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redirected 10 times'))
    expect(send).toHaveBeenCalledOnce()
    expect(location.pathname).toBe('/admin')
    warn.mockRestore()
  })
})
