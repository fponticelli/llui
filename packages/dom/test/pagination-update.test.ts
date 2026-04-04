import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text, button, branch, each, flush } from '../src/index'

/**
 * Reproduces: pagination text inside a branch case doesn't update
 * when state changes but branch discriminant stays the same.
 */
describe('text binding updates inside stable branch case', () => {
  type State = {
    route: {
      page: 'search'
      p: number
      data:
        | { type: 'idle' }
        | { type: 'loading'; stale?: { items: string[] } }
        | { type: 'success'; data: { items: string[] } }
    }
  }
  type Msg = { type: 'nextPage' } | { type: 'loaded'; items: string[] }

  it('updates page number text when p changes in route', () => {
    let sendFn: (msg: Msg) => void

    const App = component<State, Msg, never>({
      name: 'PagTest',
      init: () => [
        { route: { page: 'search', p: 1, data: { type: 'success', data: { items: ['a', 'b'] } } } },
        [],
      ],
      update: (s, msg) => {
        switch (msg.type) {
          case 'nextPage': {
            const r = s.route
            if (r.data.type !== 'success') return [s, []]
            return [
              { route: { ...r, p: r.p + 1, data: { type: 'loading', stale: r.data.data } } },
              [],
            ]
          }
          case 'loaded':
            return [
              { route: { ...s.route, data: { type: 'success', data: { items: msg.items } } } },
              [],
            ]
        }
      },
      view: (send) => {
        sendFn = send
        return branch<State, Msg>({
          on: (s) => {
            const r = s.route
            if (r.data.type === 'loading' && !r.data.stale) return 'loading'
            if (r.data.type === 'success' || (r.data.type === 'loading' && r.data.stale))
              return 'results'
            return 'empty'
          },
          cases: {
            loading: () => [text('Loading...')],
            empty: () => [text('No results')],
            results: (send) => [
              div({ class: 'items' }, [
                ...each<State, string, Msg>({
                  items: (s) => {
                    const r = s.route
                    if (r.data.type === 'success') return r.data.data.items
                    if (r.data.type === 'loading' && r.data.stale) return r.data.stale.items
                    return []
                  },
                  key: (item) => item,
                  render: ({ item }) => [text(item((i) => i))],
                }),
              ]),
              div({ class: 'page-info' }, [text((s: State) => `Page ${s.route.p}`)]),
              button({ class: 'next', onClick: () => send({ type: 'nextPage' }) }, [text('Next')]),
            ],
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.route, n.route) ? 0 : 1),
    })

    const container = document.createElement('div')
    mountApp(container, App)

    // Initial: Page 1
    expect(container.querySelector('.page-info')!.textContent).toBe('Page 1')

    // Click next — p becomes 2, data becomes loading with stale
    sendFn!({ type: 'nextPage' })
    flush()
    expect(container.querySelector('.page-info')!.textContent).toBe('Page 2')

    // Data loads — p still 2
    sendFn!({ type: 'loaded', items: ['c', 'd'] })
    flush()
    expect(container.querySelector('.page-info')!.textContent).toBe('Page 2')

    // Click next again — p becomes 3
    sendFn!({ type: 'nextPage' })
    flush()
    expect(container.querySelector('.page-info')!.textContent).toBe('Page 3')
  })
})
