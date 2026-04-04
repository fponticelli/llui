import { component, mountApp, div, button, text, show } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

const Counter = component<State, Msg, never>({
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
  view: (send) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    ...show<State>({
      when: (s) => s.count > 0,
      render: () => [button({ onClick: () => send({ type: 'reset' }) }, [text('Reset')])],
    }),
  ],
})

mountApp(document.getElementById('app')!, Counter)
