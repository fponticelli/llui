import { describe, it } from 'vitest'
import {
  component,
  mountApp,
  text,
  div,
  button,
  ul,
  li,
  each,
  show,
  branch,
} from '../../src/signals/authoring'
import { derived } from '../../src/signals/handle'

// Type-level guards for the AUTHORING surface — `pnpm check` is the assertion.
// These mirror exactly what an example file writes; if they type-check, example
// files type-check. (Never executed — the helpers throw if run uncompiled.)

interface Todo {
  id: number
  title: string
  done: boolean
}
type View = { type: 'empty' } | { type: 'list'; visible: Todo[] }
interface State {
  count: number
  user: { name: string; email?: string }
  todos: Todo[]
  view: View
  busy: boolean
}
type Msg = { type: 'inc' } | { type: 'set'; todos: Todo[] } | { type: 'save'; v: string }

describe('authoring surface types', () => {
  it('compiles a full-coverage component', () => {
    const _ = () =>
      component<State, Msg>({
        init: () => ({
          count: 0,
          user: { name: '' },
          todos: [],
          view: { type: 'empty' },
          busy: false,
        }),
        update: (s, m) => {
          if (m.type === 'inc') return [{ ...s, count: s.count + 1 }, []]
          if (m.type === 'set') return [{ ...s, todos: m.todos }, []]
          return s
        },
        view: ({ state, send }) => [
          // .at() leaf + .map() transform in a text slot
          text(state.at('count').map((c) => String(c))),
          // .at deep path, nullable bubbles
          text(state.at('user.name')),
          // reactive attribute + event handler + handler peek
          div({ class: state.at('busy').map((b) => (b ? 'spin' : 'idle')) }, [
            button({ onClick: () => send({ type: 'save', v: state.at('user.name').peek() }) }, [
              text('Save'),
            ]),
          ]),
          // derived across independent signals
          text(derived([state.at('count'), state.at('user.name')], (c, n) => `${n}: ${c}`)),
          // show with a mapped condition
          show(
            state.at('count').map((c) => c > 0),
            () => [text('positive')],
          ),
          // show with a narrowed then-arm + an else arm (binary)
          show(
            state.at('user.email'),
            (email) => [text(email)], // email: Signal<string> (NonNullable)
            () => [text('no email')],
          ),
          // each keyed rows reading the item signal
          ul({}, [
            each(state.at('todos'), {
              key: (t) => t.id,
              render: (item) => [li({}, [text(item.at('title'))])],
            }),
          ]),
          // branch over a discriminated union: each arm gets the NARROWED variant
          branch(state.at('view'), (v) => v.type, {
            empty: () => [text('no todos')],
            // v: Signal<{ type: 'list'; visible: Todo[] }> — variant-only field reads
            list: (v) => [text(v.at('visible').map((vs) => `${vs.length} todos`))],
          }),
          // branch (2-arg plain form): key by a string signal's value, no narrowing
          branch(state.at('user.name'), {
            '': () => [text('anonymous')],
          }),
        ],
      })
    void _
  })

  it('mountApp accepts the component def', () => {
    const _ = () => {
      const App = component<{ n: number }, { type: 'x' }>({
        init: () => ({ n: 0 }),
        update: (s) => s,
        view: ({ state }) => [text(state.at('n').map(String))],
      })
      mountApp(document.createElement('div'), App)
    }
    void _
  })

  it('rejects an invalid .at path', () => {
    const _ = () =>
      component<State, Msg>({
        init: () => ({
          count: 0,
          user: { name: '' },
          todos: [],
          view: { type: 'empty' },
          busy: false,
        }),
        update: (s) => s,
        // @ts-expect-error — 'nope' is not a key of State
        view: ({ state }) => [text(state.at('nope'))],
      })
    void _
  })
})
