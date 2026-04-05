/**
 * Task 04 — Async Data Fetch (Tier 3)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each, show } from '@llui/dom'
import { handleEffects, http } from '@llui/effects'

type Item = { id: number; name: string }

type State = {
  phase: 'loading' | 'success' | 'error'
  items: Item[]
  errorMsg: string
}

type Msg =
  | { type: 'fetchSuccess'; payload: Item[] }
  | { type: 'fetchError'; error: string }
  | { type: 'retry' }

type Effect = { type: 'http'; url: string; onSuccess: string; onError: string }

export const AsyncFetch = component<State, Msg, Effect>({
  name: 'AsyncFetch',
  init: () => [
    { phase: 'loading', items: [], errorMsg: '' },
    [http({ url: '/api/items', onSuccess: 'fetchSuccess', onError: 'fetchError' })],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'fetchSuccess':
        return [{ ...state, phase: 'success', items: msg.payload }, []]
      case 'fetchError':
        return [{ ...state, phase: 'error', errorMsg: String(msg.error) }, []]
      case 'retry':
        return [
          { ...state, phase: 'loading', errorMsg: '' },
          [http({ url: '/api/items', onSuccess: 'fetchSuccess', onError: 'fetchError' })],
        ]
    }
  },
  view: (send, { show, each }) => [
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
