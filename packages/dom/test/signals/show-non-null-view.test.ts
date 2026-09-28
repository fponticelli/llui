import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text, show, each, type ShowCondition } from '../../src/signals/authoring'
import { constant, isSignalHandle, pathHandle } from '../../src/signals/handle'
import { isFrameworkError } from '../../src/signals/framework-error'
import type { MappedSignal, ReadSignal, Signal } from '../../src/signals/types'

// `show(cond, render)` hands its arm the condition's NON-NULL VIEW: the same signal,
// typed `NonNullable<T>`. The type is only true while the arm is mounted — the arm
// renders while `cond` is truthy — but a handler or callback can hold the view past
// that point (its own `send()` closes the arm synchronously, a timer fires later).
// These pin that the view ENFORCES its type: a read that would hand back null or
// undefined throws a branded LluiFrameworkError naming the fix, instead of returning
// a value the type says cannot exist. They also pin that the view keeps the
// condition's semantics exactly (path slicing, deps, reactivity, row rooting).

interface Profile {
  name: string
  tags: readonly string[]
}
interface S {
  user: Profile | null
  count: number
}
type M = { type: 'login' } | { type: 'logout' } | { type: 'rename'; name: string } | { type: 'inc' }

const init = (): S => ({ user: null, count: 0 })
const update = (s: S, m: M): S => {
  switch (m.type) {
    case 'login':
      return { ...s, user: { name: 'Ada', tags: ['a'] } }
    case 'logout':
      return { ...s, user: null }
    case 'rename':
      return s.user ? { ...s, user: { ...s.user, name: m.name } } : s
    case 'inc':
      return { ...s, count: s.count + 1 }
  }
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected a throw')
}

describe('show(): the arm receives a non-null VIEW of a path condition', () => {
  it('reads, slices and stays reactive while the arm is mounted', () => {
    const container = document.createElement('div')
    let view: Signal<Profile> | undefined
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        show(state.at('user'), (u) => {
          view = u
          return [span({ class: 'name' }, [text(u.at('name'))])]
        }),
      ],
    })
    h.send({ type: 'login' })
    expect(container.querySelector('.name')!.textContent).toBe('Ada')
    h.send({ type: 'rename', name: 'Grace' })
    expect(container.querySelector('.name')!.textContent).toBe('Grace')
    expect(view!.peek().name).toBe('Grace')
    expect(view!.at('name').peek()).toBe('Grace')
    expect(view!.map((p) => p.tags.length).peek()).toBe(1)
    h.dispose()
  })

  it('keeps PATH semantics: `.at()` slices by path with the same deps as the condition', () => {
    const container = document.createElement('div')
    let view: Signal<Profile> | undefined
    let cond: Signal<Profile | null> | undefined
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ user: { name: 'Ada', tags: ['x', 'y'] }, count: 0 }),
      update,
      view: ({ state }) => {
        cond = state.at('user')
        return [
          show(cond, (u) => {
            view = u
            return [text('on')]
          }),
        ]
      },
    })
    const sliced = view!.at('name')
    const direct = cond!.at('name')
    expect(isSignalHandle(view)).toBe(true)
    expect(isSignalHandle(sliced) && isSignalHandle(direct)).toBe(true)
    if (!isSignalHandle(view) || !isSignalHandle(cond)) throw new Error('unreachable')
    if (!isSignalHandle(sliced) || !isSignalHandle(direct)) throw new Error('unreachable')
    expect(view.deps).toEqual(cond.deps)
    expect(sliced.deps).toEqual(direct.deps)
    expect(sliced.deps).toEqual(['user.name'])
    expect(view.rowLocal).toBe(cond.rowLocal)
    // a slice of the view is still a PATH signal (sliceable again), never a mapped layer
    expect(view.at('tags').at('1').peek()).toBe('y')
    h.dispose()
  })

  it('throws a branded error when the view is peeked after the condition cleared', () => {
    const container = document.createElement('div')
    let view: Signal<Profile> | undefined
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        show(state.at('user'), (u) => {
          view = u
          return [text('on')]
        }),
      ],
    })
    h.send({ type: 'login' })
    h.send({ type: 'logout' })
    const err = caught(() => view!.peek())
    expect(isFrameworkError(err)).toBe(true)
    const message = (err as Error).message
    expect(message).toContain('show()')
    expect(message).toContain("'user'")
    expect(message).toContain('null')
    expect(message).toContain('.peek()')
    h.dispose()
  })

  it('a slice or map of the view enforces the same guarantee', () => {
    const container = document.createElement('div')
    let view: Signal<Profile> | undefined
    const seen: unknown[] = []
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        show(state.at('user'), (u) => {
          view = u
          return [text('on')]
        }),
      ],
    })
    h.send({ type: 'login' })
    const name = view!.at('name')
    const tagCount = view!.map((p) => {
      seen.push(p)
      return p.tags.length
    })
    h.send({ type: 'logout' })
    expect(isFrameworkError(caught(() => name.peek()))).toBe(true)
    expect(isFrameworkError(caught(() => tagCount.peek()))).toBe(true)
    // the mapping function never saw the null the view refused to hand out
    expect(seen).not.toContain(null)
    h.dispose()
  })

  it('reaches the throw from an arm handler whose own send() closed the arm', () => {
    const container = document.createElement('div')
    let err: unknown
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ user: { name: 'Ada', tags: [] }, count: 0 }),
      update,
      view: ({ state, send }) => [
        show(state.at('user'), (u) => [
          div(
            {
              class: 'out',
              onClick: () => {
                send({ type: 'logout' })
                try {
                  u.peek()
                } catch (e) {
                  err = e
                }
              },
            },
            [text('sign out')],
          ),
        ]),
      ],
    })
    const out = container.querySelector<HTMLElement>('.out')!
    out.click()
    expect(isFrameworkError(err)).toBe(true)
    expect(container.querySelector('.out')).toBeNull()
    h.dispose()
  })
})

