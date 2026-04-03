import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type State = { phase: 'idle' | 'loading' | 'done' }
type Msg = { type: 'setPhase'; phase: State['phase'] }

function phaseDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Phase',
    init: () => [{ phase: 'idle' }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setPhase':
          return [{ ...state, phase: msg.phase }, []]
      }
    },
    view: () =>
      branch<State, Msg>({
        on: (s) => s.phase,
        cases: {
          idle: () => [text('waiting...')],
          loading: () => [text('loading...')],
          done: () => [div({}, [text('done!')])],
        },
      }),
    __dirty: (o, n) => (Object.is(o.phase, n.phase) ? 0 : 1),
  }
}

describe('branch()', () => {
  let sendFn: (msg: Msg) => void

  function mount() {
    const def = phaseDef()
    const origView = def.view
    def.view = (state, send) => {
      sendFn = send
      return origView(state, send)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders the initial case', () => {
    const { container } = mount()
    expect(container.textContent).toBe('waiting...')
  })

  it('swaps to a different case on state change', () => {
    const { container, handle } = mount()
    sendFn({ type: 'setPhase', phase: 'loading' })
    handle.flush()
    expect(container.textContent).toBe('loading...')
  })

  it('swaps to a case with element children', () => {
    const { container, handle } = mount()
    sendFn({ type: 'setPhase', phase: 'done' })
    handle.flush()
    expect(container.querySelector('div')).not.toBeNull()
    expect(container.textContent).toBe('done!')
  })

  it('disposes old scope when swapping', () => {
    const { container, handle } = mount()
    sendFn({ type: 'setPhase', phase: 'loading' })
    handle.flush()
    sendFn({ type: 'setPhase', phase: 'done' })
    handle.flush()
    expect(container.textContent).toBe('done!')
  })

  it('does nothing when discriminant stays the same', () => {
    const { container, handle } = mount()
    sendFn({ type: 'setPhase', phase: 'idle' })
    handle.flush()
    expect(container.textContent).toBe('waiting...')
  })
})

describe('show()', () => {
  type ShowState = { visible: boolean }
  type ShowMsg = { type: 'toggle' }

  function showDef(): ComponentDef<ShowState, ShowMsg, never> {
    return {
      name: 'Show',
      init: () => [{ visible: false }, []],
      update: (state) => [{ ...state, visible: !state.visible }, []],
      view: () =>
        show<ShowState, ShowMsg>({
          when: (s) => s.visible,
          render: () => [div({ class: 'panel' }, [text('content')])],
        }),
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }
  }

  let sendFn: (msg: ShowMsg) => void

  function mount() {
    const def = showDef()
    const origView = def.view
    def.view = (state, send) => {
      sendFn = send
      return origView(state, send)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders nothing when condition is false', () => {
    const { container } = mount()
    expect(container.querySelector('.panel')).toBeNull()
  })

  it('renders content when condition becomes true', () => {
    const { container, handle } = mount()
    sendFn({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.panel')).not.toBeNull()
    expect(container.textContent).toBe('content')
  })

  it('removes content when condition becomes false again', () => {
    const { container, handle } = mount()
    sendFn({ type: 'toggle' })
    handle.flush()
    sendFn({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.panel')).toBeNull()
  })
})
