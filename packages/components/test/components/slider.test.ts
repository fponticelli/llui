import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  valueFromPoint,
  closestThumbIndex,
} from '../../src/components/slider'
import { clampToStep } from '../../src/utils/number'
import { rootSignal, signalOf, read } from '../_signal'

describe('slider reducer', () => {
  it('initializes with defaults', () => {
    const s = init()
    expect(s).toMatchObject({ value: [0], min: 0, max: 100, step: 1, dir: 'ltr' })
  })

  it('setDir updates direction (even while disabled)', () => {
    const [s1] = update(init(), { type: 'setDir', dir: 'rtl' })
    expect(s1.dir).toBe('rtl')
    const [s2] = update(init({ disabled: true }), { type: 'setDir', dir: 'rtl' })
    expect(s2.dir).toBe('rtl')
  })

  it('setValue replaces full value array', () => {
    const [s] = update(init(), { type: 'setValue', value: [25] })
    expect(s.value).toEqual([25])
  })

  it('setThumb clamps to min/max', () => {
    const [a] = update(init(), { type: 'setThumb', index: 0, value: 150 })
    expect(a.value[0]).toBe(100)
    const [b] = update(init(), { type: 'setThumb', index: 0, value: -20 })
    expect(b.value[0]).toBe(0)
  })

  it('setThumb snaps to step', () => {
    const [a] = update(init({ step: 5 }), { type: 'setThumb', index: 0, value: 23 })
    expect(a.value[0]).toBe(25)
    const [b] = update(init({ step: 10 }), { type: 'setThumb', index: 0, value: 14 })
    expect(b.value[0]).toBe(10)
  })

  it('increment adds step', () => {
    const [s] = update(init({ value: [10] }), { type: 'increment', index: 0 })
    expect(s.value[0]).toBe(11)
  })

  it('increment with multiplier', () => {
    const [s] = update(init({ value: [10] }), { type: 'increment', index: 0, multiplier: 10 })
    expect(s.value[0]).toBe(20)
  })

  it('decrement subtracts step and clamps to min', () => {
    const [s] = update(init({ value: [2] }), { type: 'decrement', index: 0, multiplier: 10 })
    expect(s.value[0]).toBe(0)
  })

  it('toMin/toMax jump to bounds', () => {
    const [a] = update(init({ value: [50] }), { type: 'toMin', index: 0 })
    expect(a.value[0]).toBe(0)
    const [b] = update(init({ value: [50] }), { type: 'toMax', index: 0 })
    expect(b.value[0]).toBe(100)
  })

  it('disabled blocks interactive mutations, not config writes', () => {
    const s0 = init({ disabled: true, value: [50] })
    const [s1] = update(s0, { type: 'increment', index: 0 })
    expect(s1.value[0]).toBe(50)
    const [s2] = update(s0, { type: 'setDisabled', disabled: false })
    expect(s2.disabled).toBe(false)
  })

  // `disabled` gates HUMAN interaction (drag, arrow keys). A programmatic write
  // is not an interaction, and dropping it left the machine unwritable (#120).
  it('disabled still accepts a programmatic setValue', () => {
    const [s] = update(init({ disabled: true, value: [50] }), { type: 'setValue', value: [10] })
    expect(s.value).toEqual([10])
  })

  it('range slider enforces gap between thumbs', () => {
    const s0 = init({ value: [20, 80], minStepsBetweenThumbs: 10 })
    const [s1] = update(s0, { type: 'setThumb', index: 0, value: 75 })
    // Gap of 10 means thumb 0 cannot exceed 80-10 = 70
    expect(s1.value[0]).toBe(70)
  })

  it('setValue clamps and snaps every thumb, like setThumb (#125 defect 3)', () => {
    const [a] = update(init({ value: [0], step: 5 }), { type: 'setValue', value: [23] })
    expect(a.value).toEqual([25])
    const [b] = update(init({ value: [0] }), { type: 'setValue', value: [150] })
    expect(b.value).toEqual([100])
    const [c] = update(init({ value: [0] }), { type: 'setValue', value: [-20] })
    expect(c.value).toEqual([0])
  })

  it('setValue respects the thumb gap, like setThumb (#125 defect 3)', () => {
    const s0 = init({ value: [20, 80], minStepsBetweenThumbs: 10 })
    const [s] = update(s0, { type: 'setValue', value: [75, 80] })
    expect(s.value).toEqual([70, 80])
  })

  it('increment lands on the grid from an off-grid start (#125 defect 2)', () => {
    // init snaps now, so the off-grid start is built directly — the shape a
    // rehydrated state can still hold.
    const offGrid = { ...init({ step: 2 }), value: [3] }
    const [s] = update(offGrid, { type: 'increment', index: 0 })
    expect(s.value[0]).toBe(4)
  })

  it('init clamps, snaps and applies the thumb gap to the seed value (#125)', () => {
    expect(init({ value: [3], step: 2 }).value).toEqual([4])
    expect(
      init({ value: [500, -20], min: 0, max: 50, step: 5 }).value.every((v) => v >= 0 && v <= 50),
    ).toBe(true)
    expect(init({ value: [-1000, -1000], min: 0, max: 100, step: 5 }).value).toEqual([0, 0])
    expect(
      init({ value: [0, 5], min: 0, max: 100, step: 5, minStepsBetweenThumbs: 2 }).value,
    ).toEqual([0, 10])
  })

  it('avoids floating-point drift with fractional steps', () => {
    const [s] = update(init({ step: 0.1 }), { type: 'setThumb', index: 0, value: 0.3 })
    expect(s.value[0]).toBe(0.3)
  })
})

