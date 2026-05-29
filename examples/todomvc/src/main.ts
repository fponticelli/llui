import {
  component,
  mountApp,
  a,
  h1,
  input,
  ul,
  li,
  label,
  button,
  span,
  footer,
  section,
  header,
  text,
  show,
  each,
} from '@llui/dom/signals'

type Todo = { id: number; text: string; completed: boolean }
type Filter = 'all' | 'active' | 'completed'

type State = {
  todos: Todo[]
  filter: Filter
  nextId: number
}

type Msg =
  /**
   * @intent("Add a new to-do item with the given text")
   * @example({"type":"add","text":"Buy milk"})
   */
  | { type: 'add'; text: string }
  /**
   * @intent("Toggle the completion status of a to-do item")
   * @example({"type":"toggle","id":1})
   */
  | { type: 'toggle'; id: number }
  /**
   * @intent("Remove a to-do item by id")
   * @example({"type":"remove","id":1})
   */
  | { type: 'remove'; id: number }
  /** @intent("Toggle the completion status of all to-do items") */
  | { type: 'toggleAll' }
  /**
   * @intent("Set the visibility filter for the to-do list")
   * @example({"type":"setFilter","filter":"active"})
   */
  | { type: 'setFilter'; filter: Filter }
  /** @intent("Clear all completed to-do items") */
  | { type: 'clearCompleted' }

const initialTodos: Todo[] = [
  { id: 1, text: 'Learn LLui', completed: false },
  { id: 2, text: 'Build something awesome', completed: true },
  { id: 3, text: 'Profit', completed: false },
]

const App = component<State, Msg, never>({
  name: 'TodoMVC',
  init: () => [{ todos: initialTodos, filter: 'all', nextId: 4 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'add': {
        if (!msg.text.trim()) return [state, []]
        const todo: Todo = { id: state.nextId, text: msg.text.trim(), completed: false }
        return [{ ...state, todos: [...state.todos, todo], nextId: state.nextId + 1 }, []]
      }
      case 'toggle':
        return [
          {
            ...state,
            todos: state.todos.map((t) =>
              t.id === msg.id ? { ...t, completed: !t.completed } : t,
            ),
          },
          [],
        ]
      case 'remove':
        return [{ ...state, todos: state.todos.filter((t) => t.id !== msg.id) }, []]
      case 'toggleAll': {
        const allDone = state.todos.every((t) => t.completed)
        return [{ ...state, todos: state.todos.map((t) => ({ ...t, completed: !allDone })) }, []]
      }
      case 'setFilter':
        return [{ ...state, filter: msg.filter }, []]
      case 'clearCompleted':
        return [{ ...state, todos: state.todos.filter((t) => !t.completed) }, []]
    }
  },
  view: ({ state, send }) => [
    section({ class: 'todoapp' }, [
      header({}, [
        h1({}, [text('todos')]),
        input({
          class: 'new-todo',
          placeholder: 'What needs to be done?',
          onKeyDown: (e: Event) => {
            const ke = e as KeyboardEvent
            if (ke.key === 'Enter') {
              const inp = ke.target as HTMLInputElement
              send({ type: 'add', text: inp.value })
              inp.value = ''
            }
          },
        }),
      ]),

      show(
        state.at('todos').map((ts) => ts.length > 0),
        () => [
          section({ class: 'main' }, [
            input({
              class: 'toggle-all',
              id: 'toggle-all',
              type: 'checkbox',
              checked: state.at('todos').map((ts) => ts.every((t) => t.completed)),
              onClick: () => send({ type: 'toggleAll' }),
            }),
            label({ for: 'toggle-all', class: 'toggle-all-label' }, [text('Mark all as complete')]),
            ul({ class: 'todo-list' }, [
              each(
                state.map((s) =>
                  s.filter === 'active'
                    ? s.todos.filter((t) => !t.completed)
                    : s.filter === 'completed'
                      ? s.todos.filter((t) => t.completed)
                      : s.todos,
                ),
                {
                  key: (t) => t.id,
                  render: (item) => [
                    li(
                      {
                        class: item.at('completed').map((c) => (c ? 'completed' : '')),
                      },
                      [
                        input({
                          class: 'toggle',
                          type: 'checkbox',
                          checked: item.at('completed'),
                          onClick: () => send({ type: 'toggle', id: item.at('id').peek() }),
                        }),
                        label({}, [text(item.at('text'))]),
                        button(
                          {
                            class: 'destroy',
                            onClick: () => send({ type: 'remove', id: item.at('id').peek() }),
                          },
                          [text('×')],
                        ),
                      ],
                    ),
                  ],
                },
              ),
            ]),
          ]),

          footer({ class: 'footer' }, [
            span({ class: 'todo-count' }, [
              text(
                state.at('todos').map((ts) => {
                  const n = ts.filter((t) => !t.completed).length
                  return `${n} item${n === 1 ? '' : 's'} left`
                }),
              ),
            ]),
            ul({ class: 'filters' }, [
              li({}, [
                a(
                  {
                    class: state.at('filter').map((f) => (f === 'all' ? 'selected' : '')),
                    href: '#',
                    onClick: (e: Event) => {
                      e.preventDefault()
                      send({ type: 'setFilter', filter: 'all' })
                    },
                  },
                  [text('All')],
                ),
              ]),
              li({}, [
                a(
                  {
                    class: state.at('filter').map((f) => (f === 'active' ? 'selected' : '')),
                    href: '#',
                    onClick: (e: Event) => {
                      e.preventDefault()
                      send({ type: 'setFilter', filter: 'active' })
                    },
                  },
                  [text('Active')],
                ),
              ]),
              li({}, [
                a(
                  {
                    class: state.at('filter').map((f) => (f === 'completed' ? 'selected' : '')),
                    href: '#',
                    onClick: (e: Event) => {
                      e.preventDefault()
                      send({ type: 'setFilter', filter: 'completed' })
                    },
                  },
                  [text('Completed')],
                ),
              ]),
            ]),
            show(
              state.at('todos').map((ts) => ts.some((t) => t.completed)),
              () => [
                button(
                  {
                    class: 'clear-completed',
                    onClick: () => send({ type: 'clearCompleted' }),
                  },
                  [text('Clear completed')],
                ),
              ],
            ),
          ]),
        ],
      ),
    ]),
  ],
})

mountApp(document.getElementById('app')!, App)
