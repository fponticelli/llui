// Signals showcase — Counter.
//
// Covers: state.at() leaf, .map() transform in a text slot, reactive attribute,
// event handlers, show() (conditional mount), effects-as-data (update returns
// effects -> onEffect), and a handler reading current state via .peek().

import { component, div, button, span, text, show } from '@llui/dom'

interface State {
  count: number
  /** a tiny audit log appended to by an effect */
  beeps: number[]
}

type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Decrement the counter (not below zero)") */
  | { type: 'dec' }
  /** @intent("Reset the counter to zero") */
  | { type: 'reset' }
  | { type: 'beeped'; at: number }

/** emitted when the count crosses into positive territory */
type Effect = { type: 'beep'; at: number }

export const Counter = component<State, Msg, Effect>({
  init: () => ({ count: 0, beeps: [] }),

  update: (s, m) => {
    switch (m.type) {
      case 'inc':
        return [{ ...s, count: s.count + 1 }, s.count === 0 ? [{ type: 'beep', at: 1 }] : []]
      case 'dec':
        return [{ ...s, count: Math.max(0, s.count - 1) }, []]
      case 'reset':
        return [{ ...s, count: 0 }, []]
      case 'beeped':
        return [{ ...s, beeps: [...s.beeps, m.at] }, []]
    }
  },

  onEffect: (e, api) => {
    if (e.type === 'beep') api.send({ type: 'beeped', at: e.at })
  },

  view: ({ state, send }) => [
    div({ class: state.at('count').map((c) => (c > 0 ? 'counter active' : 'counter')) }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('−')]),
      span({ class: 'value' }, [text(state.at('count').map((c) => String(c)))]),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    // conditional: the reset button only exists when count > 0
    show(
      state.at('count').map((c) => c > 0),
      () => [
        button(
          {
            class: 'reset',
            // handler reads the CURRENT count at click time via .peek()
            onClick: () => {
              if (state.at('count').peek() > 0) send({ type: 'reset' })
            },
          },
          [text('Reset')],
        ),
      ],
    ),
  ],
})