describe('slider setValue never stores an out-of-range or off-grid value (#125 defect 3)', () => {
  // A value is legal iff clamping+snapping it is a no-op: that is exactly
  // "inside [min,max] AND on the min-anchored grid".
  const isLegal = (v: number, grid: { min: number; max: number; step: number }): boolean =>
    clampToStep(v, grid) === v

  const CANDIDATES = [-1000, -100, -20, -7, -1, 0, 1, 7, 23, 50, 99, 500, 1000]

  for (const gap of [0, 2]) {
    it(`sweeps every candidate pair with minStepsBetweenThumbs: ${gap}`, () => {
      const grid = { min: 0, max: 50, step: 5 }
      const s0 = init({ ...grid, value: [10, 20], minStepsBetweenThumbs: gap })
      const bad: string[] = []
      for (const a of CANDIDATES) {
        for (const b of CANDIDATES) {
          const [s] = update(s0, { type: 'setValue', value: [a, b] })
          for (const v of s.value) {
            if (!isLegal(v, grid)) bad.push(`setValue([${a},${b}]) -> [${s.value.join(',')}]`)
          }
        }
      }
      expect(bad).toEqual([])
    })
  }

  it('normalises a descending input', () => {
    const s0 = init({ min: 0, max: 50, step: 1, value: [10, 20] })
    const [s] = update(s0, { type: 'setValue', value: [500, -20] })
    expect(s.value.every((v) => v >= 0 && v <= 50)).toBe(true)
    expect(s.value[0]).toBeLessThanOrEqual(s.value[1]!)
  })

  it('normalises an all-negative input', () => {
    const s0 = init({ min: 0, max: 100, step: 5, value: [0, 50] })
    const [s] = update(s0, { type: 'setValue', value: [-1000, -1000] })
    expect(s.value).toEqual([0, 0])
  })

  it('keeps a bounded thumb on the grid when the gap crowds it', () => {
    const s0 = init({ min: 0, max: 100, step: 5, value: [0, 50], minStepsBetweenThumbs: 2 })
    const [s] = update(s0, { type: 'setValue', value: [-1000, 7] })
    expect(s.value).toEqual([0, 10])
  })

  // The fix has TWO halves and the sweeps above pin only one. Legality
  // (in-range + on-grid) is restored by `withThumb`'s bound normalisation
  // ALONE, so deleting the `values.map(clampToStep)` that normalises the array
  // FIRST leaves every assertion above green — while the gap silently breaks:
  // an out-of-range neighbour snaps to `max` only after it has already been
  // used as a bound, so both thumbs land on `max` with no gap between them.
  // These two assertions are the only thing standing on that half.
  it('respects the gap when an out-of-range input snaps onto an occupied value', () => {
    const s0 = init({ min: 0, max: 50, step: 1, value: [10, 20], minStepsBetweenThumbs: 1 })
    const [s] = update(s0, { type: 'setValue', value: [50, 51] })
    // Normalise-first: 51 becomes 50, so thumb 0 is bounded by 50 and lands on
    // 49. Bound-first: thumb 0 is bounded by the raw 51 and keeps 50, then
    // thumb 1 snaps down onto 50 too -> [50,50], a gap of 0 where 1 is required.
    expect(s.value).toEqual([49, 50])
  })

  for (const gap of [1, 2]) {
    it(`sweeps the gap invariant with minStepsBetweenThumbs: ${gap}`, () => {
      const grid = { min: 0, max: 50, step: 1 }
      const s0 = init({ ...grid, value: [10, 20], minStepsBetweenThumbs: gap })
      const bad: string[] = []
      for (const a of CANDIDATES) {
        for (const b of CANDIDATES) {
          const [s] = update(s0, { type: 'setValue', value: [a, b] })
          const [lo, hi] = [s.value[0]!, s.value[1]!]
          if (hi - lo < gap * grid.step) {
            bad.push(`setValue([${a},${b}]) -> [${s.value.join(',')}] (gap ${hi - lo})`)
          }
        }
      }
      expect(bad).toEqual([])
    })
  }
})

