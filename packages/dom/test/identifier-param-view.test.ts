// Regression test for issue #5 — identifier-style `view: (h) => …` must
// receive a full view bag at runtime, not the `{ send }`-only fallback
// the prod path used to ship.
//
// The compiler now emits `__view: ($send) => createView($send)` for
// every non-destructured view param; this test exercises the runtime
// side by hand-rolling that same factory on a ComponentDef and mounting it.

import { describe, it, expect } from 'vitest'
import { component, mountApp, createView, div, button } from '../src/index'
import type { View } from '../src/index'

describe('identifier-param view bag (issue #5)', () => {
  type State = { count: number; visible: boolean; items: number[] }
  type Msg = { type: 'inc' } | { type: 'toggle' }

  // Helper that takes `h: View<S, M>` and reaches for ~every primitive
  // — text, show, each, branch, memo — so a partial bag would crash on
  // first call. Mirrors the real-world helper-passing pattern from the
  // issue report.
  function panel(h: View<State, Msg>) {
    return [
      div({ class: 'count' }, [h.text((s) => String(s.count))]),
      ...h.show({
        when: (s) => s.visible,
        render: () => [div({ class: 'visible-marker' }, [h.text('shown')])],
      }),
      div(
        { class: 'list' },
        h.each<number>({
          items: (s) => s.items,
          key: (n) => n,
          render: () => [div({ class: 'item' }, [h.text('row')])],
        }),
      ),
      ...h.branch({
        on: (s) => (s.count > 0 ? 'has' : 'none'),
        cases: {
          has: () => [div({ class: 'branch-has' })],
          none: () => [div({ class: 'branch-none' })],
        },
      }),
    ]
  }

  const App = component<State, Msg, never>({
    name: 'App',
    init: () => [{ count: 0, visible: false, items: [] }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [
            { ...state, count: state.count + 1, items: [...state.items, state.items.length] },
            [],
          ]
        case 'toggle':
          return [{ ...state, visible: !state.visible }, []]
      }
    },
    view: (h) => [
      button({ class: 'inc', onClick: () => h.send({ type: 'inc' }) }),
      button({ class: 'toggle', onClick: () => h.send({ type: 'toggle' }) }),
      ...panel(h),
    ],
    __compilerVersion: '__test__',
    // Simulates the new compiler output for identifier-param views.
    // Pre-fix the runtime fallback would have handed `panel(h)` a
    // `{ send }`-only bag and crashed on the first `h.text(...)`.
    __view: ($send) => createView<State, Msg>($send),
  })

  it('renders all primitives at mount without crashing', () => {
    const container = document.createElement('div')
    mountApp(container, App)
    expect(container.querySelector('.count')?.textContent).toBe('0')
    expect(container.querySelector('.visible-marker')).toBeNull()
    expect(container.querySelector('.branch-none')).not.toBeNull()
  })

  it('text/each/show/branch all stay reactive', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, App)
    const inc = container.querySelector('.inc') as HTMLElement
    const toggle = container.querySelector('.toggle') as HTMLElement

    inc.click()
    inc.click()
    inc.click()
    toggle.click()
    handle.flush()

    expect(container.querySelector('.count')?.textContent).toBe('3')
    expect(container.querySelector('.visible-marker')).not.toBeNull()
    expect(container.querySelectorAll('.item')).toHaveLength(3)
    expect(container.querySelector('.branch-has')).not.toBeNull()
    expect(container.querySelector('.branch-none')).toBeNull()
  })

  it('survives without a hand-rolled __view (runtime fallback covers it)', () => {
    // Pre-fix this configuration crashed in production: no __view, no
    // __prefixes, view: (h) => h.text(...). Both fallbacks (full-bag in
    // render-context, FULL_MASK in update-loop) now fire in every mode.
    const Stripped = component<State, Msg, never>({
      name: 'Stripped',
      init: () => [{ count: 0, visible: false, items: [] }, []],
      update: (state, msg) => {
        if (msg.type === 'inc') return [{ ...state, count: state.count + 1 }, []]
        return [state, []]
      },
      view: (h) => [
        button({ class: 'inc', onClick: () => h.send({ type: 'inc' }) }),
        div({ class: 'count' }, [h.text((s) => String(s.count))]),
      ],
      __compilerVersion: '__test__',
      // intentionally no __view, no __prefixes
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Stripped)
    expect(container.querySelector('.count')?.textContent).toBe('0')
    ;(container.querySelector('.inc') as HTMLElement).click()
    handle.flush()
    expect(container.querySelector('.count')?.textContent).toBe('1')
  })
})
