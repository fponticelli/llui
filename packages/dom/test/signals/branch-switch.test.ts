import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, button, text, branch } from '../../src/signals/authoring'

// The cascade-select shape: a discriminant (selected country) chooses which set of
// option buttons renders. Only the matching arm's nodes should be in the DOM, and
// switching the discriminant must swap the rendered set (not show all).

interface S {
  country: 'US' | 'IT' | null
}
type M = { type: 'pick'; c: S['country'] }

describe('authoring branch — discriminant switches the rendered arm', () => {
  it('renders only the selected arm and swaps on discriminant change', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ country: null }),
      update: (_s, m) => ({ country: m.c }),
      view: ({ state }) => [
        div({}, [
          // 2-arg form: a string-keyed discriminant (the country) selects the arm.
          branch(
            state.map((s): 'US' | 'IT' | 'none' => s.country ?? 'none'),
            {
              none: () => [text('(pick a country)')],
              US: () => [
                button({ id: 'CA' }, [text('California')]),
                button({ id: 'NY' }, [text('New York')]),
              ],
              IT: () => [
                button({ id: 'MI' }, [text('Milan')]),
                button({ id: 'RM' }, [text('Rome')]),
              ],
            },
          ),
        ]),
      ],
    })

    // initial: none arm
    expect(container.textContent).toContain('(pick a country)')
    expect(container.querySelectorAll('button').length).toBe(0)

    // pick US -> only US regions
    h.send({ type: 'pick', c: 'US' })
    expect(container.querySelector('#CA')).not.toBeNull()
    expect(container.querySelector('#NY')).not.toBeNull()
    expect(container.querySelector('#MI')).toBeNull()
    expect(container.querySelector('#RM')).toBeNull()
    expect(container.querySelectorAll('button').length).toBe(2)

    // switch to IT -> US regions gone, only IT regions (the reported bug: all 4 showing)
    h.send({ type: 'pick', c: 'IT' })
    expect(container.querySelector('#CA')).toBeNull()
    expect(container.querySelector('#NY')).toBeNull()
    expect(container.querySelector('#MI')).not.toBeNull()
    expect(container.querySelector('#RM')).not.toBeNull()
    expect(container.querySelectorAll('button').length).toBe(2)
    h.dispose()
  })
})
