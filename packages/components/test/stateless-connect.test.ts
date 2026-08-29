import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, constant, noSend, div, span, text, type Send } from '@llui/dom'
import * as meter from '../src/components/meter'

// `constant()` + `noSend` — the STATELESS half of the `connect(state, send, opts)`
// contract.
//
// All 72 `connect()` entry points in this package demand `Signal<S>` + `Send<M>`
// (71 spelled `export function connect(`, plus `async-list`'s generic
// `export function connect<T>(` — a non-generic grep misses that one and reports
// 71). So a widget whose values are fixed FOR THE LIFE OF THE NODE — a rendered
// lab result, a badge, a sparkline — had no way to call one without hoisting a
// state slice per widget into an ancestor component's `State`. Four machines
// already name their dispatcher `_send` and ignore it outright — `meter`,
// `progress`, `fieldset`, `in-view` — and `meter` is the one exercised here
// because its part bag is pure derived output with no interaction to fake.
//
// Attribution: this answers #235's "Note on the state model" — dozens of static
// meters on a page, no TEA runtime per meter, "a pure geometry + attributes entry
// point … more useful here than `connect()` alone". It is NOT #231, whose
// motivating widget (a copy button whose `copied` boolean flips and resets after
// 1.5 s) has state that CHANGES; that is answered by `island()`.
//
// This half of the verification lives in `@llui/components` because `@llui/dom`
// cannot depend on it (that edge would be a cycle), and a unit test inside
// `@llui/dom` can only prove the handle's carrier, never that a REAL part bag
// resolves through it.

interface HostState {
  /** Unrelated host state, to prove the constant survives host updates. */
  tick: number
}
type HostMsg = { type: 'tick' }

describe('constant() + noSend drive a real connect()', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  const SODIUM = meter.init({ value: 42, min: 0, max: 200, low: 50, high: 150, optimum: 100 })

  function mount() {
    let sendRef!: Send<HostMsg>
    const def = component<HostState, HostMsg, never>({
      name: 'Host',
      init: () => [{ tick: 0 }, []],
      update: (s, m) => [m.type === 'tick' ? { tick: s.tick + 1 } : s, []],
      view: ({ state, send }) => {
        sendRef = send
        // The whole point: the meters' state is NOT in HostState and their
        // messages are NOT in HostMsg. Nothing was hoisted.
        //
        // TWO wirings, because they exercise DIFFERENT chains and only one of
        // them was covered at first. Every `meter` part-bag value is a
        // `state.map(...)`, so a bare `constant` proves `constant -> .map() ->
        // binding` and says nothing about `.at()` — measured: with `constant`'s
        // `at:` mutated to `pathHandle(() => value, path)` this file stayed fully
        // green. The `fixtures.at('sodium')` wiring is the realistic shape anyway
        // (one constant holding every widget's fixtures, sliced per widget) and
        // covers `constant -> .at() -> .map() -> binding`.
        const direct = meter.connect(constant(SODIUM), noSend, { label: 'Sodium' })
        const fixtures = constant({ sodium: SODIUM })
        const sliced = meter.connect(fixtures.at('sodium'), noSend, { label: 'Sodium' })
        const gauge = (p: meter.MeterParts) =>
          div({ ...p.root }, [
            div({ ...p.track }, [div({ ...p.range }, [])]),
            span({ ...p.label }, [text(p.valueText)]),
          ])
        return [
          div({ id: 'direct' }, [gauge(direct)]),
          div({ id: 'sliced' }, [gauge(sliced)]),
          // A reactive sibling, so the host really does re-commit around them.
          span({ 'data-part': 'tick' }, [text(state.at('tick').map(String))]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: HostMsg) => sendRef(m), flush: () => app!.flush() }
  }

  /** `#direct` = `constant(v)`; `#sliced` = `constant({…}).at('sodium')`. */
  const part = (host: 'direct' | 'sliced', name: string) =>
    document.querySelector(`#${host} [data-part="${name}"]`)!
  const tick = () => document.querySelector('[data-part="tick"]')!
  const HOSTS = ['direct', 'sliced'] as const

  it.each(HOSTS)(
    'the %s part bag resolves to real attributes (not empty, not "[object Object]")',
    (host) => {
      mount()
      const r = part(host, 'root')
      expect(r.getAttribute('role')).toBe('meter')
      expect(r.getAttribute('aria-valuenow')).toBe('42')
      expect(r.getAttribute('aria-valuemin')).toBe('0')
      expect(r.getAttribute('aria-valuemax')).toBe('200')
      expect(r.getAttribute('aria-valuetext')).toBe('21%')
      expect(r.getAttribute('aria-label')).toBe('Sodium')
      // 42 < low(50) and optimum(100) is in the middle band -> adjacent -> 'high'.
      expect(r.getAttribute('data-state')).toBe('high')
      expect(part(host, 'range').getAttribute('style')).toContain('21%')
      expect(part(host, 'label').textContent).toBe('21%')
    },
  )

  it.each(HOSTS)(
    'the %s wiring survives host updates — no stale or blank derived attributes',
    (host) => {
      const { send, flush } = mount()
      const before = part(host, 'root')
      for (let i = 0; i < 5; i++) send({ type: 'tick' })
      flush()
      expect(tick().textContent).toBe('5') // the host really did re-commit
      expect(part(host, 'root')).toBe(before) // same node
      expect(before.getAttribute('aria-valuenow')).toBe('42')
      expect(before.getAttribute('aria-valuetext')).toBe('21%')
      expect(before.getAttribute('data-state')).toBe('high')
      expect(part(host, 'range').getAttribute('style')).toContain('21%')
    },
  )

  it('noSend is accepted where Send<MeterMsg> is required, and swallows a dispatch', () => {
    // The type check is `pnpm check`; this pins the runtime half.
    const send: Send<meter.MeterMsg> = noSend
    expect(send({ type: 'setValue', value: 9 })).toBeUndefined()
  })
})
