import { describe, it, expect } from 'vitest'
import { parseModule, collectSignalDeps } from '@llui/compiler'
import { compileAndLoad } from './compile-and-load'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, text } from '../../src/signals/authoring'
import { el, signalText, react } from '../../src/signals/dom'
import { derived } from '../../src/signals/handle'
import { signalIsland } from '../../src/signals/island'
import type { SignalComponentDef } from '../../src/signals/component'

// The props channel is only worth having if it survives COMPILATION: an island's
// `props` is authored as an ordinary signal expression, so the transform must leave
// it as a live handle (it lowers nothing it does not recognise) and the dep analyzer
// must see its paths. Both are checked against the real compiler, not asserted in
// prose — a `props` the transform erased to a bare accessor would still type-check
// and would then feed the island `undefined` forever.

interface PropState {
  value: string
  applied: number
}
type PropMsg = { type: 'setValue'; value: string }

const PropChild = component<PropState, PropMsg>({
  name: 'PropChild',
  init: () => ({ value: 'INIT', applied: 0 }),
  update: (s, m) => (m.type === 'setValue' ? { value: m.value, applied: s.applied + 1 } : s),
  view: ({ state }) => [
    div({ class: 'prop' }, [
      text(derived(state.at('value'), state.at('applied'), (v, n) => `${v}#${n}`)),
    ]),
  ],
})

const AUTHORED = `
export const Host = component<{ token: string; unrelated: number }, { type: 'bump' } | { type: 'setToken'; v: string }>({
  name: 'Host',
  init: () => ({ token: 'a', unrelated: 0 }),
  update: (s, m) =>
    m.type === 'setToken' ? { ...s, token: m.v } : { ...s, unrelated: s.unrelated + 1 },
  view: ({ state }) => [
    div({ class: 'shell' }, [text(state.at('token'))]),
    island({
      def: PropChild,
      props: state.at('token'),
      onProps: (value) => ({ type: 'setValue', value }),
    }),
  ],
})
`

describe('island under the real compiler transform', () => {
  it('the dep analyzer sees the props signal path', () => {
    const deps = collectSignalDeps(parseModule('host.tsx', AUTHORED))
    // `token` is read twice — once by the shell text, once as the island's prop —
    // and BOTH must be reported. A missed dep is a mask that gates out a binding it
    // actually reads, i.e. a permanently stale island.
    expect(deps.paths).toContain('token')
    expect(deps.paths).not.toContain('unrelated')
  })

  it('compiles to a component whose island still receives its props', () => {
    const Host = compileAndLoad(AUTHORED, 'Host', {
      component,
      div,
      text,
      el,
      signalText,
      react,
      island: signalIsland,
      PropChild,
    }) as SignalComponentDef<
      { token: string; unrelated: number },
      { type: 'bump' } | { type: 'setToken'; v: string }
    >

    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host)
    expect(container.querySelector('.shell')?.textContent).toBe('a')
    expect(container.querySelector('.prop')?.textContent).toBe('a#1')

    host.send({ type: 'setToken', v: 'b' })
    expect(container.querySelector('.prop')?.textContent).toBe('b#2')

    // Still mask-gated after compilation.
    host.send({ type: 'bump' })
    expect(container.querySelector('.prop')?.textContent).toBe('b#2')
    host.dispose()
  })
})
