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
 * SCOPE, stated precisely: the guarantee covers the paths that route a number
 * THROUGH the grid — `value`, `thumbs`, and the increment/decrement/step
 * family. It does NOT cover the BOUNDS themselves. A bound is the grid rather
 * than a position on it, so nothing clamps it: `angleSlider.update(s,
 * { type: 'setMin', min: NaN })` stores `min: NaN` (and `JSON.stringify` then
 * yields `"min": null`), exactly as an unbounded `number-input` stores
 * `min: -Infinity` / `max: Infinity` in state by design. Both are the same
 * State-is-JSON-serializable break one field over from this fix, and both are
 * out of #152's scope — see the "bounds are not covered" block at the end,
 * which pins the current behaviour so a later fix has to notice it.
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
    // With no min/max the bounds are ±Infinity, so the clamp had no finite
    // answer to fall back on: `toMin` stored -Infinity and displayed
    // "-Infinity", which JSON turns into null.
    //
    // NOT round-trip-asserted here: an unbounded instance keeps `min`/`max`
    // themselves as ±Infinity IN STATE, which is a separate (pre-existing)
    // break of the same invariant and outside #152's clamp fix.
    for (const bad of NON_FINITE) {
      expect(Number.isFinite(numberInput.init({ value: bad }).value!)).toBe(true)
      const [s] = numberInput.update(numberInput.init({ value: 5 }), {
        type: 'setValue',
        value: bad,
      })
      expect(Number.isFinite(s.value!)).toBe(true)
      expect(s.rawText).toBe(String(s.value))
    }
    const unbounded = numberInput.init({ value: 5 })
    for (const msg of [{ type: 'toMin' }, { type: 'toMax' }] as const) {
      const [s] = numberInput.update(unbounded, msg)
      expect(Number.isFinite(s.value!), msg.type).toBe(true)
      expect(s.rawText).toBe(String(s.value))
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

describe('bounds are NOT covered by #152 — pinned, not endorsed', () => {
  // A bound defines the grid rather than naming a position on it, so nothing
  // clamps it. These are the same State-is-JSON-serializable break one field
  // over from the fix above, deliberately left in place so the scope of #152 is
  // exactly one boundary check in `clamp`. The header states the limit; these
  // pin it, so whoever closes it has to delete a test rather than discover the
  // gap by accident.

  it('angle-slider.setMin/setMax store a non-finite BOUND verbatim', () => {
    const [s] = angleSlider.update(angleSlider.init({ value: 45 }), {
      type: 'setMin',
      min: NaN,
    })
    expect(Number.isNaN(s.min)).toBe(true)
    // …and the state therefore does NOT survive a JSON round-trip.
    expect(JSON.parse(JSON.stringify(s)).min).toBeNull()
    // The VALUE is still legal, which is the half #152 does guarantee.
    expect(Number.isFinite(s.value)).toBe(true)
  })

  it('an unbounded number-input stores ±Infinity bounds in state', () => {
    const s = numberInput.init({ value: 5 })
    expect(s.min).toBe(-Infinity)
    expect(s.max).toBe(Infinity)
    const round = JSON.parse(JSON.stringify(s))
    expect(round.min).toBeNull()
    expect(round.max).toBeNull()
    // Independent of `value`, which is finite here — filed as its own issue.
    expect(Number.isFinite(s.value!)).toBe(true)
  })
})
