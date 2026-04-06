/**
 * Task 04 — Async Data Fetch (Tier 3)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each, show } from '@llui/dom'
import { handleEffects, http, type ApiError } from '@llui/effects'

type Item = { id: number; name: string }

type State = {
  phase: 'loading' | 'success' | 'error'
  items: Item[]
  errorMsg: string
}

type Msg =
  | { type: 'fetchSuccess'; payload: Item[] }
  | { type: 'fetchError'; error: ApiError }
  | { type: 'retry' }

type Effect = { type: 'http' }

function fetchItems() {
  return http({
    url: '/api/items',
    onSuccess: (data) => ({ type: 'fetchSuccess' as const, payload: data as Item[] }),
    onError: (error) => ({ type: 'fetchError' as const, error }),
  })
}

export const AsyncFetch = component<State, Msg, Effect>({
  name: 'AsyncFetch',
  init: () => [{ phase: 'loading', items: [], errorMsg: '' }, [fetchItems()]],
  update: (state, msg) => {
    switch (msg.type) {
      case 'fetchSuccess':
        return [{ ...state, phase: 'success', items: msg.payload }, []]
      case 'fetchError':
        return [{ ...state, phase: 'error', errorMsg: String(msg.error.kind) }, []]
      case 'retry':
        return [{ ...state, phase: 'loading', errorMsg: '' }, [fetchItems()]]
    }
  },
  view: ({ send, show, each }) => [
    div({ class: 'async-fetch' }, [
      ...show({
        when: (s) => s.phase === 'loading',
        render: () => [div({ class: 'spinner' }, [text('Loading...')])],
      }),
      ...show({
        when: (s) => s.phase === 'error',
        render: () => [
          div({ class: 'error' }, [
            text((s: State) => `Error: ${s.errorMsg}`),
            button({ onClick: () => send({ type: 'retry' }) }, [text('Retry')]),
          ]),
        ],
      }),
      ...show({
        when: (s) => s.phase === 'success',
        render: () => [
          ...each({
            items: (s) => s.items,
            key: (item) => item.id,
            render: ({ item }) => [div({ class: 'item' }, [text(item((t) => t.name))])],
          }),
        ],
      }),
    ]),
  ],
  onEffect: handleEffects<Effect>().else(() => {
    // No custom effects
  }),
})
