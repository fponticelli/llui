import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text, show, branch } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// Regression: `show`/`branch` arms that pass their NARROWED param to a HELPER
// function — the shape the compiler must leave verbatim (lowering it would emit a
// param-less `() => [...]` arm with a free `u`/`v`). This exercises the runtime
// authoring path the verbatim fallback resolves to: it must bind a real narrowed
// signal handle for the helper to consume. Mirrors the dashboard each/helper bug,
// but for the union-narrowing primitives.

interface User {
  name: string
  age: number
}
type View =
  | { kind: 'loading' }
  | { kind: 'loaded'; title: string }
  | { kind: 'error'; message: string }

interface S {
  user: User | null
  view: View
}
type M = { type: 'login' } | { type: 'load'; title: string } | { type: 'fail'; message: string }

// helper arms that consume the narrowed signal handle (not a value)
const profileCard = (u: Signal<User>): Node =>
  div({ class: 'profile' }, [text(u.map((x) => `${x.name} (${x.age})`))])
const loadedView = (v: Signal<{ kind: 'loaded'; title: string }>): Node =>
  span({ class: 'title' }, [text(v.at('title'))])

describe('show/branch arms passing the narrowed param to a helper', () => {
  it('show: binds the narrowed handle for a helper arm + stays reactive', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ user: null, view: { kind: 'loading' } }),
      update: (s, m) => (m.type === 'login' ? { ...s, user: { name: 'Ada', age: 36 } } : s),
      view: ({ state }) => [
        show(
          state.at('user'),
          (u) => [profileCard(u)],
          () => [text('(signed out)')],
        ),
      ],
    })

    expect(container.textContent).toContain('(signed out)') // cond falsy -> else arm
    expect(container.querySelector('.profile')).toBeNull()

    h.send({ type: 'login' }) // cond truthy -> helper arm with narrowed handle
    expect(container.querySelector('.profile')!.textContent).toBe('Ada (36)')
    h.dispose()
  })

  it('branch: binds the narrowed variant handle for a helper arm + swaps arms', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ user: null, view: { kind: 'loading' } }),
      update: (s, m) =>
        m.type === 'load'
          ? { ...s, view: { kind: 'loaded', title: m.title } }
          : m.type === 'fail'
            ? { ...s, view: { kind: 'error', message: m.message } }
            : s,
      view: ({ state }) => [
        branch(state.at('view'), (v) => v.kind, {
          loading: () => [text('loading…')],
          loaded: (v) => [loadedView(v)],
          error: (v) => [span({ class: 'err' }, [text(v.at('message'))])],
        }),
      ],
    })

    expect(container.textContent).toContain('loading…')

    h.send({ type: 'load', title: 'Report' }) // narrowed handle reaches the helper
    expect(container.querySelector('.title')!.textContent).toBe('Report')
    expect(container.textContent).not.toContain('loading…')

    h.send({ type: 'fail', message: 'boom' }) // swap to a different narrowed arm
    expect(container.querySelector('.title')).toBeNull()
    expect(container.querySelector('.err')!.textContent).toBe('boom')
    h.dispose()
  })
})
