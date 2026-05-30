import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { ul, li, text, each } from '../../src/signals/authoring'

// Regression: a binding rooted at the COMPONENT state (e.g. a `connect()` part
// like tags-input's `data-focused` = state.at('focusedIndex').map(f => f === i))
// placed inside an authoring `each` row. The row scope mounts on the combined row
// ctx `{ item, state, index }`, so a component-state-rooted produce `(s) =>
// s.focused` would read `ctx.focused` (undefined) and CRASH at mount. The runtime
// re-roots such specs to read `ctx.state`. (This crash blanked the whole
// components-demo, whose sections render component item-lists via `each` + connect
// per-item parts.)

interface S {
  items: readonly string[]
  focused: number
}
type M = { type: 'focus'; i: number }

describe('authoring each — component-state read inside a row', () => {
  it('resolves a component-state binding placed in a row (no crash) + stays reactive', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ items: ['a', 'b', 'c'], focused: 0 }),
      update: (s, m) => (m.type === 'focus' ? { ...s, focused: m.i } : s),
      view: ({ state }) => [
        ul([
          each(
            state.map((s) => s.items),
            {
              key: (it) => it,
              // The per-row `data-focused` reads COMPONENT state (focused) and the
              // captured row index — the connect-part-in-each shape that crashed.
              render: (item, index) => [
                li(
                  {
                    'data-focused': state
                      .at('focused')
                      .map((f) => (f === index.peek() ? '' : undefined)),
                  },
                  [text(item)],
                ),
              ],
            },
          ),
        ]),
      ],
    })

    const lis = container.querySelectorAll('li')
    expect(lis.length).toBe(3) // rows rendered — no crash
    expect([...lis].map((el) => el.textContent)).toEqual(['a', 'b', 'c'])
    expect(lis[0]!.getAttribute('data-focused')).toBe('') // focused=0
    expect(lis[1]!.getAttribute('data-focused')).toBeNull()

    h.send({ type: 'focus', i: 2 }) // component-state change reaches the rows
    const after = container.querySelectorAll('li')
    expect(after[0]!.getAttribute('data-focused')).toBeNull()
    expect(after[2]!.getAttribute('data-focused')).toBe('')
    h.dispose()
  })
})
