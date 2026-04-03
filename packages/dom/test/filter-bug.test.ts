import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import { div, span, a, ul, li } from '../src/elements'
import type { ComponentDef } from '../src/types'

describe('filter highlight', () => {
  it('updates class binding inside show() render', () => {
    type State = { filter: 'all' | 'active' }
    type Msg = { type: 'setFilter'; filter: State['filter'] }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'F',
      init: () => [{ filter: 'all' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setFilter': return [{ ...state, filter: msg.filter }, []]
        }
      },
      view: (_state, send) => {
        sendFn = send
        return show<State>({
          when: () => true,
          render: () => [
            a({ class: (s: State) => s.filter === 'all' ? 'selected' : '', 'data-f': 'all' }),
            a({ class: (s: State) => s.filter === 'active' ? 'selected' : '', 'data-f': 'active' }),
          ],
        })
      },
      __dirty: (o, n) => Object.is(o.filter, n.filter) ? 0 : 1,
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const allLink = container.querySelector('[data-f="all"]')!
    const activeLink = container.querySelector('[data-f="active"]')!

    expect(allLink.className).toBe('selected')
    expect(activeLink.className).toBe('')

    sendFn!({ type: 'setFilter', filter: 'active' })
    handle.flush()

    expect(allLink.className).toBe('')
    expect(activeLink.className).toBe('selected')
  })
})
