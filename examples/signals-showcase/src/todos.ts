// Signals showcase — Todos.
//
// Covers: each() keyed lists with per-row item signals, branch() over a
// discriminant, derived() across independent signals, nested deep .at() paths,
// reactive attributes per row, and a deferred (HTTP-style) effect.

import {
  component,
  div,
  ul,
  li,
  span,
  button,
  text,
  each,
  branch,
  derived,
} from '@llui/dom/signals'

interface Todo {
  id: number
  title: string
  done: boolean
}

interface State {
  todos: Todo[]
  filter: 'all' | 'active' | 'done'
  /** discriminant for the list region */
  view: 'empty' | 'list'
  loading: boolean
}

type Msg =
  /** @intent("Toggle a todo's done state") */
  | { type: 'toggle'; id: number }
  | { type: 'add'; title: string }
  | { type: 'loaded'; todos: Todo[] }

type Effect = { type: 'load' }

export const Todos = component<State, Msg, Effect>({
  init: () => [{ todos: [], filter: 'all', view: 'empty', loading: true }, [{ type: 'load' }]],

  update: (s, m) => {
    switch (m.type) {
      case 'toggle':
        return [
          {
            ...s,
            todos: s.todos.map((t) => (t.id === m.id ? { ...t, done: !t.done } : t)),
          },
          [],
        ]
      case 'add': {
        const todos = [...s.todos, { id: s.todos.length + 1, title: m.title, done: false }]
        return [{ ...s, todos, view: 'list' }, []]
      }
      case 'loaded':
        return [
          { ...s, todos: m.todos, loading: false, view: m.todos.length ? 'list' : 'empty' },
          [],
        ]
    }
  },

  onEffect: (e, api) => {
    if (e.type === 'load') {
      // imagine fetch(...) — resolve async, then feed state back through send
      queueMicrotask(() => api.send({ type: 'loaded', todos: [] }))
    }
  },

  view: ({ state, send }) => [
    // derived across two independent signals: "<done>/<total> done"
    div({ class: 'summary' }, [
      text(
        derived(
          [state.at('todos'), state.at('filter')],
          (todos, filter) =>
            `${todos.filter((t) => t.done).length}/${todos.length} done (${filter})`,
        ),
      ),
    ]),

    // branch over the list-region discriminant
    branch(state.at('view'), {
      empty: () => [div({ class: 'empty' }, [text('Nothing yet — add a todo.')])],
      list: () => [
        ul({ class: 'todos' }, [
          each(state.at('todos'), {
            key: (t) => t.id,
            render: (item) => [
              li({ class: item.at('done').map((d) => (d ? 'todo done' : 'todo')) }, [
                span({}, [text(item.at('title'))]),
                button({ onClick: () => send({ type: 'toggle', id: item.peek().id }) }, [
                  text(item.at('done').map((d) => (d ? '✓' : '○'))),
                ]),
              ]),
            ],
          }),
        ]),
      ],
    }),
  ],
})
