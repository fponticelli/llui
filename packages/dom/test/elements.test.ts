import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { div, button, span, input } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { label: string; active: boolean }
type Msg = { type: 'toggle' } | { type: 'setLabel'; value: string }

function elementsDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Elements',
    init: () => [{ label: 'hello', active: false }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'toggle':
          return [{ ...state, active: !state.active }, []]
        case 'setLabel':
          return [{ ...state, label: msg.value }, []]
      }
    },
    view: (_state, send) => [
      div({ class: 'container', id: 'main' }, [
        span({ class: (s: State) => (s.active ? 'on' : 'off') }, [
          text((s: State) => s.label),
        ]),
        button({ onClick: () => send({ type: 'toggle' }) }, [text('Toggle')]),
      ]),
    ],
    __dirty: (o, n) =>
      (Object.is(o.label, n.label) ? 0 : 0b01) | (Object.is(o.active, n.active) ? 0 : 0b10),
  }
}

describe('element helpers (uncompiled path)', () => {
  it('creates elements with static props', () => {
    const container = document.createElement('div')
    mountApp(container, elementsDef())
    const el = container.querySelector('#main')
    expect(el).not.toBeNull()
    expect(el!.className).toBe('container')
  })

  it('appends children', () => {
    const container = document.createElement('div')
    mountApp(container, elementsDef())
    const el = container.querySelector('#main')!
    expect(el.children.length).toBe(2) // span + button
  })

  it('registers event handlers', () => {
    let sendFn: (msg: Msg) => void
    const def = elementsDef()
    const origView = def.view
    def.view = (state, send) => {
      sendFn = send
      return origView(state, send)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const btn = container.querySelector('button')!
    btn.click()
    handle.flush()
    // toggled active — check the reactive class binding updated
    const spanEl = container.querySelector('span')!
    expect(spanEl.className).toBe('on')
  })

  it('creates reactive bindings for accessor props', () => {
    let sendFn: (msg: Msg) => void
    const def = elementsDef()
    const origView = def.view
    def.view = (state, send) => {
      sendFn = send
      return origView(state, send)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const spanEl = container.querySelector('span')!
    expect(spanEl.className).toBe('off')

    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(spanEl.className).toBe('on')
  })

  it('handles void elements like input', () => {
    const def: ComponentDef<{ val: string }, never, never> = {
      name: 'Input',
      init: () => [{ val: 'test' }, []],
      update: (s) => [s, []],
      view: () => [input({ type: 'text', value: (s: { val: string }) => s.val })],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const el = container.querySelector('input') as HTMLInputElement
    expect(el).not.toBeNull()
    expect(el.type).toBe('text')
    expect(el.value).toBe('test')
  })
})
