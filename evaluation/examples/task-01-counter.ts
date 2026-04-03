/**
 * Task 01 — Counter (Tier 1)
 * Idiomatic score: 6/6
 */
import { component, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }
type Effect = never

export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: (_state, send) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})
