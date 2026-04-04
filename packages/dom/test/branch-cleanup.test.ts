import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

describe('branch cleanup with template-cloned nodes', () => {
  it('removes all old content when switching arms — including static subtrees', () => {
    type State = { page: 'a' | 'b' | 'c' }
    type Msg = { type: 'go'; page: State['page'] }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Pages',
      init: () => [{ page: 'a' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'go':
            return [{ ...state, page: msg.page }, []]
        }
      },
      view: (send) => {
        sendFn = send
        return branch<State>({
          on: (s) => s.page,
          cases: {
            a: (_send) => [
              div({ class: 'page-a' }, [text('Page A')]),
              div({}, [text('A content')]),
            ],
            b: (_send) => [
              div({ class: 'page-b' }, [text('Page B')]),
              div({}, [text('B content')]),
            ],
            c: (_send) => [div({ class: 'page-c' }, [text('Page C')])],
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.page, n.page) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(container.querySelector('.page-a')).not.toBeNull()
    expect(container.textContent).toContain('Page A')
    expect(container.textContent).toContain('A content')

    // Switch to B
    sendFn!({ type: 'go', page: 'b' })
    handle.flush()

    expect(container.querySelector('.page-a')).toBeNull()
    expect(container.querySelector('.page-b')).not.toBeNull()
    expect(container.textContent).toContain('Page B')
    expect(container.textContent).not.toContain('Page A')
    expect(container.textContent).not.toContain('A content')

    // Switch to C
    sendFn!({ type: 'go', page: 'c' })
    handle.flush()

    expect(container.querySelector('.page-b')).toBeNull()
    expect(container.querySelector('.page-c')).not.toBeNull()
    expect(container.textContent).not.toContain('Page B')
    expect(container.textContent).not.toContain('B content')

    // Back to A
    sendFn!({ type: 'go', page: 'a' })
    handle.flush()

    expect(container.querySelector('.page-c')).toBeNull()
    expect(container.querySelector('.page-a')).not.toBeNull()
    // CRITICAL: no leaked headings from previous pages
    const allText = container.textContent ?? ''
    expect(allText.match(/Page B/g)).toBeNull()
    expect(allText.match(/Page C/g)).toBeNull()
  })

  it('does not accumulate nodes across multiple rapid navigations', () => {
    type State = { page: 'x' | 'y' }
    type Msg = { type: 'toggle' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Toggle',
      init: () => [{ page: 'x' }, []],
      update: (state) => [{ ...state, page: state.page === 'x' ? 'y' : 'x' }, []],
      view: (send) => {
        sendFn = send
        return branch<State>({
          on: (s) => s.page,
          cases: {
            x: (_send) => [div({ class: 'px' }, [text('X')])],
            y: (_send) => [div({ class: 'py' }, [text('Y')])],
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.page, n.page) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Toggle 20 times
    for (let i = 0; i < 20; i++) {
      sendFn!({ type: 'toggle' })
      handle.flush()
    }

    // Should have exactly one page div, not 20 leaked ones
    const divs = container.querySelectorAll('div')
    expect(divs.length).toBe(1)
  })
})
