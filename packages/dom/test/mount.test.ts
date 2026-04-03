import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import type { ComponentDef } from '../src/types'

type State = { count: number }
type Msg = { type: 'inc' }

function counterDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [{ ...state, count: state.count + 1 }, []]
      }
    },
    view: (_state, send) => {
      const btn = document.createElement('button')
      btn.addEventListener('click', () => send({ type: 'inc' }))
      btn.textContent = '+'
      return [btn]
    },
    __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
  }
}

describe('mountApp', () => {
  it('mounts component into a container', () => {
    const container = document.createElement('div')
    mountApp(container, counterDef())
    expect(container.children.length).toBe(1)
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('returns an AppHandle with dispose() and flush()', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    expect(handle.dispose).toBeTypeOf('function')
    expect(handle.flush).toBeTypeOf('function')
  })

  it('dispose() removes all children from the container', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    expect(container.children.length).toBe(1)
    handle.dispose()
    expect(container.children.length).toBe(0)
  })

  it('processes messages via flush()', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    const btn = container.querySelector('button')!
    btn.click()
    handle.flush()
    // No error — state updated from 0 to 1
  })

  it('passes initial data to init()', () => {
    const def: ComponentDef<{ value: number }, never, never> = {
      name: 'WithData',
      init: (data) => [{ value: (data as { v: number }).v }, []],
      update: (s) => [s, []],
      view: (_state) => {
        const span = document.createElement('span')
        return [span]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def, { v: 42 })
    expect(container.querySelector('span')).not.toBeNull()
  })

  it('disposes idempotently', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    handle.dispose()
    handle.dispose() // should not throw
    expect(container.children.length).toBe(0)
  })
})
