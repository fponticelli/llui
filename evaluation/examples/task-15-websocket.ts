/**
 * Task 15 — WebSocket Real-Time Updates (Tier 5)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each, show } from '@llui/dom'

type Item = { id: number; content: string }

type State = {
  items: Item[]
  paused: boolean
  buffer: Item[]
}

type Msg = { type: 'receive'; item: Item } | { type: 'pause' } | { type: 'resume' }

type Effect = { type: 'ws-connect'; url: string } | { type: 'ws-disconnect' }

const MAX_ITEMS = 50

function prependAndLimit(items: Item[], newItem: Item): Item[] {
  const result = [newItem, ...items]
  return result.length > MAX_ITEMS ? result.slice(0, MAX_ITEMS) : result
}

export const WebSocketList = component<State, Msg, Effect>({
  name: 'WebSocketList',
  init: () => [
    { items: [], paused: false, buffer: [] },
    [{ type: 'ws-connect', url: 'wss://example.com/feed' }],
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
    }
  },
  view: (send) => [
    div({ class: 'websocket-list' }, [
      div({ class: 'controls' }, [
        ...show<State>({
          when: (s) => !s.paused,
          render: () => [
            button(
              {
                onClick: () => send({ type: 'pause' }),
              },
              [text('Pause')],
            ),
          ],
        }),
        ...show<State>({
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
        ...show<State>({
          when: (s) => s.paused && s.buffer.length > 0,
          render: () => [text((s: State) => `(${s.buffer.length} buffered)`)],
        }),
      ]),
      ...each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [
          div(
            {
              class: 'item',
              'data-testid': item((t) => String(t.id)),
            },
            [text(item((t) => t.content))],
          ),
        ],
      }),
    ]),
  ],
  onEffect: (effect, send, signal) => {
    switch (effect.type) {
      case 'ws-connect': {
        const ws = new WebSocket(effect.url)
        ws.onmessage = (event) => {
          const item = JSON.parse(event.data) as Item
          send({ type: 'receive', item })
        }
        signal.addEventListener('abort', () => ws.close())
        break
      }
      case 'ws-disconnect':
        break
    }
  },
})