describe('show(): the arm receives a non-null VIEW of a mapped or read-only condition', () => {
  it('a mapped condition: reads while mounted, throws once cleared, never feeds null to map', () => {
    const container = document.createElement('div')
    let view: MappedSignal<Profile> | undefined
    const seen: unknown[] = []
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        show(
          state.map((s) => s.user),
          (u) => {
            view = u
            return [
              span({ class: 'name' }, [
                text(
                  u.map((p) => {
                    seen.push(p)
                    return p.name
                  }),
                ),
              ]),
            ]
          },
        ),
      ],
    })
    h.send({ type: 'login' })
    expect(container.querySelector('.name')!.textContent).toBe('Ada')
    h.send({ type: 'rename', name: 'Grace' })
    expect(container.querySelector('.name')!.textContent).toBe('Grace')
    expect(view!.peek().name).toBe('Grace')
    h.send({ type: 'logout' })
    expect(container.querySelector('.name')).toBeNull()
    const err = caught(() => view!.peek())
    expect(isFrameworkError(err)).toBe(true)
    expect((err as Error).message).toContain('show()')
    expect(seen).not.toContain(null)
    h.dispose()
  })

  it('a ReadSignal helper parameter: the arm gets a ReadSignal view of either kind', () => {
    const helper = (sig: ReadSignal<Profile | null>) =>
      show(sig, (u) => [span({ class: 'name' }, [text(u.map((p) => p.name))])])
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        div({ class: 'path' }, [helper(state.at('user'))]),
        div({ class: 'mapped' }, [helper(state.map((s) => s.user))]),
      ],
    })
    h.send({ type: 'login' })
    expect(container.querySelector('.path .name')!.textContent).toBe('Ada')
    expect(container.querySelector('.mapped .name')!.textContent).toBe('Ada')
    h.dispose()
  })

  it('a constant condition renders its arm with a sliceable view', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: () => [
        show(constant<Profile | null>({ name: 'Const', tags: [] }), (u) => [
          span({ class: 'name' }, [text(u.at('name'))]),
        ]),
        show(constant<Profile | null>(null), (u) => [
          span({ class: 'never' }, [text(u.at('name'))]),
        ]),
      ],
    })
    expect(container.querySelector('.name')!.textContent).toBe('Const')
    expect(container.querySelector('.never')).toBeNull()
    h.dispose()
  })

  it('a free-standing pathHandle condition narrows the same way', () => {
    let live: Profile | null = { name: 'Free', tags: [] }
    const sig = pathHandle<Profile | null>(() => ({ user: live }), 'user')
    let view: Signal<Profile> | undefined
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ user: { name: 'State', tags: [] }, count: 0 }),
      update,
      view: () => [
        show(sig, (u) => {
          view = u
          return [text('on')]
        }),
      ],
    })
    expect(view!.peek().name).toBe('Free')
    live = null
    expect(isFrameworkError(caught(() => view!.peek()))).toBe(true)
    h.dispose()
  })
})

