import { component, mountApp, text } from '@llui/dom'
import { describe, expect, it, vi } from 'vitest'
import { connectRouter } from '../src/connect'
import { createRouter, route, type RouteLocation } from '../src/index'

const registry = {
  home: route('/'),
  article: route('/articles/:slug'),
}
type Location = RouteLocation<typeof registry>

describe('connected router surface', () => {
  const router = createRouter(registry)
  const routing = connectRouter(router)

  it('creates normalized destination and history utility effects', () => {
    expect(routing.push('article', { slug: 'hello' })).toEqual({
      type: '__router',
      action: 'push',
      path: '#/articles/hello',
      location: { name: 'article', params: { slug: 'hello' } },
    })
    expect(routing.replace('home')).toEqual({
      type: '__router',
      action: 'replace',
      path: '#/',
      location: { name: 'home', params: {} },
    })
    expect(routing.back()).toEqual({ type: '__router', action: 'back' })
    expect(routing.forward()).toEqual({ type: '__router', action: 'forward' })
    expect(routing.scroll(2, 3)).toEqual({ type: '__router', action: 'scroll', x: 2, y: 3 })
  })

  it('claims only router effects', () => {
    expect(
      routing.handleEffect({
        effect: routing.back(),
        send: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toBe(true)
    expect(
      routing.handleEffect({
        effect: { type: 'http' },
        send: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toBe(false)
  })

  it('creates an update handler over route locations and supports application redirects', () => {
    type State = { location: Location; visits: number }
    type Msg = { type: 'navigate'; location: Location } | { type: 'increment' }
    const handler = routing.createHandler<State, Msg, never>({
      getLocation: (message) => (message as { location: Location }).location,
      guard: (location) =>
        location.name === 'article' && location.params.slug === 'private'
          ? router.location('home')
          : location,
      onNavigate: (state, location) => [{ ...state, location }, []],
    })
    const state: State = { location: router.location('home'), visits: 0 }

    expect(
      handler(state, {
        type: 'navigate',
        location: router.location('article', { slug: 'private' }),
      })?.[0].location,
    ).toEqual({ name: 'home', params: {} })
    expect(handler(state, { type: 'increment' })).toBeNull()
  })

  it('renders name-specific hrefs and custom messages in history mode', () => {
    history.replaceState(null, '', '/')
    const historyRouting = connectRouter(createRouter(registry, { mode: 'history' }))
    const send = vi.fn()
    const container = document.createElement('div')
    const App = component({
      name: 'ConnectedRouterSurface',
      init: () => [null, []] as const,
      update: (state: null) => [state, []] as const,
      view: () => [
        historyRouting.link(
          send,
          'article',
          { slug: 'custom' },
          { class: 'route-link' },
          [text('open')],
          (location) => ({ type: 'goto', location }),
        ),
      ],
    })
    const mounted = mountApp(container, App)
    const anchor = container.querySelector('a')!

    expect(anchor.getAttribute('href')).toBe('/articles/custom')
    expect(anchor.className).toBe('route-link')
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(send).toHaveBeenCalledWith({
      type: 'goto',
      location: { name: 'article', params: { slug: 'custom' } },
    })
    mounted.dispose()
  })
})
