import { describe, it, expect } from 'vitest'
import * as slider from '../../src/components/slider'
import * as numberInput from '../../src/components/number-input'
import * as angleSlider from '../../src/components/angle-slider'
import * as ratingGroup from '../../src/components/rating-group'
import * as splitter from '../../src/components/splitter'

/**
 * A non-finite input must never reach a VALUE field (#152).
 *
 * `clamp` compared with `<`/`>` only, and every comparison against `NaN` is
 * false, so `NaN` fell through to `return n` and was stored verbatim by every
 * mutation path in the package — `clampToStep`/`stepBy` build on the same
 * clamp. `Infinity` was affected only where the bound it points at is itself
 * infinite (an unbounded `number-input`).
 *
 * It is not merely a wrong number. `JSON.stringify(NaN)` and
 * `JSON.stringify(Infinity)` are both `null`, so a non-finite value breaks the
 * State-is-JSON-serializable invariant and with it devtools time-travel,
 * `@llui/test` replay, agent state snapshots and SSR rehydration.
 *
 * SCOPE, stated precisely: this file covers the paths that route a number
 * THROUGH the grid — `value`, `thumbs`, and the increment/decrement/step
 * family — where `clamp` is the one boundary check (#152). The BOUNDS take the
 * same policy through a DIFFERENT function, `finiteBound` (#177): a bound is
 * the grid rather than a position on it, so nothing clamps it and it is
 * normalised where it is WRITTEN (`init`, `setMin`/`setMax`) instead. The last
 * block here covers the seam between the two; the package-wide bound sweep is
 * `bound-serialization.test.ts`.
 */

const NON_FINITE = [NaN, Infinity, -Infinity]

/** State survives a JSON round-trip unchanged — the invariant NaN breaks. */
function expectJsonRoundTrip(state: unknown, label: string): void {
  expect(JSON.parse(JSON.stringify(state)), label).toEqual(state)
}

function expectOnGrid(value: number, grid: { min: number; max: number; step: number }): void {
  expect(Number.isFinite(value)).toBe(true)
  expect(value).toBeGreaterThanOrEqual(grid.min)
  expect(value).toBeLessThanOrEqual(grid.max)
  const offset = (value - grid.min) / grid.step
  expect(Math.abs(offset - Math.round(offset))).toBeLessThan(1e-9)
}

describe('slider stores a legal value for a non-finite input (#152)', () => {
  const grid = { min: 0, max: 50, step: 1 }

  it('setValue', () => {
    const s0 = slider.init({ ...grid, value: [10, 20] })
    for (const bad of NON_FINITE) {
      const [s] = slider.update(s0, { type: 'setValue', value: [bad, 10] })
      for (const v of s.value) expectOnGrid(v, grid)
      expectJsonRoundTrip(s, `setValue(${bad})`)
    }
  })

  it('setThumb', () => {
    const s0 = slider.init({ ...grid, value: [10, 20] })
    for (const bad of NON_FINITE) {
      for (const index of [0, 1]) {
        const [s] = slider.update(s0, { type: 'setThumb', index, value: bad })
        for (const v of s.value) expectOnGrid(v, grid)
        expectJsonRoundTrip(s, `setThumb(${index}, ${bad})`)
      }
    }
  })

  it('init', () => {
    for (const bad of NON_FINITE) {
      const s = slider.init({ ...grid, value: [bad, 20] })
      for (const v of s.value) expectOnGrid(v, grid)
      expectJsonRoundTrip(s, `init(${bad})`)
    }
  })

  it('keeps the finite behaviour ±Infinity already had', () => {
    // Infinity was never the hole — it clamped to the bound it pointed at, and
    // still does wherever that bound is finite.
    // (Both answers are unchanged by the fix — the thumb is bounded by its
    // neighbour, not by `max`. #152's report quotes [19,20]/[9,10] here, which
    // is a `minStepsBetweenThumbs: 1` reading; the default gap is 0.)
    const s0 = slider.init({ min: 0, max: 50, step: 1, value: [10, 20] })
    expect(slider.update(s0, { type: 'setThumb', index: 0, value: Infinity })[0].value).toEqual([
      20, 20,
    ])
    expect(slider.update(s0, { type: 'setValue', value: [Infinity, 10] })[0].value).toEqual([
      10, 10,
    ])
    const gapped = slider.init({
      min: 0,
      max: 50,
      step: 1,
      value: [10, 20],
      minStepsBetweenThumbs: 1,
    })
    expect(slider.update(gapped, { type: 'setThumb', index: 0, value: Infinity })[0].value).toEqual(
      [19, 20],
    )
  })
})