describe('show(): the binding read (produce) enforces the same guarantee as peek', () => {
  // Arm bindings read through `produce(state)`, not `peek()`. The reconciler never
  // hands a mounted arm a cleared condition, so these call `produce` directly with
  // such a state: the view's type promises non-null to every reader, not only to
  // the ones the scheduler happens to order safely.
  const cleared: S = { user: null, count: 0 }
  const live: S = { user: { name: 'Ada', tags: [] }, count: 0 }

  function capture<View>(cond: (state: Signal<S>) => ShowCondition<View>): View {
    let view: View | undefined
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => live,
      update,
      view: ({ state }) => [
        show(cond(state), (u) => {
          view = u
          return [text('on')]
        }),
      ],
    })
    h.dispose()
    if (view === undefined) throw new Error('arm never mounted')
    return view
  }

  it('path view, its slice and its map', () => {
    const view = capture((state) => state.at('user'))
    if (!isSignalHandle(view)) throw new Error('not a handle')
    expect(view.produce(live)).toEqual(live.user)
    expect(isFrameworkError(caught(() => view.produce(cleared)))).toBe(true)
    const sliced = view.at('name')
    const mapped = view.map((p) => p.name)
    if (!isSignalHandle(sliced) || !isSignalHandle(mapped)) throw new Error('not a handle')
    expect(sliced.produce(live)).toBe('Ada')
    expect(isFrameworkError(caught(() => sliced.produce(cleared)))).toBe(true)
    expect(isFrameworkError(caught(() => mapped.produce(cleared)))).toBe(true)
  })

  it('mapped view and its map', () => {
    const view = capture((state) => state.map((s) => s.user))
    if (!isSignalHandle(view)) throw new Error('not a handle')
    expect(view.produce(live)).toEqual(live.user)
    expect(isFrameworkError(caught(() => view.produce(cleared)))).toBe(true)
    const mapped = view.map((p) => p.name)
    if (!isSignalHandle(mapped)) throw new Error('not a handle')
    expect(isFrameworkError(caught(() => mapped.produce(cleared)))).toBe(true)
  })
})

describe('show(): the view inside an each row keeps its rooting', () => {
  interface Row {
    id: string
    detail: { label: string } | null
  }
  interface RS {
    rows: readonly Row[]
    suffix: string
  }
  type RM = { type: 'clear'; id: string } | { type: 'suffix'; value: string }

  it('a row-local condition narrows against the row, and a component condition against state', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<RS, RM>(container, {
      init: () => ({
        rows: [
          { id: 'a', detail: { label: 'A' } },
          { id: 'b', detail: { label: 'B' } },
        ],
        suffix: '!',
      }),
      update: (s, m) =>
        m.type === 'clear'
          ? { ...s, rows: s.rows.map((r) => (r.id === m.id ? { ...r, detail: null } : r)) }
          : { ...s, suffix: m.value },
      view: ({ state }) => [
        each(state.at('rows'), {
          key: (r) => r.id,
          render: (item) => [
            div({ class: 'row' }, [
              show(item.at('detail'), (d) => [
                span({ class: 'label' }, [text(d.at('label'))]),
                show(state.at('suffix'), (sfx) => [span({ class: 'sfx' }, [text(sfx)])]),
              ]),
            ]),
          ],
        }),
      ],
    })
    const labels = (): string[] =>
      [...container.querySelectorAll('.label')].map((n) => n.textContent ?? '')
    expect(labels()).toEqual(['A', 'B'])
    expect(container.querySelectorAll('.sfx')[0]!.textContent).toBe('!')
    h.send({ type: 'suffix', value: '?' })
    expect(container.querySelectorAll('.sfx')[1]!.textContent).toBe('?')
    h.send({ type: 'clear', id: 'a' })
    expect(labels()).toEqual(['B'])
    h.dispose()
  })
})
