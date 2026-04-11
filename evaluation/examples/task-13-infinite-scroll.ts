/**
 * Task 13 — Infinite Scroll (Tier 4)
 * Idiomatic score: 6/6
 */
import { component, div, button } from '@llui/dom'
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

type Effect = { type: 'http' }

const PAGE_SIZE = 20

function loadPage(page: number) {
  return http({
    url: `/api/items?page=${page}&size=${PAGE_SIZE}`,
    onSuccess: (data) => ({ type: 'loadSuccess' as const, payload: data as Item[] }),
    onError: (err) => ({ type: 'loadError' as const, error: err }),
  })
}

export const InfiniteScroll = component<State, Msg, Effect>({
  name: 'InfiniteScroll',
  init: () => [{ items: [], page: 0, loading: true, exhausted: false }, [loadPage(0)]],
  update: (state, msg) => {
    switch (msg.type) {
      case 'loadMore':
        if (state.loading || state.exhausted) return [state, []]
        return [{ ...state, loading: true }, [loadPage(state.page + 1)]]
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
  view: ({ send, text, show, each }) => [
    div({ class: 'infinite-scroll' }, [
      ...each({
        items: (s) => s.items,
        key: (item) => item.id,
        render: (r) => [
          div(
            {
              class: 'item',
              'data-testid': r.item((t) => String(t.id)),
            },
            [text(r.item((t) => t.title))],
          ),
        ],
      }),
      ...show({
        when: (s) => s.loading,
        render: () => [div({ class: 'loading' }, [text('Loading...')])],
      }),
      ...show({
        when: (s) => s.exhausted,
        render: () => [div({ class: 'exhausted' }, [text('No more items')])],
      }),
      ...show({
        when: (s) => s.loading === false && s.exhausted === false,
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
  onEffect: handleEffects<Effect>().else((ctx) => {
    console.warn('Unhandled effect:', ctx.effect)
  }),
})
