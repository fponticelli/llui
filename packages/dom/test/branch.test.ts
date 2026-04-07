import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef, View } from '../src/types'

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
    view: ({ text: t, branch: b }) => [
      ...b({
        on: (s) => s.phase,
        cases: {
          idle: () => [t('waiting...')],
          loading: () => [t('loading...')],
          done: () => [div({ class: 'done' }, [t('done!')])],
        },
      }),
    ],
    __dirty: (o, n) => (Object.is(o.phase, n.phase) ? 0 : 1),
  }
}

describe('branch()', () => {
  let sendFn: (msg: Msg) => void

  function mount() {
    const def = phaseDef()
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
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

  it('passes View bag (h) to case callbacks', () => {
    let receivedH: View<State, Msg> | null = null

    const def: ComponentDef<State, Msg, never> = {
      name: 'BranchH',
      init: () => [{ phase: 'idle' }, []],
      update: (s) => [s, []],
      view: ({ branch: b }) => [
        ...b({
          on: (s) => s.phase,
          cases: {
            idle: (h) => {
              receivedH = h
              return [h.text('via h')]
            },
          },
        }),
      ],
      __dirty: () => 0,
    }

    const container = document.createElement('div')
    mountApp(container, def)
    expect(receivedH).not.toBeNull()
    expect(receivedH!.send).toBeTypeOf('function')
    expect(receivedH!.text).toBeTypeOf('function')
    expect(receivedH!.show).toBeTypeOf('function')
    expect(receivedH!.branch).toBeTypeOf('function')
    expect(receivedH!.each).toBeTypeOf('function')
    expect(receivedH!.memo).toBeTypeOf('function')
    expect(container.textContent).toBe('via h')
  })

  it('View bag works for text inside branch case', () => {
    const def: ComponentDef<State, Msg, never> = {
      name: 'BranchText',
      init: () => [{ phase: 'idle' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setPhase':
            return [{ ...state, phase: msg.phase }, []]
        }
      },
      view: ({ branch: b }) => [
        ...b({
          on: (s) => s.phase,
          cases: {
            idle: (h) => [h.text((s) => `Phase: ${s.phase}`)],
            loading: (h) => [h.text((s) => `Loading: ${s.phase}`)],
          },
        }),
      ],
      __dirty: (o, n) => (Object.is(o.phase, n.phase) ? 0 : 1),
    }

    const container = document.createElement('div')
    const origView = def.view
    let sendFn!: (msg: Msg) => void
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)
    expect(container.textContent).toBe('Phase: idle')

    sendFn({ type: 'setPhase', phase: 'loading' })
    handle.flush()
    expect(container.textContent).toBe('Loading: loading')
  })

  it('nested show inside branch case via h', () => {
    type S = { page: 'a' | 'b'; flag: boolean }
    type M = { type: 'setPage'; page: S['page'] } | { type: 'toggleFlag' }

    const def: ComponentDef<S, M, never> = {
      name: 'Nested',
      init: () => [{ page: 'a', flag: true }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setPage':
            return [{ ...state, page: msg.page }, []]
          case 'toggleFlag':
            return [{ ...state, flag: !state.flag }, []]
        }
      },
      view: ({ branch: b }) => [
        ...b({
          on: (s) => s.page,
          cases: {
            a: (h) => [
              ...h.show({
                when: (s) => s.flag,
                render: () => [h.text('flag is on')],
              }),
            ],
            b: (h) => [h.text('page b')],
          },
        }),
      ],
      __dirty: (o, n) => {
        let mask = 0
        if (!Object.is(o.page, n.page)) mask |= 1
        if (!Object.is(o.flag, n.flag)) mask |= 2
        return mask
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)
    expect(container.textContent).toBe('flag is on')

    sendFn({ type: 'toggleFlag' })
    handle.flush()
    expect(container.textContent).toBe('')

    sendFn({ type: 'toggleFlag' })
    handle.flush()
    expect(container.textContent).toBe('flag is on')
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
      view: ({ show: s, text: t }) =>
        s({
          when: (st) => st.visible,
          render: () => [div({ class: 'panel' }, [t('content')])],
        }),
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }
  }

  let sendFn: (msg: ShowMsg) => void

  function mount() {
    const def = showDef()
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
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

  it('passes View bag to render callback', () => {
    let receivedH: View<ShowState, ShowMsg> | null = null

    const def: ComponentDef<ShowState, ShowMsg, never> = {
      name: 'ShowH',
      init: () => [{ visible: true }, []],
      update: (s) => [s, []],
      view: ({ show: s }) =>
        s({
          when: () => true,
          render: (h) => {
            receivedH = h
            return [h.text('via h')]
          },
        }),
      __dirty: () => 0,
    }

    const container = document.createElement('div')
    mountApp(container, def)
    expect(receivedH).not.toBeNull()
    expect(receivedH!.send).toBeTypeOf('function')
    expect(receivedH!.text).toBeTypeOf('function')
    expect(container.textContent).toBe('via h')
  })

  it('passes View bag to fallback callback', () => {
    let receivedH: View<ShowState, ShowMsg> | null = null

    const def: ComponentDef<ShowState, ShowMsg, never> = {
      name: 'ShowFallbackH',
      init: () => [{ visible: false }, []],
      update: (s) => [s, []],
      view: ({ show: s }) =>
        s({
          when: (st) => st.visible,
          render: () => [],
          fallback: (h) => {
            receivedH = h
            return [h.text('fallback via h')]
          },
        }),
      __dirty: () => 0,
    }

    const container = document.createElement('div')
    mountApp(container, def)
    expect(receivedH).not.toBeNull()
    expect(container.textContent).toBe('fallback via h')
  })
})

describe('show() with fallback', () => {
  type FbState = { loaded: boolean }
  type FbMsg = { type: 'toggle' }

  function fbDef(): ComponentDef<FbState, FbMsg, never> {
    return {
      name: 'ShowFallback',
      init: () => [{ loaded: false }, []],
      update: (state) => [{ ...state, loaded: !state.loaded }, []],
      view: ({ show: s, text: t }) =>
        s({
          when: (st) => st.loaded,
          render: () => [div({ class: 'content' }, [t('ready')])],
          fallback: () => [div({ class: 'spinner' }, [t('loading...')])],
        }),
      __dirty: (o, n) => (Object.is(o.loaded, n.loaded) ? 0 : 1),
    }
  }

  let sendFn: (msg: FbMsg) => void

  function mount() {
    const def = fbDef()
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders fallback when condition is false', () => {
    const { container } = mount()
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(container.querySelector('.content')).toBeNull()
    expect(container.textContent).toBe('loading...')
  })

  it('swaps fallback for render when condition flips true', () => {
    const { container, handle } = mount()
    sendFn({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.spinner')).toBeNull()
    expect(container.querySelector('.content')).not.toBeNull()
    expect(container.textContent).toBe('ready')
  })

  it('swaps back to fallback when condition flips false again', () => {
    const { container, handle } = mount()
    sendFn({ type: 'toggle' })
    handle.flush()
    sendFn({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.content')).toBeNull()
    expect(container.querySelector('.spinner')).not.toBeNull()
    expect(container.textContent).toBe('loading...')
  })
})
