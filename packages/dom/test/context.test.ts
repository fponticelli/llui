import { describe, it, expect } from 'vitest'
import {
  mountApp,
  component,
  div,
  span,
  text,
  each,
  show,
  createContext,
  provide,
  useContext,
} from '../src/index'
import type { Send } from '../src/types'

describe('createContext + provide + useContext', () => {
  it('consumer reads value from ancestor provider', () => {
    type State = { theme: 'light' | 'dark' }
    const ThemeCtx = createContext<'light' | 'dark'>()

    function card(): Node[] {
      const theme = useContext(ThemeCtx)
      return [div({ class: (s) => `card theme-${theme(s)}` }, [text('content')])]
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
      return [span({ class: (s) => `box ${t(s)}` })]
    }

    const App = component<State, Msg, never>({
      name: 'App',
      init: () => [{ theme: 'light' }, []],
      update: (s, m) =>
        m.type === 'toggle' ? [{ theme: s.theme === 'light' ? 'dark' : 'light' }, []] : [s, []],
      view: (send) => {
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
      return [span({ class: (s) => v(s) })]
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
    const Ctx = createContext<string>()
    function leaf(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: (s) => v(s) })]
    }
    const App = component<Record<string, never>, never, never>({
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
      return [span({ class: 'o', 'data-val': (s) => v(s) })]
    }
    function inner(): Node[] {
      const v = useContext(Ctx)
      return [span({ class: 'i', 'data-val': (s) => v(s) })]
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
                return [div({ class: (s) => `row ${theme(s)}` }, [text(item.label)])]
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
      view: (send) => {
        sendFn = send
        return provide(
          LevelCtx,
          (s: State) => s.level,
          () => [
            ...show<State, Msg>({
              when: (s) => s.visible,
              render: () => {
                const lvl = useContext(LevelCtx)
                return [span({ class: 'inside', 'data-lvl': (s) => lvl(s) })]
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
