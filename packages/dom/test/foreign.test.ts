import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { foreign } from '../src/primitives/foreign'
import type { ComponentDef } from '../src/types'

type State = { theme: string; readonly: boolean }
type Msg = { type: 'setTheme'; value: string } | { type: 'toggleReadonly' }

interface FakeEditor {
  container: HTMLElement
  destroyed: boolean
  options: Record<string, unknown>
}

function foreignDef() {
  const mountFn = vi.fn(
    (ctx: { container: HTMLElement }): FakeEditor => ({
      container: ctx.container,
      destroyed: false,
      options: {},
    }),
  )
  const destroyFn = vi.fn((inst: FakeEditor) => {
    inst.destroyed = true
  })
  const syncFn = vi.fn(
    (ctx: {
      instance: FakeEditor
      props: { theme: string; readonly: boolean }
      prev: { theme: string; readonly: boolean } | undefined
    }) => {
      ctx.instance.options = ctx.props
    },
  )

  const def: ComponentDef<State, Msg, never> = {
    name: 'Foreign',
    init: () => [{ theme: 'dark', readonly: false }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setTheme':
          return [{ ...state, theme: msg.value }, []]
        case 'toggleReadonly':
          return [{ ...state, readonly: !state.readonly }, []]
      }
    },
    view: () =>
      foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
        mount: mountFn,
        props: (s) => ({ theme: s.theme, readonly: s.readonly }),
        sync: syncFn,
        destroy: destroyFn,
      }),
    __dirty: (o, n) =>
      (Object.is(o.theme, n.theme) ? 0 : 0b01) | (Object.is(o.readonly, n.readonly) ? 0 : 0b10),
  }

  return { def, mountFn, destroyFn, syncFn }
}

describe('foreign()', () => {
  let sendFn: (msg: Msg) => void

  function mount() {
    const fns = foreignDef()
    const origView = fns.def.view
    fns.def.view = (send) => {
      sendFn = send
      return origView(send)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, fns.def)
    return { container, handle, ...fns }
  }

  it('creates a container element and calls mount()', () => {
    const { container, mountFn } = mount()
    expect(mountFn).toHaveBeenCalledTimes(1)
    const foreignContainer = container.querySelector('div')
    expect(foreignContainer).not.toBeNull()
  })

  it('calls sync with initial props', () => {
    const { syncFn } = mount()
    expect(syncFn).toHaveBeenCalledTimes(1)
    expect(syncFn).toHaveBeenCalledWith({
      instance: expect.objectContaining({ container: expect.anything() }),
      props: { theme: 'dark', readonly: false },
      prev: undefined,
    })
  })

  it('calls sync when props change', () => {
    const { handle, syncFn } = mount()
    sendFn({ type: 'setTheme', value: 'light' })
    handle.flush()
    expect(syncFn).toHaveBeenCalledTimes(2)
    expect(syncFn.mock.calls[1]![0].prev).toEqual({ theme: 'dark', readonly: false })
    expect(syncFn.mock.calls[1]![0].props).toEqual({ theme: 'light', readonly: false })
  })

  it('does not call sync when props are unchanged', () => {
    const { syncFn } = mount()
    expect(syncFn).toHaveBeenCalledTimes(1)
  })

  it('calls destroy on scope disposal', () => {
    const { handle, destroyFn } = mount()
    handle.dispose()
    expect(destroyFn).toHaveBeenCalledTimes(1)
  })

  it('uses custom container tag and attrs', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'CustomContainer',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        foreign({
          mount: ({ container }) => container,
          props: () => ({}),
          sync: () => {},
          destroy: () => {},
          container: { tag: 'section', attrs: { class: 'editor', 'data-type': 'code' } },
        }),
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const el = container.querySelector('section')
    expect(el).not.toBeNull()
    expect(el!.className).toBe('editor')
    expect(el!.getAttribute('data-type')).toBe('code')
  })

  it('calls per-key sync handlers on initial mount', () => {
    const themeFn = vi.fn()
    const readonlyFn = vi.fn()

    const def: ComponentDef<State, Msg, never> = {
      name: 'PerKeySync',
      init: () => [{ theme: 'dark', readonly: false }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setTheme':
            return [{ ...state, theme: msg.value }, []]
          case 'toggleReadonly':
            return [{ ...state, readonly: !state.readonly }, []]
        }
      },
      view: () =>
        foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
          mount: ({ container }): FakeEditor => ({
            container,
            destroyed: false,
            options: {},
          }),
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: {
            theme: themeFn,
            readonly: readonlyFn,
          },
          destroy: () => {},
        }),
      __dirty: (o, n) =>
        (Object.is(o.theme, n.theme) ? 0 : 0b01) | (Object.is(o.readonly, n.readonly) ? 0 : 0b10),
    }

    const container = document.createElement('div')
    mountApp(container, def)

    expect(themeFn).toHaveBeenCalledTimes(1)
    expect(themeFn).toHaveBeenCalledWith({
      instance: expect.anything(),
      value: 'dark',
      prev: undefined,
    })
    expect(readonlyFn).toHaveBeenCalledTimes(1)
    expect(readonlyFn).toHaveBeenCalledWith({
      instance: expect.anything(),
      value: false,
      prev: undefined,
    })
  })

  it('calls only changed per-key sync handlers on update', () => {
    const themeFn = vi.fn()
    const readonlyFn = vi.fn()
    let localSend: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'PerKeySyncUpdate',
      init: () => [{ theme: 'dark', readonly: false }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setTheme':
            return [{ ...state, theme: msg.value }, []]
          case 'toggleReadonly':
            return [{ ...state, readonly: !state.readonly }, []]
        }
      },
      view: (send) => {
        localSend = send
        return foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
          mount: ({ container }): FakeEditor => ({
            container,
            destroyed: false,
            options: {},
          }),
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: {
            theme: themeFn,
            readonly: readonlyFn,
          },
          destroy: () => {},
        })
      },
      __dirty: (o, n) =>
        (Object.is(o.theme, n.theme) ? 0 : 0b01) | (Object.is(o.readonly, n.readonly) ? 0 : 0b10),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    themeFn.mockClear()
    readonlyFn.mockClear()

    localSend!({ type: 'setTheme', value: 'light' })
    handle.flush()

    expect(themeFn).toHaveBeenCalledTimes(1)
    expect(themeFn).toHaveBeenCalledWith({
      instance: expect.anything(),
      value: 'light',
      prev: 'dark',
    })
    expect(readonlyFn).not.toHaveBeenCalled()
  })
})
