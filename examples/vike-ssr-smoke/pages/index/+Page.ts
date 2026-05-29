// Single counter component — exercises:
//   - reactive text binding (compiler imports `__bindUncertain`),
//   - static element subtree (`__cloneStaticTemplate`),
//   - send + onClick (compiler synthesizes `__handlers` → imports
//     `__runPhase2` + `__handleMsg`).
//
// Together those four imports are the exact set that broke production
// builds before issue #5's follow-up fix. The fixture's only purpose
// is to keep them in the emitted server bundle.
import { component, div, button, text } from '@llui/dom/signals'

type State = { count: number }
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Decrement the counter") */
  | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: state.count - 1 }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map((c) => String(c))),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})

export default Counter
