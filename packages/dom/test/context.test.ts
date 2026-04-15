import { describe, it, expect } from 'vitest'
import {
  mountApp,
  component,
  div,
  span,
  button,
  text,
  each,
  show,
  createContext,
  provide,
  provideValue,
  useContext,
  useContextValue,
} from '../src/index'
import type { Send } from '../src/types'

describe('createContext + provide + useContext', () => {
  it('consumer reads value from ancestor provider', () => {
    type State = { theme: 'light' | 'dark' }
    const ThemeCtx = createContext<'light' | 'dark'>()

    function card(): Node[] {
      const theme = useContext(ThemeCtx)
      return [div({ class: (s: State) => `card theme-${theme(s)}` }, [text('content')])]
    }

    const App = component<State, never, never>({
      name: 'App',
      init: () => [{ theme: 'dark' }, []],
      update: (s) => [s, []],
      view: () => [
        ...provide(
          ThemeCtx,
          (s: State) => s.theme,
          () => [div({ class: 'wrap' }, card())],
        ),
      ],
    })

    const container = document.createElement('div')
    mountApp(container, App)
    expect(container.querySelector('.card')!.className).toBe('card theme-dark')
  })

  it('reactive updates propagate to consumer', () => {
    type State = { theme: 'light' | 'dark' }
    type Msg = { type: 'toggle' }
    const ThemeCtx = createContext<'light' | 'dark'>()
    let sendFn: Send<Msg>

    function box(): Node[] {
      const t = useContext(ThemeCtx)
      return [span({ class: (s: State) => `box ${t(s)}` })]
    }

    const App = component<State, Msg, never>({
      name: 'App',
      init: () => [{ theme: 'light' }, []],
      update: (s, m) =>
        m.type === 'toggle' ? [{ theme: s.theme === 'light' ? 'dark' : 'light' }, []] : [s, []],
      view: ({ send }) => {
        sendFn = send
        return provide(
          ThemeCtx,
          (s: State) => s.theme,
          () => box(),
        )
      },
    })

    const container = document.createElement('div')
    const handle = mountApp(container, App)
    expect(container.querySelector('.box')!.className).toBe('box light')
    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.box')!.className).toBe('box dark')
  })

  it('uses default value when no provider exists', () => {
    type State = Record<string, never>
    const Ctx = createContext<string>('fallback')

    function leaf(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: (s: State) => v(s) })]
    }

    const App = component<State, never, never>({
      name: 'App',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({}, leaf())],
    })

    const container = document.createElement('div')
    mountApp(container, App)
    expect(container.querySelector('span')!.className).toBe('fallback')
  })

  it('throws when no provider and no default', () => {
    type LeafState = Record<string, never>
    const Ctx = createContext<string>()
    function leaf(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: (s: LeafState) => v(s) })]
    }
    const App = component<LeafState, never, never>({
      name: 'App',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({}, leaf())],
    })
    // No default → useContext throws at mount time
    expect(() => mountApp(document.createElement('div'), App)).toThrow(/no provider/)
  })

  it('nested providers shadow outer ones, then restore after children()', () => {
    type State = { outer: string; inner: string }
    const Ctx = createContext<string>()

    function outer(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: 'o', 'data-val': (s: State) => v(s) })]
    }
    function inner(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: 'i', 'data-val': (s: State) => v(s) })]
    }

    const App = component<State, never, never>({
      name: 'App',
      init: () => [{ outer: 'OUT', inner: 'IN' }, []],
      update: (s) => [s, []],
      view: () =>
        provide(
          Ctx,
          (s: State) => s.outer,
          () => [
            ...outer(),
            ...provide(
              Ctx,
              (s: State) => s.inner,
              () => inner(),
            ),
            ...outer(), // sibling after nested provide — should still see OUT
          ],
        ),
    })

    const container = document.createElement('div')
    mountApp(container, App)
    const outerEls = container.querySelectorAll('span.o')
    const innerEls = container.querySelectorAll('span.i')
    expect(outerEls.length).toBe(2)
    expect(innerEls.length).toBe(1)
    expect(outerEls[0]!.getAttribute('data-val')).toBe('OUT')
    expect(innerEls[0]!.getAttribute('data-val')).toBe('IN')
    expect(outerEls[1]!.getAttribute('data-val')).toBe('OUT') // restored after inner
  })

  it('works across each() item rendering', () => {
    type State = { theme: string; items: Array<{ id: number; label: string }> }
    const ThemeCtx = createContext<string>()

    const App = component<State, never, never>({
      name: 'App',
      init: () => [
        {
          theme: 'dark',
          items: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
          ],
        },
        [],
      ],
      update: (s) => [s, []],
      view: () =>
        provide(
          ThemeCtx,
          (s: State) => s.theme,
          () =>
            each<State, { id: number; label: string }, never>({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => {
                const theme = useContext(ThemeCtx)
                return [div({ class: (s: State) => `row ${theme(s)}` }, [text(item.label)])]
              },
            }),
        ),
    })

    const container = document.createElement('div')
    mountApp(container, App)
    const rows = container.querySelectorAll('.row')
    expect(rows.length).toBe(2)
    expect(rows[0]!.className).toBe('row dark')
    expect(rows[1]!.className).toBe('row dark')
  })

  it('works across show() conditional rendering', () => {
    type State = { level: 'a' | 'b'; visible: boolean }
    type Msg = { type: 'toggle' }
    const LevelCtx = createContext<string>()
    let sendFn: Send<Msg>

    const App = component<State, Msg, never>({
      name: 'App',
      init: () => [{ level: 'a', visible: true }, []],
      update: (s, m) => (m.type === 'toggle' ? [{ ...s, visible: !s.visible }, []] : [s, []]),
      view: ({ send }) => {
        sendFn = send
        return provide(
          LevelCtx,
          (s: State) => s.level,
          () => [
            ...show<State, Msg>({
              when: (s) => s.visible,
              render: () => {
                const lvl = useContext(LevelCtx)
                return [span({ class: 'inside', 'data-lvl': (s: State) => lvl(s) })]
              },
            }),
          ],
        )
      },
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    })

    const container = document.createElement('div')
    const handle = mountApp(container, App)
    expect(container.querySelector('.inside')!.getAttribute('data-lvl')).toBe('a')
    // Hide then re-show — context should still be accessible
    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.inside')).toBeNull()
    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(container.querySelector('.inside')!.getAttribute('data-lvl')).toBe('a')
  })
})

