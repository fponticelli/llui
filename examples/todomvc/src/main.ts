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
  text,
  each,
  show,
  footer,
  section,
  header,
  memo,
} from '@llui/dom'

type Todo = { id: number; text: string; completed: boolean }
type Filter = 'all' | 'active' | 'completed'

type State = {
  todos: Todo[]
  filter: Filter
  nextId: number
}

type Msg =
  | { type: 'add'; text: string }
  | { type: 'toggle'; id: number }
  | { type: 'remove'; id: number }
  | { type: 'toggleAll' }
  | { type: 'setFilter'; filter: Filter }
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
  view: (send) => {
    const filteredTodos = memo((s: State) => {
      switch (s.filter) {
        case 'all':
          return s.todos
        case 'active':
          return s.todos.filter((t) => !t.completed)
        case 'completed':
          return s.todos.filter((t) => t.completed)
      }
    })

    const activeCount = memo((s: State) => s.todos.filter((t) => !t.completed).length)
    const hasCompleted = memo((s: State) => s.todos.some((t) => t.completed))

    return [
      section({ class: 'todoapp' }, [
        header({}, [
          h1({}, [text('todos')]),
          input({
            class: 'new-todo',
            placeholder: 'What needs to be done?',
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                const inp = e.target as HTMLInputElement
                send({ type: 'add', text: inp.value })
                inp.value = ''
              }
            },
          }),
        ]),

        ...show<State>({
          when: (s) => s.todos.length > 0,
          render: () => [
            section({ class: 'main' }, [
              input({
                class: 'toggle-all',
                id: 'toggle-all',
                type: 'checkbox',
                checked: (s: State) => s.todos.every((t) => t.completed),
                onClick: () => send({ type: 'toggleAll' }),
              }),
              label({ for: 'toggle-all', class: 'toggle-all-label' }, [
                text('Mark all as complete'),
              ]),
              ul(
                { class: 'todo-list' },
                each<State, Todo>({
                  items: filteredTodos,
                  key: (t) => t.id,
                  render: ({ item }) => [
                    li(
                      {
                        class: item((t) => (t.completed ? 'completed' : '')),
                      },
                      [
                        input({
                          class: 'toggle',
                          type: 'checkbox',
                          checked: item((t) => t.completed),
                          onClick: () => send({ type: 'toggle', id: item((t) => t.id)() }),
                        }),
                        label({}, [text(item((t) => t.text))]),
                        button(
                          {
                            class: 'destroy',
                            onClick: () => send({ type: 'remove', id: item((t) => t.id)() }),
                          },
                          [text('×')],
                        ),
                      ],
                    ),
                  ],
                }),
              ),
            ]),

            footer({ class: 'footer' }, [
              span({ class: 'todo-count' }, [
                text((s: State) => {
                  const n = activeCount(s)
                  return `${n} item${n === 1 ? '' : 's'} left`
                }),
              ]),
              ul({ class: 'filters' }, [
                filterLink('all', 'All', send),
                filterLink('active', 'Active', send),
                filterLink('completed', 'Completed', send),
              ]),
              ...show<State>({
                when: hasCompleted,
                render: () => [
                  button(
                    {
                      class: 'clear-completed',
                      onClick: () => send({ type: 'clearCompleted' }),
                    },
                    [text('Clear completed')],
                  ),
                ],
              }),
            ]),
          ],
        }),
      ]),
    ]
  },
})

function filterLink(filter: Filter, linkLabel: string, send: (msg: Msg) => void): HTMLElement {
  return li({}, [
    a(
      {
        class: (s: State) => (s.filter === filter ? 'selected' : ''),
        onClick: (e: Event) => {
          e.preventDefault()
          send({ type: 'setFilter', filter })
        },
        href: '#',
      },
      [text(linkLabel)],
    ),
  ])
}

mountApp(document.getElementById('app')!, App)
