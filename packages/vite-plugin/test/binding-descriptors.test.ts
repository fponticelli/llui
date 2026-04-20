import { describe, it, expect } from 'vitest'
import { extractBindingDescriptors } from '../src/binding-descriptors.js'

describe('extractBindingDescriptors', () => {
  it('extracts send({type: "..."}) calls from a component view', () => {
    const source = `
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ send, text }) => [
    div({}, [
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      button({ onClick: () => send({ type: 'reset' }) }, [text('reset')]),
    ]),
  ],
})
`
    const result = extractBindingDescriptors(source)
    expect(result).toEqual([
      { variant: 'inc' },
      { variant: 'dec' },
      { variant: 'reset' },
    ])
  })
})
