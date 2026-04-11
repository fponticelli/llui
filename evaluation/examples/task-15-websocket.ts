/**
 * Task 15 — WebSocket Real-Time Updates (Tier 5)
 * Idiomatic score: 6/6
 */
import { component, div, button } from '@llui/dom'
import { handleEffects, websocket, cancel, type Effect } from '@llui/effects'

type Item = { id: number; content: string }

type State = {
  items: Item[]
  paused: boolean
  buffer: Item[]
}

type Msg =
  | { type: 'receive'; item: Item }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'wsError' }

const MAX_ITEMS = 50

function prependAndLimit(items: Item[], newItem: Item): Item[] {
  const result = [newItem, ...items]
  return result.length > MAX_ITEMS ? result.slice(0, MAX_ITEMS) : result
}

export const WebSocketList = component<State, Msg, Effect>({
  name: 'WebSocketList',
  init: () => [
    { items: [], paused: false, buffer: [] },
    [
      websocket({
        url: 'wss://example.com/feed',
        key: 'feed',
        onMessage: (data) => ({ type: 'receive' as const, item: data as Item }),
        onError: () => ({ type: 'wsError' as const }),
      }),
    ],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'receive':
        if (state.paused) {
          return [
            {
              ...state,
              buffer: [...state.buffer, msg.item],
            },
            [],
          ]
        }
        return [
          {
            ...state,
            items: prependAndLimit(state.items, msg.item),
          },
          [],
        ]
      case 'pause':
        return [{ ...state, paused: true }, []]
      case 'resume': {
        let items = state.items
        for (const buffered of state.buffer) {
          items = prependAndLimit(items, buffered)
        }
        return [{ ...state, paused: false, buffer: [], items }, []]
      }
      case 'wsError':
        return [state, []]
    }
  },
  view: ({ send, text, show, each }) => [
    div({ class: 'websocket-list' }, [
      div({ class: 'controls' }, [
        ...show({
          when: (s) => s.paused === false,
          render: () => [
            button(
              {
                onClick: () => send({ type: 'pause' }),
              },
              [text('Pause')],
            ),
          ],
        }),
        ...show({
          when: (s) => s.paused,
          render: () => [
            button(
              {
                onClick: () => send({ type: 'resume' }),
              },
              [text('Resume')],
            ),
          ],
        }),
        ...show({
          when: (s) => s.paused && s.buffer.length > 0,
          render: () => [text((s) => `(${s.buffer.length} buffered)`)],
        }),
      ]),
      ...each({
        items: (s) => s.items,
        key: (item) => item.id,
        render: (r) => [
          div(
            {
              class: 'item',
              'data-testid': r.item((t) => String(t.id)),
            },
            [text(r.item((t) => t.content))],
          ),
        ],
      }),
    ]),
  ],
  onEffect: handleEffects<Effect>().else((ctx) => {
    console.warn('Unhandled effect:', ctx.effect)
  }),
})
