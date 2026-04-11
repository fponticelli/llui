/**
 * Task 10 — Parent-Child Communication Level 1 (Tier 5)
 * Idiomatic score: 6/6
 */
import { component, div, button } from '@llui/dom'
import type { Send, ItemAccessor, View } from '@llui/dom'

// ── Counter slice view function (Level 1) ───────────────────────

type CounterSlice = { id: number; value: number }
type CounterMsg = { type: 'increment'; id: number }

function counterView<S>(
  props: { item: ItemAccessor<CounterSlice> },
  send: Send<CounterMsg>,
  text: View<S, CounterMsg>['text'],
): Node[] {
  return [
    div({ class: 'counter-slice' }, [
      text(props.item((c) => String(c.value))),
      button(
        {
          onClick: () => send({ type: 'increment', id: props.item.id() }),
        },
        [text('+')],
      ),
    ]),
  ]
}

// ── Parent component ────────────────────────────────────────────

type State = {
  counters: CounterSlice[]
  nextId: number
}

type Msg = { type: 'increment'; id: number } | { type: 'addCounter' }

type Effect = never

const total = (s: State) => s.counters.reduce((sum, c) => sum + c.value, 0)

export const ParentChild = component<State, Msg, Effect>({
  name: 'ParentChild',
  init: () => [{ counters: [{ id: 1, value: 0 }], nextId: 2 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'increment':
        return [
          {
            ...state,
            counters: state.counters.map((c) =>
              c.id === msg.id ? { ...c, value: c.value + 1 } : c,
            ),
          },
          [],
        ]
      case 'addCounter':
        return [
          {
            ...state,
            counters: [...state.counters, { id: state.nextId, value: 0 }],
            nextId: state.nextId + 1,
          },
          [],
        ]
    }
  },
  view: ({ send, text, each }) => [
    div({ class: 'parent' }, [
      text((s) => `Total: ${total(s)}`),
      button({ onClick: () => send({ type: 'addCounter' }) }, [text('Add counter')]),
      ...each({
        items: (s) => s.counters,
        key: (c) => c.id,
        render: (r) => counterView({ item: r.item }, r.send, text),
      }),
    ]),
  ],
})
