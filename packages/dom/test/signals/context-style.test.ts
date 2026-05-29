import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  staticText,
  el,
  react,
  createContext,
  provide,
  useContext,
} from '../../src/signals/dom'

describe('context (provide/useContext)', () => {
  const Theme = createContext<string>('light')

  it('provides a value to a subtree; useContext reads nearest or default', () => {
    let outer = ''
    let inner = ''
    const container = document.createElement('div')
    mountSignalComponent<{ n: number }, { type: 'x' }>(container, {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => {
        outer = useContext(Theme) // default
        return [
          provide(Theme, 'dark', () => {
            inner = useContext(Theme) // provided
            return [el('span', {}, [staticText(useContext(Theme))])]
          }),
        ]
      },
    })
    expect(outer).toBe('light')
    expect(inner).toBe('dark')
    expect(container.querySelector('span')?.textContent).toBe('dark')
  })
})

describe('dotted style props', () => {
  it('applies style.* props (static + reactive) as individual style properties', () => {
    interface S {
      x: number
    }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'move'; x: number }>(container, {
      init: () => ({ x: 10 }),
      update: (_s, m) => ({ x: m.x }),
      view: () => [
        el(
          'div',
          {
            id: 'box',
            'style.position': 'absolute',
            'style.transform': react((s) => `translateX(${(s as S).x}px)`, ['x']),
          },
          [signalText(() => 'box', [])],
        ),
      ],
    })
    const box = container.querySelector('#box') as HTMLElement
    expect(box.style.position).toBe('absolute')
    expect(box.style.transform).toBe('translateX(10px)')
    h.send({ type: 'move', x: 42 })
    expect(box.style.transform).toBe('translateX(42px)')
  })
})
