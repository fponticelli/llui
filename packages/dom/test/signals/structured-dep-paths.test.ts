import { describe, expect, it } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, signalEach, signalEachDirect, signalText, staticText } from '../../src/signals/dom'
import { rowHandle } from '../../src/signals/handle'
import { each, li, text, ul } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'
import { compileAndLoad, identityComponent } from './compile-and-load'

const RUNTIME = {
  component: identityComponent,
  el,
  signalEach,
  signalEachDirect,
  signalText,
  staticText,
  rowHandle,
  text,
  rowExtra: () => staticText(''),
}

describe('reserved dependency roots at the compiler/runtime row seam', () => {
  it('keeps compiler-emitted component state/item/index deps distinct from row-local deps', () => {
    const SRC = `
      import { component, div, each, li, span, text, ul } from '@llui/dom'
      import { rowExtra } from './row-extra'
      export const ReservedRoots = component({
        init: () => [{
          rows: [{ id: 1, item: 'row-item', state: 'row-state' }],
          state: 'component-state-0',
          item: 'component-item-0',
          index: 0,
          ordinary: 'ordinary-0',
        }, []],
        update: (state, msg) =>
          msg.type === 'set'
            ? [{
                ...state,
                state: 'component-state-1',
                item: 'component-item-1',
                index: 1,
                ordinary: 'ordinary-1',
              }, []]
            : [state, []],
        view: ({ state }) => [
          div({ class: 'outside' }, [
            span({ class: 'outside-state' }, [text(state.at('state'))]),
            span({ class: 'outside-item' }, [text(state.at('item'))]),
            span({ class: 'outside-index' }, [text(state.at('index'))]),
            span({ class: 'outside-ordinary' }, [text(state.at('ordinary'))]),
          ]),
          ul([
            each(state.at('rows'), {
              key: (row) => row.id,
              render: (item, index) => [
                li({ class: 'row' }, [
                  span({ class: 'component-state' }, [text(state.at('state'))]),
                  span({ class: 'component-item' }, [text(state.at('item'))]),
                  span({ class: 'component-index' }, [text(state.at('index'))]),
                  span({ class: 'component-ordinary' }, [text(state.at('ordinary'))]),
                  span({ class: 'row-item' }, [text(item.at('item'))]),
                  span({ class: 'row-state' }, [text(item.at('state'))]),
                  span({ class: 'row-index' }, [text(index)]),
                  rowExtra(item),
                ]),
              ],
            }),
          ]),
        ],
      })
    `

    const App = compileAndLoad<
      {
        rows: readonly { id: number; item: string; state: string }[]
        state: string
        item: string
        index: number
        ordinary: string
      },
      { type: 'set' }
    >(SRC, 'ReservedRoots', RUNTIME)
    const container = document.createElement('div')
    const handle = mountSignalComponent(container, App)

    const value = (selector: string): string | null =>
      container.querySelector(selector)?.textContent ?? null
    expect(value('.outside-state')).toBe('component-state-0')
    expect(value('.outside-item')).toBe('component-item-0')
    expect(value('.outside-index')).toBe('0')
    expect(value('.outside-ordinary')).toBe('ordinary-0')
    expect(value('.component-state')).toBe('component-state-0')
    expect(value('.component-item')).toBe('component-item-0')
    expect(value('.component-index')).toBe('0')
    expect(value('.component-ordinary')).toBe('ordinary-0')
    expect(value('.row-item')).toBe('row-item')
    expect(value('.row-state')).toBe('row-state')
    expect(value('.row-index')).toBe('0')

    handle.send({ type: 'set' })

    expect(value('.outside-state')).toBe('component-state-1')
    expect(value('.outside-item')).toBe('component-item-1')
    expect(value('.outside-index')).toBe('1')
    expect(value('.outside-ordinary')).toBe('ordinary-1')
    expect(value('.component-state')).toBe('component-state-1')
    expect(value('.component-item')).toBe('component-item-1')
    expect(value('.component-index')).toBe('1')
    expect(value('.component-ordinary')).toBe('ordinary-1')
    expect(value('.row-item')).toBe('row-item')
    expect(value('.row-state')).toBe('row-state')
    expect(value('.row-index')).toBe('0')
  })

  it('brands a captured authoring binding before placing it in a compiler-lowered each row', () => {
    const SRC = `
      import { component, each, li, text, ul } from '@llui/dom'
      import { rowExtra } from './row-extra'
      export const Captured = component({
        init: () => [{ rows: [{ id: 1 }], index: 0 }, []],
        update: (state) => [{ ...state, index: state.index + 1 }, []],
        view: ({ state }) => {
          const captured = text(state.at('index'))
          return [ul([each(state.at('rows'), {
            key: (row) => row.id,
            render: (item) => [li({ class: 'captured' }, [captured, rowExtra(item)])],
          })])]
        },
      })
    `
    const App = compileAndLoad<
      { rows: readonly { id: number }[]; index: number },
      { type: 'increment' }
    >(SRC, 'Captured', RUNTIME)
    const container = document.createElement('div')
    const handle = mountSignalComponent(container, App)

    expect(container.querySelector('.captured')?.textContent).toBe('0')
    handle.send({ type: 'increment' })
    expect(container.querySelector('.captured')?.textContent).toBe('1')
  })

  it('keeps component-root provenance through an opaque view helper using authoring each', () => {
    const rowsView = (rows: Signal<readonly { id: number }[]>, componentIndex: Signal<number>) =>
      ul([
        each(rows, {
          key: (row) => row.id,
          render: () => [li({ class: 'opaque' }, [text(componentIndex)])],
        }),
      ])
    const SRC = `
      import { component } from '@llui/dom'
      import { rowsView } from './rows-view'
      export const Opaque = component({
        init: () => [{ rows: [{ id: 1 }], index: 0 }, []],
        update: (state) => [{ ...state, index: state.index + 1 }, []],
        view: ({ state }) => [rowsView(state.at('rows'), state.at('index'))],
      })
    `
    const App = compileAndLoad<
      { rows: readonly { id: number }[]; index: number },
      { type: 'increment' }
    >(SRC, 'Opaque', { ...RUNTIME, rowsView })
    const container = document.createElement('div')
    const handle = mountSignalComponent(container, App)

    expect(container.querySelector('.opaque')?.textContent).toBe('0')
    handle.send({ type: 'increment' })
    expect(container.querySelector('.opaque')?.textContent).toBe('1')
  })
})
