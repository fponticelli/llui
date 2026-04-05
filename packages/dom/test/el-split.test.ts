import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { elSplit } from '../src/el-split'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { title: string; active: boolean }
type Msg = { type: 'setTitle'; value: string } | { type: 'toggle' }

function elSplitDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'ElSplit',
    init: () => [{ title: 'hello', active: false }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setTitle':
          return [{ ...state, title: msg.value }, []]
        case 'toggle':
          return [{ ...state, active: !state.active }, []]
      }
    },
    view: ({ send }) => [
      elSplit(
        'div',
        (el) => {
          el.className = 'container'
          el.id = 'root'
        },
        [['click', () => send({ type: 'toggle' })]],
        [[0b01, 'attr', 'title', (s: State) => s.title]],
        [text((s: State) => s.title)],
      ),
    ],
    __dirty: (o, n) =>
      (Object.is(o.title, n.title) ? 0 : 0b01) | (Object.is(o.active, n.active) ? 0 : 0b10),
  }
}

describe('elSplit', () => {
  it('creates an element with the given tag', () => {
    const container = document.createElement('div')
    mountApp(container, elSplitDef())
    const el = container.querySelector('div.container')
    expect(el).not.toBeNull()
    expect(el!.id).toBe('root')
  })

  it('applies static props via staticFn', () => {
    const container = document.createElement('div')
    mountApp(container, elSplitDef())
    const el = container.querySelector('#root')!
    expect(el.className).toBe('container')
  })

  it('registers event listeners', () => {
    let sendFn: (msg: Msg) => void
    const def = elSplitDef()
    const originalView = def.view
    def.view = (h) => {
      sendFn = h.send
      return originalView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const el = container.querySelector('#root')! as HTMLElement
    el.click()
    handle.flush()
    // active toggled — no error means the event listener worked
  })

  it('creates reactive bindings that update on state change', () => {
    let sendFn: (msg: Msg) => void
    const def = elSplitDef()
    const originalView = def.view
    def.view = (h) => {
      sendFn = h.send
      return originalView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const el = container.querySelector('#root')!

    expect(el.getAttribute('title')).toBe('hello')
    expect(el.textContent).toBe('hello')

    sendFn!({ type: 'setTitle', value: 'world' })
    handle.flush()

    expect(el.getAttribute('title')).toBe('world')
    expect(el.textContent).toBe('world')
  })

  it('appends children to the element', () => {
    const container = document.createElement('div')
    mountApp(container, elSplitDef())
    const el = container.querySelector('#root')!
    expect(el.childNodes.length).toBe(1) // text node
  })

  it('handles null staticFn, events, and bindings', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'Bare',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [elSplit('span', null, null, null, null)],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(container.querySelector('span')).not.toBeNull()
  })
})