describe('valueFromPoint', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect

  it('horizontal: left edge → min, right edge → max', () => {
    const s = init({ min: 0, max: 100 })
    expect(valueFromPoint(s, rect, 0, 0)).toBe(0)
    expect(valueFromPoint(s, rect, 100, 0)).toBe(100)
    expect(valueFromPoint(s, rect, 50, 0)).toBe(50)
  })

  it('vertical: top → max, bottom → min', () => {
    const s = init({ min: 0, max: 100, orientation: 'vertical' })
    expect(valueFromPoint(s, rect, 0, 0)).toBe(100)
    expect(valueFromPoint(s, rect, 0, 100)).toBe(0)
  })

  it('snaps to step', () => {
    const s = init({ min: 0, max: 100, step: 10 })
    expect(valueFromPoint(s, rect, 47, 0)).toBe(50)
  })
})

describe('closestThumbIndex', () => {
  it('returns index of nearest value', () => {
    const s = init({ value: [10, 50, 90] })
    expect(closestThumbIndex(s, 15)).toBe(0)
    expect(closestThumbIndex(s, 45)).toBe(1)
    expect(closestThumbIndex(s, 100)).toBe(2)
  })
})

describe('slider.connect', () => {
  const parts = connect(rootSignal(), vi.fn())

  it('thumb aria values reflect state', () => {
    const t = parts.thumb(0).thumb
    const s = init({ min: 0, max: 200, value: [50] })
    expect(read(t['aria-valuemin'], s)).toBe(0)
    expect(read(t['aria-valuemax'], s)).toBe(200)
    expect(read(t['aria-valuenow'], s)).toBe(50)
  })

  it('ArrowRight sends increment', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.thumb(0).thumb.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })

  it('PageUp sends increment with multiplier 10', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send)
    p.thumb(1).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'PageUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 1, multiplier: 10 })
  })

  it('Home/End jump to min/max', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send)
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'toMin', index: 0 })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'toMax', index: 0 })
  })

  it('ltr (default): ArrowLeft sends decrement', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.thumb(0).thumb.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'decrement', index: 0 })
  })

  it('rtl: ArrowRight DECREASES (visual right is the low end)', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.thumb(0).thumb.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'decrement', index: 0 })
  })

  it('rtl: ArrowLeft INCREASES', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send)
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })

  it('rtl: vertical arrows are NOT flipped (ArrowUp increments, ArrowDown decrements)', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send)
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'increment', index: 0 })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'decrement', index: 0 })
  })

  it('rtl: Home/End are NOT flipped', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send)
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'toMin', index: 0 })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'toMax', index: 0 })
  })

  it('thumb style positions horizontally by percent', () => {
    const p = connect(rootSignal(), vi.fn())
    const style = read(p.thumb(0).thumb.style, init({ value: [50], min: 0, max: 100 }))
    expect(style).toContain('left:50%')
  })

  it('range style spans between thumbs', () => {
    const p = connect(rootSignal(), vi.fn())
    const style = read(p.range.style, init({ value: [20, 80], min: 0, max: 100 }))
    expect(style).toContain('left:20%')
    expect(style).toContain('right:20%')
  })

  it('tabindex=-1 when disabled', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.thumb(0).thumb.tabindex, init({ disabled: true }))).toBe(-1)
    expect(read(p.thumb(0).thumb.tabindex, init({ disabled: false }))).toBe(0)
  })
})
