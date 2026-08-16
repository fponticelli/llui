import { component, mountApp, text } from '@llui/dom'
import { describe, expect, it, vi } from 'vitest'
import { connectRouter } from '../src/connect'
import { createRouter, route } from '../src/index'

const registry = {
  home: route('/'),
  repo: route('/:owner/:repo'),
}

describe('browser traversal does not push a second entry', () => {
  it('keeps explicit push effects for user-initiated navigation', () => {
    const routing = connectRouter(createRouter(registry, { mode: 'history' }))
    expect(routing.push('repo', { owner: 'grafana', repo: 'tempo' }).path).toBe('/grafana/tempo')
  })

  it('dispatches a matched location from popstate without calling pushState', () => {
    history.replaceState(null, '', '/')
    const routing = connectRouter(createRouter(registry, { mode: 'history' }))
    const send = vi.fn()
    const container = document.createElement('div')
    const App = component({
      name: 'PopstateListener',
      init: () => [null, []] as const,
      update: (state: null) => [state, []] as const,
      view: () => [...routing.listener(send), text('ready')],
    })
    const mounted = mountApp(container, App)
    const push = vi.spyOn(history, 'pushState')

    history.replaceState(history.state, '', '/grafana/tempo')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))

    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'repo', params: { owner: 'grafana', repo: 'tempo' } },
    })
    expect(push).not.toHaveBeenCalled()

    push.mockRestore()
    mounted.dispose()
  })
})