describe('provideValue + useContextValue', () => {
  it('publishes a static dispatcher bag and consumes it without an accessor wrapper', () => {
    // The canonical use case: a layout-owned action dispatcher that
    // pages call into. Pre-fix, callers had to do
    //   useContext(Ctx)(undefined as never).open(...)
    // because useContext only returned the (s) => T accessor form.
    interface AuthDispatchers {
      logins: string[]
      login: (user: string) => void
      logout: () => void
    }
    const AuthCtx = createContext<AuthDispatchers>(undefined, 'Auth')

    const dispatchers: AuthDispatchers = {
      logins: [],
      login: (user) => {
        dispatchers.logins.push(`in:${user}`)
      },
      logout: () => {
        dispatchers.logins.push('out')
      },
    }

    function loginButton(): Node[] {
      const auth = useContextValue(AuthCtx)
      return [
        button(
          {
            class: 'login-btn',
            onClick: () => auth.login('alice'),
          },
          [text('Sign in')],
        ),
      ]
    }

    function logoutButton(): Node[] {
      const auth = useContextValue(AuthCtx)
      return [
        button(
          {
            class: 'logout-btn',
            onClick: () => auth.logout(),
          },
          [text('Sign out')],
        ),
      ]
    }

    const App = component<{ count: number }, never, never>({
      name: 'App',
      init: () => [{ count: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...provideValue(AuthCtx, dispatchers, () => [
          div({ class: 'app' }, [...loginButton(), ...logoutButton()]),
        ]),
      ],
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    mountApp(container, App)

    const loginBtn = container.querySelector('.login-btn') as HTMLButtonElement
    const logoutBtn = container.querySelector('.logout-btn') as HTMLButtonElement
    loginBtn.click()
    logoutBtn.click()
    loginBtn.click()

    // The dispatchers got the calls — context delivered the same
    // object, not a stale snapshot or a "context not found" throw.
    expect(dispatchers.logins).toEqual(['in:alice', 'out', 'in:alice'])

    container.remove()
  })

  it('useContextValue resolves the same value provideValue published', () => {
    type Settings = { theme: 'light' | 'dark'; locale: string }
    const SettingsCtx = createContext<Settings>(undefined, 'Settings')

    const settings: Settings = { theme: 'dark', locale: 'en' }

    let captured: Settings | undefined
    function consumer(): Node[] {
      captured = useContextValue(SettingsCtx)
      return [div({ class: 'consumer' })]
    }

    const App = component<{ x: number }, never, never>({
      name: 'App',
      init: () => [{ x: 0 }, []],
      update: (s) => [s, []],
      view: () => [...provideValue(SettingsCtx, settings, () => [...consumer()])],
    })

    const container = document.createElement('div')
    mountApp(container, App)
    expect(captured).toBe(settings)
  })

  it('falls back to createContext default when no provideValue ancestor exists', () => {
    interface Defaults {
      label: string
    }
    const Ctx = createContext<Defaults>({ label: 'fallback' }, 'Defaults')

    let captured: Defaults | undefined
    function consumer(): Node[] {
      captured = useContextValue(Ctx)
      return [div()]
    }

    const App = component<{}, never, never>({
      name: 'App',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [...consumer()],
    })

    const container = document.createElement('div')
    mountApp(container, App)
    // useContext returns `() => default`, so useContextValue calls it
    // with undefined and gets the default value back.
    expect(captured).toEqual({ label: 'fallback' })
  })

  it('throws clearly when no provider and no default value is set', () => {
    const Ctx = createContext<{ x: number }>(undefined, 'Required')

    function consumer(): Node[] {
      useContextValue(Ctx) // ← should throw
      return [div()]
    }

    const App = component<{}, never, never>({
      name: 'App',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [...consumer()],
    })

    const container = document.createElement('div')
    expect(() => mountApp(container, App)).toThrow(/no provider found/)
  })
})
