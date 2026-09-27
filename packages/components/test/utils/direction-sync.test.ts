import { afterEach, describe, expect, it, vi } from 'vitest'
import { component, div, mountApp } from '@llui/dom'
import { directionSyncMount } from '../../src/utils/direction'

interface State {
  dir: 'ltr' | 'rtl'
}

type Msg = { type: 'sync'; dir: 'ltr' | 'rtl' }

const apps: Array<ReturnType<typeof mountApp<State, Msg>>> = []

afterEach(() => {
  for (const app of apps.splice(0)) app.dispose()
  document.body.replaceChildren()
})

function mountDirection(container: Element, id: string): ReturnType<typeof mountApp<State, Msg>> {
  const app = mountApp(
    container,
    component<State, Msg>({
      name: 'ScopedDirectionObserver',
      init: () => [{ dir: 'ltr' }, []],
      update: (state, msg) => [{ ...state, dir: msg.dir }, []],
      view: ({ send }) => [
        div({ id }, [directionSyncMount(id, (dir) => send({ type: 'sync', dir }))]),
      ],
    }),
  )
  apps.push(app)
  return app
}

describe('directionSyncMount scope and observation', () => {
  it('resolves duplicate ids independently inside two shadow-root builds', async () => {
    const rtlHost = document.createElement('div')
    const ltrHost = document.createElement('div')
    rtlHost.dir = 'rtl'
    ltrHost.dir = 'ltr'
    document.body.append(rtlHost, ltrHost)
    const rtlContainer = document.createElement('div')
    const ltrContainer = document.createElement('div')
    rtlHost.attachShadow({ mode: 'open' }).append(rtlContainer)
    ltrHost.attachShadow({ mode: 'open' }).append(ltrContainer)

    const rtl = mountDirection(rtlContainer, 'same-direction-root')
    const ltr = mountDirection(ltrContainer, 'same-direction-root')

    await vi.waitFor(() => {
      expect(rtl.getState().dir).toBe('rtl')
      expect(ltr.getState().dir).toBe('ltr')
    })
  })

  it('rewires the exact ancestor chain when a shadow-root component is relocated', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const left = document.createElement('div')
    left.dir = 'ltr'
    const right = document.createElement('div')
    right.dir = 'rtl'
    const container = document.createElement('div')
    left.append(container)
    shadow.append(left, right)
    const app = mountDirection(container, 'relocated-direction-root')
    const root = shadow.getElementById('relocated-direction-root')!

    right.append(root)

    await vi.waitFor(() => expect(app.getState().dir).toBe('rtl'))
  })

  it('observes only scoped ancestors without full-subtree document watches', () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const container = document.createElement('div')
    document.body.append(container)
    mountDirection(container, 'localized-direction-root')

    expect(observe).toHaveBeenCalled()
    expect(observe.mock.calls.every(([, options]) => options?.subtree !== true)).toBe(true)
    expect(observe.mock.calls.some(([target]) => target === document.documentElement)).toBe(true)
    observe.mockRestore()
  })
})
