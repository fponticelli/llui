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
    fns.def.view = (h) => {
      sendFn = h.send
      return origView(h)
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
      view: ({ send }) => {
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

describe('foreign — async mount', () => {
  it('defers the initial sync until the mount promise resolves', async () => {
    let resolveMount!: (inst: FakeEditor) => void
    const mountPromise = new Promise<FakeEditor>((res) => {
      resolveMount = res
    })
    const mountFn = vi.fn((ctx: { container: HTMLElement }): Promise<FakeEditor> => {
      // Store the container on the unresolved editor via the promise
      void ctx
      return mountPromise
    })
    const syncFn = vi.fn()
    const destroyFn = vi.fn()

    const def: ComponentDef<State, Msg, never> = {
      name: 'AsyncForeign',
      init: () => [{ theme: 'dark', readonly: false }, []],
      update: (s) => [s, []],
      view: () =>
        foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
          mount: mountFn,
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: syncFn,
          destroy: destroyFn,
        }),
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      // Container is in the DOM but sync hasn't run yet.
      expect(container.querySelector('div')).not.toBeNull()
      expect(syncFn).not.toHaveBeenCalled()

      const inst: FakeEditor = { container, destroyed: false, options: {} }
      resolveMount(inst)
      await mountPromise

      expect(syncFn).toHaveBeenCalledTimes(1)
      expect(syncFn).toHaveBeenCalledWith({
        instance: inst,
        props: { theme: 'dark', readonly: false },
        prev: undefined,
      })
    } finally {
      handle.dispose()
    }
  })

  it('applies props changes that happened before resolve, once the instance arrives', async () => {
    let resolveMount!: (inst: FakeEditor) => void
    const mountPromise = new Promise<FakeEditor>((res) => {
      resolveMount = res
    })
    const syncFn = vi.fn()

    const def: ComponentDef<State, Msg, never> = {
      name: 'PendingProps',
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
          mount: () => mountPromise,
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: syncFn,
          destroy: () => {},
        }),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      // Change state while mount is still pending.
      handle.send({ type: 'setTheme', value: 'light' })
      handle.flush()
      handle.send({ type: 'toggleReadonly' })
      handle.flush()

      // No sync yet — instance not ready.
      expect(syncFn).not.toHaveBeenCalled()

      const inst: FakeEditor = { container, destroyed: false, options: {} }
      resolveMount(inst)
      await mountPromise

      // Exactly one sync, with the LATEST props.
      expect(syncFn).toHaveBeenCalledTimes(1)
      expect(syncFn).toHaveBeenCalledWith({
        instance: inst,
        props: { theme: 'light', readonly: true },
        prev: undefined,
      })
    } finally {
      handle.dispose()
    }
  })

  it('destroys the instance when dispose happens before resolve', async () => {
    let resolveMount!: (inst: FakeEditor) => void
    const mountPromise = new Promise<FakeEditor>((res) => {
      resolveMount = res
    })
    const syncFn = vi.fn()
    const destroyFn = vi.fn()

    const def: ComponentDef<State, Msg, never> = {
      name: 'DisposeRace',
      init: () => [{ theme: 'dark', readonly: false }, []],
      update: (s) => [s, []],
      view: () =>
        foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
          mount: () => mountPromise,
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: syncFn,
          destroy: destroyFn,
        }),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.dispose()

    const inst: FakeEditor = { container, destroyed: false, options: {} }
    resolveMount(inst)
    await mountPromise

    // Sync was never called because the scope was disposed.
    expect(syncFn).not.toHaveBeenCalled()
    // Destroy was called with the resolved instance — no leak.
    expect(destroyFn).toHaveBeenCalledTimes(1)
    expect(destroyFn).toHaveBeenCalledWith(inst)
  })

  it('logs rejected promise without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rejection = new Error('library init failed')
    const def: ComponentDef<State, Msg, never> = {
      name: 'Rejected',
      init: () => [{ theme: 'dark', readonly: false }, []],
      update: (s) => [s, []],
      view: () =>
        foreign<State, Msg, { theme: string; readonly: boolean }, FakeEditor>({
          mount: () => Promise.reject(rejection),
          props: (s) => ({ theme: s.theme, readonly: s.readonly }),
          sync: () => {},
          destroy: () => {},
        }),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      // Await a microtask cycle so the rejection handler fires.
      await Promise.resolve()
      await Promise.resolve()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('foreign({ mount }) promise rejected'),
        rejection,
      )
    } finally {
      handle.dispose()
      errorSpy.mockRestore()
    }
  })
})
