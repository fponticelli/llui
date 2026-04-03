import { div, input, form, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'
import { routing } from '../router'

export function header(_s: State, send: Send<Msg>): HTMLElement {
  return div({ class: 'header' }, [
    routing.link(send, { page: 'search', q: '', p: 1, data: { type: 'idle' } }, {}, [text('GitHub Explorer')]),
    div({ class: 'search' }, [
      form({
        onSubmit: (e: Event) => { e.preventDefault(); send({ type: 'submitSearch' }) },
      }, [
        input({
          type: 'text',
          placeholder: 'Search repositories...',
          value: (s: State) => s.query,
          onInput: (e: Event) => send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
        }),
      ]),
    ]),
  ])
}