describe('number-input stores a legal value for a non-finite input (#152)', () => {
  it('setValue on a bounded grid', () => {
    const s0 = numberInput.init({ min: 0, max: 50, step: 1, value: 10 })
    for (const bad of NON_FINITE) {
      const [s] = numberInput.update(s0, { type: 'setValue', value: bad })
      expectOnGrid(s.value!, { min: 0, max: 50, step: 1 })
      expect(s.rawText).toBe(String(s.value))
      expectJsonRoundTrip(s, `setValue(${bad})`)
    }
  })

  it('setValue, init and toMin/toMax on an UNBOUNDED grid', () => {
    // With no min/max the grid is unbounded on both sides, so the clamp has no
    // finite bound to fall back on: `toMin` used to store -Infinity and display
    // "-Infinity", which JSON turns into null.
    //
    // The round trip IS asserted now — the bounds themselves used to be
    // ±Infinity in state, which is the separate break #177 closed by dropping
    // the key instead.
    for (const bad of NON_FINITE) {
      expect(Number.isFinite(numberInput.init({ value: bad }).value!)).toBe(true)
      const [s] = numberInput.update(numberInput.init({ value: 5 }), {
        type: 'setValue',
        value: bad,
      })
      expect(Number.isFinite(s.value!)).toBe(true)
      expect(s.rawText).toBe(String(s.value))
      expectJsonRoundTrip(s, `unbounded setValue(${bad})`)
    }
    const unbounded = numberInput.init({ value: 5 })
    for (const msg of [{ type: 'toMin' }, { type: 'toMax' }] as const) {
      const [s] = numberInput.update(unbounded, msg)
      expect(Number.isFinite(s.value!), msg.type).toBe(true)
      expect(s.rawText).toBe(String(s.value))
      expectJsonRoundTrip(s, msg.type)
    }
  })

  it('increment/decrement from a non-finite seed', () => {
    for (const bad of NON_FINITE) {
      const seeded = { ...numberInput.init({ min: 0, max: 50, step: 1, value: 10 }), value: bad }
      for (const msg of [{ type: 'increment' }, { type: 'decrement' }] as const) {
        const [s] = numberInput.update(seeded, msg)
        expectOnGrid(s.value!, { min: 0, max: 50, step: 1 })
      }
    }
  })
})

describe('angle-slider stores a legal value for a non-finite input (#152)', () => {
  const grid = { min: 0, max: 360, step: 1 }

  it('init and setValue', () => {
    for (const bad of NON_FINITE) {
      expectOnGrid(angleSlider.init({ value: bad }).value, grid)
      const [s] = angleSlider.update(angleSlider.init({ value: 45 }), {
        type: 'setValue',
        value: bad,
      })
      expectOnGrid(s.value, grid)
      expectJsonRoundTrip(s, `setValue(${bad})`)
    }
  })

  it('setMin/setMax keep the current value legal', () => {
    for (const bad of NON_FINITE) {
      const seeded = { ...angleSlider.init({ value: 45 }), value: bad }
      expect(Number.isFinite(angleSlider.update(seeded, { type: 'setMin', min: 0 })[0].value)).toBe(
        true,
      )
      expect(
        Number.isFinite(angleSlider.update(seeded, { type: 'setMax', max: 360 })[0].value),
      ).toBe(true)
    }
  })

  it('Home/End still reach the bounds', () => {
    // The connect layer sends ±Infinity for Home/End deliberately; the clamp
    // must keep answering with the bound, not the fallback.
    const s0 = angleSlider.init({ value: 45 })
    expect(angleSlider.update(s0, { type: 'setValue', value: -Infinity })[0].value).toBe(0)
    expect(angleSlider.update(s0, { type: 'setValue', value: Infinity })[0].value).toBe(360)
  })
})

