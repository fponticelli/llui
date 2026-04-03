import { describe, it, expect } from 'vitest'
import { component, mountApp, div, button, text, show } from '../src/index'

describe('Counter app (end-to-end)', () => {
  type State = { count: number }
  type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

  const Counter = component<State, Msg, never>({
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [{ ...state, count: state.count + 1 }, []]
        case 'dec':
          return [{ ...state, count: Math.max(0, state.count - 1) }, []]
        case 'reset':
          return [{ count: 0 }, []]
      }
    },
    view: (_state, send) => [
      div({ class: 'counter' }, [
        button({ class: 'dec', onClick: () => send({ type: 'dec' }) }, [text('-')]),
        text((s: State) => String(s.count)),
        button({ class: 'inc', onClick: () => send({ type: 'inc' }) }, [text('+')]),
      ]),
      ...show<State>({
        when: (s) => s.count > 0,
        render: () => [
          button({ class: 'reset', onClick: () => send({ type: 'reset' }) }, [text('Reset')]),
        ],
      }),
    ],
    __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
  })

  it('renders initial state', () => {
    const container = document.createElement('div')
    mountApp(container, Counter)
    expect(container.textContent).toContain('0')
    expect(container.querySelector('.reset')).toBeNull()
  })

  it('increments on + click', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const incBtn = container.querySelector('.inc') as HTMLElement
    incBtn.click()
    handle.flush()
    expect(container.textContent).toContain('1')
    expect(container.querySelector('.reset')).not.toBeNull()
  })

  it('decrements on - click, floors at 0', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const decBtn = container.querySelector('.dec') as HTMLElement
    decBtn.click()
    handle.flush()
    expect(container.textContent).toContain('0')
  })

  it('resets to 0', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const incBtn = container.querySelector('.inc') as HTMLElement
    incBtn.click()
    incBtn.click()
    incBtn.click()
    handle.flush()
    expect(container.textContent).toContain('3')

    const resetBtn = container.querySelector('.reset') as HTMLElement
    resetBtn.click()
    handle.flush()
    expect(container.textContent).toContain('0')
    expect(container.querySelector('.reset')).toBeNull()
  })

  it('multiple rapid clicks batch correctly', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const incBtn = container.querySelector('.inc') as HTMLElement
    for (let i = 0; i < 10; i++) incBtn.click()
    handle.flush()
    expect(container.textContent).toContain('10')
  })
})
