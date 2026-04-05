/**
 * Task 08 — Reorderable List (Tier 4)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each } from '@llui/dom'

type Item = { id: number; label: string }

type State = {
  items: Item[]
}

type Msg = { type: 'moveUp'; id: number } | { type: 'moveDown'; id: number }

type Effect = never

export const ReorderableList = component<State, Msg, Effect>({
  name: 'ReorderableList',
  init: () => [
    {
      items: [
        { id: 1, label: 'Item A' },
        { id: 2, label: 'Item B' },
        { id: 3, label: 'Item C' },
        { id: 4, label: 'Item D' },
        { id: 5, label: 'Item E' },
      ],
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'moveUp': {
        const idx = state.items.findIndex((i) => i.id === msg.id)
        if (idx <= 0) return [state, []]
        const items = [...state.items]
        ;[items[idx - 1], items[idx]] = [items[idx]!, items[idx - 1]!]
        return [{ ...state, items }, []]
      }
      case 'moveDown': {
        const idx = state.items.findIndex((i) => i.id === msg.id)
        if (idx === -1 || idx >= state.items.length - 1) return [state, []]
        const items = [...state.items]
        ;[items[idx], items[idx + 1]] = [items[idx + 1]!, items[idx]!]
        return [{ ...state, items }, []]
      }
    }
  },
  view: ({ send, each }) => [
    div({ class: 'reorderable-list' }, [
      ...each({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [
          div({ class: 'item', 'data-testid': item((t) => String(t.id)) }, [
            text(item((t) => t.label)),
            button(
              {
                onClick: () => send({ type: 'moveUp', id: item.id() }),
              },
              [text('Up')],
            ),
            button(
              {
                onClick: () => send({ type: 'moveDown', id: item.id() }),
              },
              [text('Down')],
            ),
          ]),
        ],
      }),
    ]),
  ],
})
