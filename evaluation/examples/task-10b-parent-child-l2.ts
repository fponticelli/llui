/**
 * Task 10b — Parent-Child Communication Level 2 (Tier 5)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, each, child } from '@llui/dom'

// ── Child component (Level 2) ──────────────────────────────────

type ChildState = { id: number; value: number }

type ChildMsg = { type: 'increment' } | { type: 'propsChanged'; id: number; value: number }

type ChildEffect = never

const CounterChild = component<ChildState, ChildMsg, ChildEffect>({
  name: 'CounterChild',
  init: () => [{ id: 0, value: 0 }, []],
  propsMsg: (props: { id: number; value: number }) => ({
    type: 'propsChanged' as const,
    id: props.id,
    value: props.value,
  }),
  update: (state, msg) => {
    switch (msg.type) {
      case 'increment':
        return [{ ...state, value: state.value + 1 }, []]
      case 'propsChanged':
        return [{ ...state, id: msg.id, value: msg.value }, []]
    }
  },
  view: (send, { each }) => [
    div({ class: 'counter-child' }, [
      text((s: ChildState) => String(s.value)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ]),
  ],
})

// ── Parent component ────────────────────────────────────────────

type CounterEntry = { id: number; value: number }

type ParentState = {
  counters: CounterEntry[]
  nextId: number
  total: number
}

type ParentMsg = { type: 'addCounter' } | { type: 'childIncremented'; id: number }

type ParentEffect = never

export const ParentChildL2 = component<ParentState, ParentMsg, ParentEffect>({
  name: 'ParentChildL2',
  init: () => [{ counters: [{ id: 1, value: 0 }], nextId: 2, total: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'addCounter':
        return [
          {
            ...state,
            counters: [...state.counters, { id: state.nextId, value: 0 }],
            nextId: state.nextId + 1,
          },
          [],
        ]
      case 'childIncremented': {
        const counters = state.counters.map((c) =>
          c.id === msg.id ? { ...c, value: c.value + 1 } : c,
        )
        return [
          {
            ...state,
            counters,
            total: counters.reduce((sum, c) => sum + c.value, 0),
          },
          [],
        ]
      }
    }
  },
  view: (send) => [
    div({ class: 'parent' }, [
      text((s: ParentState) => `Total: ${s.total}`),
      button({ onClick: () => send({ type: 'addCounter' }) }, [text('Add counter')]),
      ...each<ParentState, CounterEntry>({
        items: (s) => s.counters,
        key: (c) => c.id,
        render: ({ item }) => [
          ...child<ParentState, ChildState, ChildMsg, ChildEffect>({
            def: CounterChild,
            key: item.id(),
            props: (s) => {
              const c = s.counters.find((x) => x.id === item.id())!
              return { id: c.id, value: c.value }
            },
            onMsg: (childMsg) => {
              if (childMsg.type === 'increment') {
                return { type: 'childIncremented', id: item.id() }
              }
              return null
            },
          }),
        ],
      }),
    ]),
  ],
})
