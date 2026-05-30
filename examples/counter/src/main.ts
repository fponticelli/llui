import { component, mountApp, div, button, text, show } from '@llui/dom'
import './styles.css'

type State = { count: number }
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Decrement the counter") */
  | { type: 'dec' }
  /** @intent("Reset the counter to 0") */
  | { type: 'reset' }

const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
      case 'reset':
        return [{ count: 0 }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    show(
      state.at('count').map((c) => c > 0),
      () => [button({ class: 'reset', onClick: () => send({ type: 'reset' }) }, [text('Reset')])],
    ),
  ],
})

mountApp(document.getElementById('app')!, Counter)
