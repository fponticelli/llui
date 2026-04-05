/**
 * Task 02 — Character Counter (Tier 1)
 * Idiomatic score: 6/6
 */
import { component, div, textarea, text } from '@llui/dom'

type State = { content: string }
type Msg = { type: 'setContent'; value: string }
type Effect = never

export const CharCounter = component<State, Msg, Effect>({
  name: 'CharCounter',
  init: () => [{ content: '' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setContent':
        return [{ ...state, content: msg.value }, []]
    }
  },
  view: ({ send }) => [
    div({ class: 'char-counter' }, [
      textarea({
        onInput: (e: Event) =>
          send({ type: 'setContent', value: (e.target as HTMLTextAreaElement).value }),
      }),
      div(
        {
          class: (s: State) => (s.content.length > 260 ? 'counter over-limit' : 'counter'),
        },
        [text((s: State) => `${s.content.length} / 280`)],
      ),
    ]),
  ],
})
