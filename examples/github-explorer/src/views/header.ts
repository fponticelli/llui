import { div, input, form, text } from '@llui/dom'
import type { Msg } from '../types'
import type { Send, Signal, Mountable } from '@llui/dom'
import { routing } from '../router'

export function header(query: Signal<string>, send: Send<Msg>): Mountable {
  return div({ class: 'header' }, [
    routing.link(send, { page: 'search', q: '', p: 1, data: { type: 'idle' } }, {}, [
      text('GitHub Explorer'),
    ]),
    div({ class: 'search' }, [
      form(
        {
          onSubmit: (e: Event) => {
            e.preventDefault()
            send({ type: 'submitSearch' })
          },
        },
        [
          input({
            type: 'text',
            placeholder: 'Search repositories...',
            'data-agent': 'search-input',
            value: query,
            onInput: (e: Event) =>
              send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
          }),
        ],
      ),
    ]),
  ])
}
