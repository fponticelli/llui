import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { foreign } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// `foreign()` is a real runtime helper (like each/show/branch): when called in a
// view-helper function (not lowered by the compiler) it must build the imperative
// host and keep declared state handles reactive — not throw `compiledAway`.

interface S {
  label: string
}

describe('foreign() runtime fallback', () => {
  it('builds the host, runs mount, and pushes reactive updates from a state handle', () => {
    const container = document.createElement('div')
    const seen: string[] = []
    // A view-helper function — the compiler does NOT lower foreign() here.
    const widget = (label: Signal<string>) =>
      foreign({
        tag: 'section',
        state: { label },
        mount: ({ el, state }) => {
          state.label.bind((v) => {
            el.textContent = v
            seen.push(v)
          })
          return { el }
        },
      })

    const h = mountSignalComponent<S, { type: 'rename'; v: string }>(container, {
      init: () => ({ label: 'a' }),
      update: (s, m) => (m.type === 'rename' ? { label: m.v } : s),
      view: ({ state }) => [widget(state.at('label'))],
    })

    const section = container.querySelector('section')!
    expect(section.textContent).toBe('a') // initial value via bind
    h.send({ type: 'rename', v: 'b' })
    expect(section.textContent).toBe('b') // reactive update pushed to the LiveSignal
    expect(seen).toEqual(['a', 'b'])
    h.dispose()
  })
})
