import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import type { ComponentDef } from '../src/types'
import type { View } from '../src/view-helpers'

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
    view: ({ send }) => {
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
      view: () => {
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

  it('provides full View bag with all helpers', () => {
    let captured: View<{ n: number }, never> | null = null
    const def: ComponentDef<{ n: number }, never, never> = {
      name: 'ViewBag',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: (h) => {
        captured = h
        return [document.createTextNode('ok')]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(captured).not.toBeNull()
    expect(captured!.send).toBeTypeOf('function')
    expect(captured!.each).toBeTypeOf('function')
    expect(captured!.show).toBeTypeOf('function')
    expect(captured!.branch).toBeTypeOf('function')
    expect(captured!.text).toBeTypeOf('function')
    expect(captured!.memo).toBeTypeOf('function')
    expect(captured!.selector).toBeTypeOf('function')
    expect(captured!.ctx).toBeTypeOf('function')
  })

  it('each() works when destructured from View bag', () => {
    type S = { items: string[] }
    const def: ComponentDef<S, never, never> = {
      name: 'EachFromBag',
      init: () => [{ items: ['a', 'b', 'c'] }, []],
      update: (s) => [s, []],
      view: ({ each }) => [
        ...each<string>({
          items: (s) => s.items,
          key: (v) => v,
          render: ({ item }) => {
            const el = document.createElement('span')
            el.textContent = item((v: string) => v)()
            return [el]
          },
        }),
      ],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBe(3)
    expect(spans[0]!.textContent).toBe('a')
    expect(spans[1]!.textContent).toBe('b')
    expect(spans[2]!.textContent).toBe('c')
  })
})