describe('the other components that route through the same clamp (#152)', () => {
  it('rating-group', () => {
    const s0 = ratingGroup.init({ count: 5, value: 3 })
    for (const bad of NON_FINITE) {
      const [s] = ratingGroup.update(s0, { type: 'setValue', value: bad })
      expect(Number.isFinite(s.value), `setValue(${bad})`).toBe(true)
      expectJsonRoundTrip(s, `rating setValue(${bad})`)
    }
  })

  it('splitter', () => {
    const s0 = splitter.init({ position: 50 })
    for (const bad of NON_FINITE) {
      const [s] = splitter.update(s0, { type: 'setPosition', position: bad })
      expect(Number.isFinite(s.position), `setPosition(${bad})`).toBe(true)
      expectJsonRoundTrip(s, `splitter setPosition(${bad})`)
    }
  })
})

describe('bounds are finite or ABSENT, never non-finite (#177)', () => {
  // What the two retired pins above used to assert — `setMin: NaN` stored
  // verbatim, and `±Infinity` bounds on an unbounded `number-input` — is now
  // the defect, not the documented limit. A bound is normalised where it is
  // WRITTEN, because it never reaches `clamp`.

  it('angle-slider DROPS a non-finite setMin/setMax and keeps clamping', () => {
    const s0 = angleSlider.init({ value: 45 })
    for (const bad of NON_FINITE) {
      const [s] = angleSlider.update(s0, { type: 'setMin', min: bad })
      // The write is refused outright — the state object is the same one.
      expect(s, `setMin(${bad})`).toBe(s0)
      expect(s.min).toBe(0)
      expectJsonRoundTrip(s, `setMin(${bad})`)
      // The half that made this more than a serialization defect: a NaN min is
      // not nullish, so it reached `clamp`, every comparison against it was
      // false, and that side of the range stopped clamping.
      expect(angleSlider.update(s, { type: 'setValue', value: -9999 })[0].value).toBe(0)

      const [t] = angleSlider.update(s0, { type: 'setMax', max: bad })
      expect(t, `setMax(${bad})`).toBe(s0)
      expect(t.max).toBe(360)
      expect(angleSlider.update(t, { type: 'setValue', value: 9999 })[0].value).toBe(360)
    }
  })

  it('an unbounded number-input has NO min/max key at all', () => {
    const s = numberInput.init({ value: 5 })
    expect(s.min).toBeUndefined()
    expect(s.max).toBeUndefined()
    expect('min' in s).toBe(false)
    expect('max' in s).toBe(false)
    // Absence is the serializable spelling of "unbounded": the round trip is an
    // identity, key for key, on the DEFAULT configuration.
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
    // …and the grid still reads it as unbounded, so nothing else changes.
    expect(numberInput.update(s, { type: 'setValue', value: 1e9 })[0].value).toBe(1e9)
    expect(numberInput.update(s, { type: 'setValue', value: -1e9 })[0].value).toBe(-1e9)
  })

  it('a non-finite number-input bound is unbounded, not stored', () => {
    for (const bad of NON_FINITE) {
      const s = numberInput.init({ value: 5, min: bad, max: bad, step: bad })
      expect(s.min, `min ${bad}`).toBeUndefined()
      expect(s.max, `max ${bad}`).toBeUndefined()
      // `step` is REQUIRED, so it takes the default instead of an absence.
      expect(s.step, `step ${bad}`).toBe(1)
      expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
    }
  })

  it('Home/End on an unbounded number-input still store a real number', () => {
    // `toMin`/`toMax` expand the absent bound to the infinity the grid would
    // have expanded it to, and `clamp` maps that to a legal finite value (#152)
    // — the seam between the two policies.
    const unbounded = numberInput.init({ value: 5 })
    for (const msg of [{ type: 'toMin' }, { type: 'toMax' }] as const) {
      const [s] = numberInput.update(unbounded, msg)
      expect(Number.isFinite(s.value!), msg.type).toBe(true)
      expect(s.rawText).toBe(String(s.value))
      expectJsonRoundTrip(s, msg.type)
    }
  })

  it('a one-sided number-input keeps the bound it was given', () => {
    const s = numberInput.init({ value: 5, max: 10 })
    expect(s.min).toBeUndefined()
    expect(s.max).toBe(10)
    expect(numberInput.update(s, { type: 'setValue', value: 999 })[0].value).toBe(10)
    expect(numberInput.update(s, { type: 'setValue', value: -999 })[0].value).toBe(-999)
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })
})
