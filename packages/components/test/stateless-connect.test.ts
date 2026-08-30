import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  component,
  mountApp,
  constant,
  noSend,
  div,
  each,
  span,
  text,
  type Send,
  type Signal,
} from '@llui/dom'
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
      // 42 < low(50), and optimum(100) sits in the middle segment -> the
      // reading is one segment away from it -> 'suboptimal'.
      expect(r.getAttribute('data-state')).toBe('suboptimal')
      expect(r.getAttribute('data-band')).toBe('low')
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
      expect(before.getAttribute('data-state')).toBe('suboptimal')
      expect(part(host, 'range').getAttribute('style')).toContain('21%')
    },
  )

  it('noSend is accepted where Send<MeterMsg> is required, and swallows a dispatch', () => {
    // The type check is `pnpm check`; this pins the runtime half.
    const send: Send<meter.MeterMsg> = noSend
    expect(send({ type: 'setValue', value: 9 })).toBeUndefined()
  })
})

// The motivating widget of #235, mounted: a lab result on a BANDED track, with
// no TEA runtime of its own. `constant()` carries the fixture, `each` draws the
// reference range from the derived layout, and the marker sits on it.
//
// Reading rendered ATTRIBUTES is the point. The unit tests read part-bag signals
// through `produce`, which cannot see a bag that fails to spread — a nested bag
// renders `[object Object]`, and a band bag returning SNAPSHOTS instead of row
// handles would render every stripe with the FIRST row's geometry.
describe('a banded meter renders from constant() with no runtime of its own', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  /** A thyroid panel: three bands of unequal width, over 0..8 mIU/L. */
  const TSH = meter.init({
    value: 2.1,
    min: 0,
    max: 8,
    bands: [
      { id: 'low', to: 0.4, tone: 'critical', label: 'low' },
      { id: 'ref', from: 0.4, to: 4, tone: 'optimal', label: 'optimal' },
      { id: 'high', from: 4, tone: 'critical', label: 'high' },
    ],
  })

  function mount() {
    const def = component<{ tick: number }, { type: 'tick' }, never>({
      name: 'Panel',
      init: () => [{ tick: 0 }, []],
      update: (s) => [{ tick: s.tick + 1 }, []],
      view: () => {
        const p = meter.connect(constant(TSH), noSend, {
          label: 'TSH',
          format: (v) => `${v} mIU/L`,
        })
        return [
          div({ ...p.root }, [
            div({ ...p.track }, [
              each(p.bands, {
                key: (b: meter.MeterBandGeometry) => b.id,
                render: (b: Signal<meter.MeterBandGeometry>) => [div({ ...p.bandProps(b) }, [])],
              }),
              div({ ...p.marker }, []),
            ]),
            span({ ...p.label }, [text(p.valueText)]),
          ]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
  }

  const bands = () => [...document.querySelectorAll('[data-part="band"]')]

  it('draws one stripe per band, each with its OWN geometry and tone', () => {
    mount()
    expect(bands().map((el) => el.getAttribute('data-band'))).toEqual(['low', 'ref', 'high'])
    expect(bands().map((el) => el.getAttribute('data-state'))).toEqual([
      'critical',
      'optimal',
      'critical',
    ])
    expect(bands().map((el) => el.getAttribute('style'))).toEqual([
      'inset-inline-start:0%;inline-size:5%;',
      'inset-inline-start:5%;inline-size:45%;',
      'inset-inline-start:50%;inline-size:50%;',
    ])
    // Only the band holding the reading is marked current.
    expect(bands().map((el) => el.hasAttribute('data-current'))).toEqual([false, true, false])
  })

  it('yields the band GEOMETRY as plain values, with no view and no mount', () => {
    // #235 asked for a "pure geometry + attributes entry point" like `chart`'s
    // `geometry(state)`. There is deliberately no per-component export for it —
    // `constant()` already answers the question, and `peek()` is what turns the
    // part bag's signals back into plain values for a consumer measuring or
    // testing a meter outside a view. `constant` is the only handle whose
    // `peek()` reads the captured value rather than a live component state, so
    // this is exactly the T1 static tier and nothing else.
    const parts = meter.connect(constant(TSH), noSend, { format: (v) => `${v} mIU/L` })
    expect(parts.bands.peek()).toEqual([
      {
        id: 'low',
        tone: 'critical',
        label: 'low',
        from: 0,
        to: 0.4,
        start: 0,
        size: 5,
        current: false,
      },
      {
        id: 'ref',
        tone: 'optimal',
        label: 'optimal',
        from: 0.4,
        to: 4,
        start: 5,
        size: 45,
        current: true,
      },
      {
        id: 'high',
        tone: 'critical',
        label: 'high',
        from: 4,
        to: 8,
        start: 50,
        size: 50,
        current: false,
      },
    ])
    expect(parts.valueText.peek()).toBe('2.1 mIU/L')
    expect(parts.bandLabel.peek()).toBe('optimal')
    expect(parts.root['aria-valuetext'].peek()).toBe('2.1 mIU/L, optimal')
  })

  it('names the band in aria-valuetext and positions the marker on it', () => {
    mount()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('role')).toBe('meter')
    expect(root.getAttribute('aria-valuenow')).toBe('2.1')
    expect(root.getAttribute('aria-valuetext')).toBe('2.1 mIU/L, optimal')
    expect(root.getAttribute('data-state')).toBe('optimal')
    expect(root.getAttribute('data-band')).toBe('ref')
    const marker = document.querySelector('[data-part="marker"]')!
    expect(marker.getAttribute('style')).toBe('inset-inline-start:26.25%;')
    expect(marker.getAttribute('data-band')).toBe('ref')
    // The visible label stays the number; the band name is announced, not printed.
    expect(document.querySelector('[data-part="label"]')!.textContent).toBe('2.1 mIU/L')
  })
})
