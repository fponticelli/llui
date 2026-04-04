/**
 * Task 03 — Filterable List (Tier 2)
 * Idiomatic score: 6/6
 */
import { component, div, input, text, each, memo } from '@llui/dom'

type Item = { id: number; text: string }

type State = {
  query: string
  items: Item[]
}

type Msg = { type: 'setQuery'; value: string }
type Effect = never

const ITEMS: Item[] = [
  { id: 1, text: 'Apple' },
  { id: 2, text: 'Banana' },
  { id: 3, text: 'Cantaloupe' },
  { id: 4, text: 'Dragonfruit' },
  { id: 5, text: 'Elderberry' },
  { id: 6, text: 'Fig' },
  { id: 7, text: 'Grape' },
  { id: 8, text: 'Honeydew' },
  { id: 9, text: 'Jackfruit' },
  { id: 10, text: 'Kiwi' },
]

const filteredItems = memo((s: State) => {
  const q = s.query.toLowerCase()
  return q === '' ? s.items : s.items.filter((i) => i.text.toLowerCase().includes(q))
})

export const FilterableList = component<State, Msg, Effect>({
  name: 'FilterableList',
  init: () => [{ query: '', items: ITEMS }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setQuery':
        return [{ ...state, query: msg.value }, []]
    }
  },
  view: (send) => [
    div({ class: 'filterable-list' }, [
      input({
        type: 'text',
        placeholder: 'Filter...',
        onInput: (e: Event) =>
          send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
      }),
      ...each<State, Item>({
        items: filteredItems,
        key: (item) => item.id,
        render: ({ item }) => [
          div({ class: 'item', 'data-testid': 'item' }, [text(item((t) => t.text))]),
        ],
      }),
    ]),
  ],
})
