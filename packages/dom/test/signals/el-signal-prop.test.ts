import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el } from '../../src/signals/dom'

// The compiler lowers authoring elements (`button({...})`) to the `el(...)`
// primitive and lowers INLINE `state.map(...)` props to `react(...)`. But when a
// signal prop is a VARIABLE (a local const `const off = state.map(...)`, a spread,
// a helper return) the compiler can't see it's a signal, so it passes the raw
// handle straight to `el`. `el` must treat a raw signal handle prop as a reactive
// binding — exactly like the authoring helpers do — instead of stringifying it to
// the attribute as "[object Object]" (a silently-permanently-disabled button).

interface S {
  off: boolean
  label: string
}
type M = { type: 'enable' } | { type: 'rename' }

describe('el() with a raw signal-handle prop value', () => {
  function mount() {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => [{ off: true, label: 'a' }, []],
      update: (s, m) => [m.type === 'enable' ? { ...s, off: false } : { ...s, label: 'b' }, []],
      view: ({ state }) => {
        // signal stored in a local const — the case the compiler cannot lower
        const disabledSig = state.map((s) => s.off)
        const titleSig = state.map((s) => s.label)
        // Cast: `el`'s PropValue type doesn't list signals (the compiler emits
        // these as JS, untyped). This mirrors what the compiler produces when a
        // signal prop is a variable it can't lower.
        return [
          el('button', {
            type: 'button',
            disabled: disabledSig,
            title: titleSig,
          } as unknown as Record<string, never>),
        ]
      },
    })
    return { h, btn: () => container.querySelector('button')! }
  }

  it('binds a raw signal prop reactively (boolean attr) instead of stringifying it', () => {
    const { h, btn } = mount()
    // Initially disabled — must be a real boolean attr, never "[object Object]".
    expect(btn().getAttribute('disabled')).not.toBe('[object Object]')
    expect((btn() as HTMLButtonElement).disabled).toBe(true)
    h.send({ type: 'enable' })
    expect((btn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('binds a raw signal prop reactively (string attr)', () => {
    const { h, btn } = mount()
    expect(btn().getAttribute('title')).toBe('a')
    h.send({ type: 'rename' })
    expect(btn().getAttribute('title')).toBe('b')
  })
})
