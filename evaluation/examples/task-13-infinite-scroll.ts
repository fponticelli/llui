/**
 * Task 13 — Infinite Scroll (Tier 4)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each, show } from '@llui/dom'
import { handleEffects, http } from '@llui/effects'

type Item = { id: number; title: string }

type State = {
  items: Item[]
  page: number
  loading: boolean
  exhausted: boolean
}

type Msg =
  | { type: 'loadMore' }
  | { type: 'loadSuccess'; payload: Item[] }
  | { type: 'loadError'; error: unknown }

type Effect = { type: 'http'; url: string; onSuccess: string; onError: string }

const PAGE_SIZE = 20

export const InfiniteScroll = component<State, Msg, Effect>({
  name: 'InfiniteScroll',
  init: () => [
    { items: [], page: 0, loading: true, exhausted: false },
    [http({ url: '/api/items?page=0&size=20', onSuccess: 'loadSuccess', onError: 'loadError' })],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'loadMore':
        if (state.loading || state.exhausted) return [state, []]
        return [
          { ...state, loading: true },
          [
            http({
              url: `/api/items?page=${state.page + 1}&size=${PAGE_SIZE}`,
              onSuccess: 'loadSuccess',
              onError: 'loadError',
            }),
          ],
        ]
      case 'loadSuccess':
        return [
          {
            ...state,
            items: [...state.items, ...msg.payload],
            page: state.page + 1,
            loading: false,
            exhausted: msg.payload.length < PAGE_SIZE,
          },
          [],
        ]
      case 'loadError':
        return [{ ...state, loading: false }, []]
    }
  },
  view: (send) => [
    div({ class: 'infinite-scroll' }, [
      ...each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [
          div(
            {
              class: 'item',
              'data-testid': item((t) => String(t.id)),
            },
            [text(item((t) => t.title))],
          ),
        ],
      }),
      ...show<State>({
        when: (s) => s.loading,
        render: () => [div({ class: 'loading' }, [text('Loading...')])],
      }),
      ...show<State>({
        when: (s) => s.exhausted,
        render: () => [div({ class: 'exhausted' }, [text('No more items')])],
      }),
      ...show<State>({
        when: (s) => !s.loading && !s.exhausted,
        render: () => [
          button(
            {
              class: 'load-more',
              onClick: () => send({ type: 'loadMore' }),
            },
            [text('Load more')],
          ),
        ],
      }),
    ]),
  ],
  onEffect: handleEffects<Effect>().else(() => {
    // No custom effects
  }),
})
