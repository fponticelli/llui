import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { portal } from '../../src/signals/context'
import { span, text, each, show, div } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'
import type { Renderable } from '../../src/signals/element'

describe('portal — dispose removes nested structural children', () => {
  interface S {
    items: readonly { id: string }[]
  }
  type M = { type: 'add' }

  it('removes every node it put in the portal host', () => {
    const container = document.createElement('div')
    const target = document.createElement('div')
    document.body.appendChild(target)

    const handle = mountSignalComponent<S, M>(container, {
      name: 'portal-leak',
      init: () => ({ items: [{ id: 'a' }, { id: 'b' }] }),
      update: (s) => s,
      view: ({ state }: { state: Signal<S> }) => [
        portal(
          () => [
            each(state.at('items'), {
              key: (i) => i.id,
              render: (item: Signal<{ id: string }>): Renderable => [
                span({ 'data-row': item.at('id') }, [text(item.at('id'))]),
              ],
            }),
          ],
          target,
        ),
      ],
    })

    expect(target.querySelectorAll('[data-row]').length).toBe(2)

    handle.dispose()

    expect(target.querySelectorAll('[data-row]').length).toBe(0)
    expect(target.childNodes.length).toBe(0)

    target.remove()
  })

  it('removes a plain (non-structural) content list on dispose', () => {
    const container = document.createElement('div')
    const target = document.createElement('div')

    const handle = mountSignalComponent<S, M>(container, {
      name: 'portal-plain',
      init: () => ({ items: [] }),
      update: (s) => s,
      view: () => [portal(() => [div({ id: 'a' }, []), div({ id: 'b' }, [])], target)],
    })

    expect(target.children.length).toBe(2)
    handle.dispose()
    expect(target.childNodes.length).toBe(0)
  })

  it('leaves nothing in the host when a nested show is toggled on, then off, then disposed', () => {
    const container = document.createElement('div')
    const target = document.createElement('div')

    interface T {
      open: boolean
    }
    type TM = { type: 'set'; open: boolean }

    const handle = mountSignalComponent<T, TM>(container, {
      name: 'portal-show',
      init: () => ({ open: false }),
      update: (_s, m) => ({ open: m.open }),
      view: ({ state }: { state: Signal<T> }) => [
        portal(() => [show(state.at('open'), () => [div({ id: 'panel' }, [])])], target),
      ],
    })

    expect(target.querySelector('#panel')).toBeNull()
    handle.send({ type: 'set', open: true })
    expect(target.querySelector('#panel')).not.toBeNull()
    handle.send({ type: 'set', open: false })
    expect(target.querySelector('#panel')).toBeNull()

    handle.dispose()
    expect(target.childNodes.length).toBe(0)
  })

  it('disposes two portals sharing one host independently', () => {
    const target = document.createElement('div')

    const mountOne = (id: string) =>
      mountSignalComponent<S, M>(document.createElement('div'), {
        name: `portal-${id}`,
        init: () => ({ items: [{ id }] }),
        update: (s) => s,
        view: ({ state }: { state: Signal<S> }) => [
          portal(
            () => [
              each(state.at('items'), {
                key: (i) => i.id,
                render: (item: Signal<{ id: string }>): Renderable => [
                  span({ 'data-row': item.at('id') }, [text(item.at('id'))]),
                ],
              }),
            ],
            target,
          ),
        ],
      })

    const first = mountOne('first')
    const second = mountOne('second')

    expect(target.querySelectorAll('[data-row]').length).toBe(2)

    first.dispose()

    expect(target.querySelectorAll('[data-row="first"]').length).toBe(0)
    expect(target.querySelectorAll('[data-row="second"]').length).toBe(1)

    second.dispose()
    expect(target.childNodes.length).toBe(0)
  })
})
