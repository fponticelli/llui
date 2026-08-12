import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountSignalComponent, type SignalComponentHandle } from '../../src/signals/component'
import { el, elNS, react, type PropValue } from '../../src/signals/dom'

// Element mount is the hottest path in list rendering: a 10k-row create runs
// `populate` 10k+ times. This file pins the two things that must hold there —
// that prop application allocates no throwaway array-of-pairs per element
// (issue #58), and that the load-bearing two-pass ordering it used to get for
// free from iterating one `Object.entries` result twice is still exact.

interface S {
  n: number
}

type Msg = { type: 'noop' }

const mounted: SignalComponentHandle<S, Msg>[] = []

afterEach(() => {
  for (const handle of mounted) handle.dispose()
  mounted.length = 0
  vi.restoreAllMocks()
})

/** Mount a single element built from `props` and hand back its node. The handle
 * is disposed after the test; the node stays readable either way. */
function mountEl(tag: string, props: Readonly<Record<string, PropValue>>, svg = false): Element {
  const container = document.createElement('div')
  mounted.push(
    mountSignalComponent<S, Msg>(container, {
      init: () => ({ n: 1 }),
      update: (s) => s,
      view: () => [svg ? elNS(tag, props) : el(tag, props)],
    }),
  )
  return container.firstElementChild as Element
}

describe('element prop application does not materialize the props object', () => {
  // The regression guard for #58. Asserted against the props object's IDENTITY
  // rather than "was Object.entries called at all", because other parts of the
  // mount path (head, devtools metadata) legitimately use it on their own data.
  //
  // These two are deliberately white-box — the acceptance criterion is literally
  // "no Object.entries on the element mount path" — and so they only catch THIS
  // allocation coming back. A per-element allocation of another shape (say
  // `Object.keys(props).map(...)`) would slip past them; the defence against that
  // is the benchmark, not this file.
  it('never calls Object.entries on the props object', () => {
    const props: Record<string, PropValue> = {
      class: 'row',
      id: 'r1',
      'data-x': '1',
      value: 'v',
    }
    const spy = vi.spyOn(Object, 'entries')
    mountEl('input', props)
    expect(spy.mock.calls.filter(([arg]) => arg === props)).toEqual([])
  })

  it('never calls Object.entries on the props object of an SVG element', () => {
    const props: Record<string, PropValue> = { d: 'M0 0 L1 1', fill: 'none' }
    const spy = vi.spyOn(Object, 'entries')
    mountEl('path', props, true)
    expect(spy.mock.calls.filter(([arg]) => arg === props)).toEqual([])
  })
})

// The ordering contract `populate` documents: form-control SELECTION props
// (value/checked/selected/indeterminate) are applied only after every other
// prop, whatever order the author wrote them in. `<input type=range>` makes it
// observable — `.value` is clamped to the min/max in force AT ASSIGNMENT TIME
// and never revisited, so a value applied before `min`/`max` (or before `type`)
// keeps the unclamped number forever. Browsers do this per the HTML spec, and
// so does the jsdom this suite runs on (jsdom 29 — verified by mutating the
// order under test; the older claim in `select-value-ordering.test.ts` that
// jsdom does not clamp was stale and is corrected there).
describe('selection props are applied after all other props (static props)', () => {
  const CASES: ReadonlyArray<readonly [string, Record<string, PropValue>]> = [
    ['value declared first', { value: 50, type: 'range', min: 0, max: 10 }],
    ['value declared last', { type: 'range', min: 0, max: 10, value: 50 }],
    ['value declared in the middle', { min: 0, value: 50, type: 'range', max: 10 }],
  ]

  for (const [label, props] of CASES) {
    it(`clamps to max when ${label}`, () => {
      const input = mountEl('input', props) as HTMLInputElement
      // 50 clamped to max=10 — only reachable if `type`/`min`/`max` landed first.
      expect(input.value).toBe('10')
    })
  }

  it('checkbox: `checked` is applied after `type`', () => {
    const input = mountEl('input', { checked: true, type: 'checkbox' }) as HTMLInputElement
    expect(input.type).toBe('checkbox')
    expect(input.checked).toBe(true)
  })
})

describe('every prop kind still reaches the DOM', () => {
  it('applies static attrs, style.*, listeners, reactive props and selection props', () => {
    let clicks = 0
    const input = mountEl('input', {
      type: 'text',
      class: 'field',
      'style.fontWeight': 'bold',
      onClick: () => {
        clicks++
      },
      'data-n': react((s) => String((s as S).n), ['n']),
      value: 'hello',
    }) as HTMLInputElement
    expect(input.getAttribute('class')).toBe('field')
    expect(input.style.getPropertyValue('font-weight')).toBe('bold')
    expect(input.getAttribute('data-n')).toBe('1')
    expect(input.value).toBe('hello')
    input.dispatchEvent(new Event('click'))
    expect(clicks).toBe(1)
  })

  // Pins own-enumerable-key semantics. `Object.entries` (and `Object.keys`) skip
  // inherited keys; a bare `for…in` — the tempting next micro-optimization here —
  // would walk the prototype chain and start applying them. It measured no faster
  // than `Object.keys` once the `hasOwn` guard needed to restore these semantics
  // was added, so this stays the contract.
  it('ignores inherited enumerable keys on the props object', () => {
    const proto: Record<string, PropValue> = { title: 'inherited' }
    const props: Record<string, PropValue> = Object.create(proto)
    props.id = 'own'
    const node = mountEl('div', props)
    expect(node.getAttribute('id')).toBe('own')
    expect(node.hasAttribute('title')).toBe(false)
  })
})
