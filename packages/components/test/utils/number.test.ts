import { describe, it, expect } from 'vitest'
import {
  clamp,
  clampToStep,
  decimalPlaces,
  snapToStep,
  stepBy,
  type NumericGrid,
} from '../../src/utils/number'

describe('clamp', () => {
  it('bounds a value to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('leaves an unbounded range alone', () => {
    expect(clamp(1e9, -Infinity, Infinity)).toBe(1e9)
  })

  // #152: every comparison against NaN is false, so NaN fell through to
  // `return n` and landed in state — package-wide, since this is the one clamp
  // every mutation path routes through.
  it('maps NaN to a finite value inside the range', () => {
    expect(clamp(NaN, 0, 50)).toBe(0)
    expect(clamp(NaN, -20, -5)).toBe(-5)
    expect(clamp(NaN, 5, Infinity)).toBe(5)
    expect(clamp(NaN, -Infinity, -3)).toBe(-3)
    expect(clamp(NaN, -Infinity, Infinity)).toBe(0)
  })

  it('keeps the bound ±Infinity already clamped to', () => {
    expect(clamp(Infinity, 0, 50)).toBe(50)
    expect(clamp(-Infinity, 0, 50)).toBe(0)
  })

  it('sends NaN to zero-clamped-into-the-range, NOT to the grid origin', () => {
    // The two rules coincide for every range at or above zero and part company
    // for one that straddles or sits below it. #152's Option A is worded "min
    // when finite, else the grid origin, else 0", which would read -50 / -100
    // here; `finiteInRange` deliberately answers the neutral point of the range
    // instead, and its doc comment records the divergence. Pinned so the prose
    // and the code cannot drift apart again.
    expect(clamp(NaN, -50, 50)).toBe(0)
    expect(clamp(NaN, -100, -10)).toBe(-10)
    expect(clamp(NaN, 10, 50)).toBe(10)
    expect(clamp(NaN, -Infinity, -10)).toBe(-10)
    // Degenerate range: the surviving bound is infinite too, so 0 answers.
    expect(clamp(NaN, Infinity, -Infinity)).toBe(0)
  })

  it('maps ±Infinity to a finite value when the bound it points at is infinite', () => {
    expect(clamp(Infinity, 0, Infinity)).toBe(0)
    expect(clamp(-Infinity, -Infinity, 50)).toBe(0)
    expect(clamp(Infinity, -Infinity, Infinity)).toBe(0)
    expect(clamp(-Infinity, -Infinity, -5)).toBe(-5)
  })
})

describe('decimalPlaces', () => {
  it('counts decimals in plain notation', () => {
    expect(decimalPlaces(1)).toBe(0)
    expect(decimalPlaces(100)).toBe(0)
    expect(decimalPlaces(0.1)).toBe(1)
    expect(decimalPlaces(0.125)).toBe(3)
    expect(decimalPlaces(-0.25)).toBe(2)
  })

  it('counts decimals in exponential notation (#125 defect 1)', () => {
    // String(1e-7) is '1e-7' — an indexOf('.') scan reports ZERO decimals and
    // every snap through toFixed(0) then collapses to 0.
    expect(decimalPlaces(1e-7)).toBe(7)
    expect(decimalPlaces(1.5e-7)).toBe(8)
    expect(decimalPlaces(1e21)).toBe(0)
  })

  it('is 0 for non-finite input', () => {
    expect(decimalPlaces(Infinity)).toBe(0)
    expect(decimalPlaces(NaN)).toBe(0)
  })
})

describe('snapToStep', () => {
  it('snaps to the nearest multiple of step from the origin', () => {
    expect(snapToStep(3, 2, 0)).toBe(4)
    expect(snapToStep(23, 5, 0)).toBe(25)
    expect(snapToStep(14, 10, 0)).toBe(10)
  })

  it('snaps relative to a non-zero origin', () => {
    expect(snapToStep(6, 5, 1)).toBe(6)
    expect(snapToStep(7, 5, 1)).toBe(6)
  })

  it('avoids floating-point drift', () => {
    expect(snapToStep(0.30000000000000004, 0.1, 0)).toBe(0.3)
  })

  it('snaps exponential steps (#125 defect 1)', () => {
    expect(snapToStep(3e-7, 1e-7, 0)).toBe(3e-7)
  })

  it('passes the value through for a non-positive step', () => {
    expect(snapToStep(3.7, 0, 0)).toBe(3.7)
    expect(snapToStep(3.7, -1, 0)).toBe(3.7)
  })

  it('snaps a non-finite value to the grid anchor (#152)', () => {
    expect(snapToStep(NaN, 2, 0)).toBe(0)
    expect(snapToStep(NaN, 5, 1)).toBe(1)
    expect(snapToStep(Infinity, 2, 0)).toBe(0)
    expect(snapToStep(-Infinity, 2, 0)).toBe(0)
    // …including on a continuous grid, where there is no step to snap to.
    expect(snapToStep(NaN, 0, 3)).toBe(3)
  })
})

describe('clampToStep', () => {
  it('clamps and snaps together', () => {
    expect(clampToStep(15, { min: 0, max: 10, step: 2 })).toBe(10)
    expect(clampToStep(3, { min: 0, max: 10, step: 2 })).toBe(4)
    expect(clampToStep(-4, { min: 0, max: 10, step: 2 })).toBe(0)
  })

  it('never returns a grid value outside the range', () => {
    // 10 snaps UP to 12 on a 0/4 grid — the result must fall back to the last
    // grid value inside the range rather than land off-grid or out of range.
    expect(clampToStep(10, { min: 0, max: 10, step: 4 })).toBe(8)
    expect(clampToStep(1, { min: 1, max: 10, step: 4 })).toBe(1)
  })

  it('anchors the grid on min when min is finite', () => {
    expect(clampToStep(4, { min: 1, max: 10, step: 2 })).toBe(5)
  })

  it('anchors the grid on 0 when min is unbounded', () => {
    expect(clampToStep(5, { step: 2 })).toBe(6)
  })

  it('snaps an exponential step (#125 defect 1)', () => {
    expect(clampToStep(3e-7, { min: 0, max: 1, step: 1e-7 })).toBe(3e-7)
  })

  it('returns a finite, in-range, on-grid value for a non-finite input (#152)', () => {
    const grids: NumericGrid[] = [
      { min: 0, max: 50, step: 1 },
      { min: 1, max: 10, step: 4 },
      { min: -20, max: -5, step: 3 },
      { step: 2 },
      { min: 0, max: 10 },
      {},
    ]
    for (const grid of grids) {
      for (const value of [NaN, Infinity, -Infinity]) {
        const out = clampToStep(value, grid)
        const min = grid.min ?? -Infinity
        const max = grid.max ?? Infinity
        expect(Number.isFinite(out), `${value} on ${JSON.stringify(grid)}`).toBe(true)
        expect(out >= min && out <= max, `${value} on ${JSON.stringify(grid)}`).toBe(true)
        if (grid.step) {
          const base = Number.isFinite(min) ? min : 0
          expect(
            Math.abs((out - base) / grid.step - Math.round((out - base) / grid.step)),
          ).toBeLessThan(1e-9)
        }
      }
    }
  })
})

describe('stepBy', () => {
  it('adds whole steps from an on-grid value', () => {
    expect(stepBy(4, 1, { step: 2 })).toBe(6)
    expect(stepBy(4, -1, { step: 2 })).toBe(2)
    expect(stepBy(0, 10, { step: 1 })).toBe(10)
  })

  it('lands on the grid from an off-grid start (#125 defect 2)', () => {
    // HTML's stepUp/stepDown: from off-grid, one press moves to the nearest
    // grid value in the direction of travel — that jump is the whole change.
    expect(stepBy(3, 1, { step: 2 })).toBe(4)
    expect(stepBy(3, -1, { step: 2 })).toBe(2)
    expect(stepBy(3, 10, { step: 2 })).toBe(4)
  })

  it('clamps to the range', () => {
    expect(stepBy(2, -10, { min: 0, max: 10, step: 1 })).toBe(0)
    expect(stepBy(9, 10, { min: 0, max: 10, step: 1 })).toBe(10)
  })

  it('avoids floating-point drift', () => {
    expect(stepBy(0.2, 1, { step: 0.1 })).toBe(0.3)
  })

  it('steps an exponential grid (#125 defect 1)', () => {
    expect(stepBy(2e-7, 1, { min: 0, max: 1, step: 1e-7 })).toBe(3e-7)
  })

  it('steps from a non-finite value onto the grid (#152)', () => {
    expect(stepBy(NaN, 1, { min: 0, max: 10, step: 2 })).toBe(0)
    expect(stepBy(Infinity, 1, { min: 0, max: 10, step: 2 })).toBe(10)
    expect(stepBy(-Infinity, 1, { min: 0, max: 10, step: 2 })).toBe(0)
    for (const value of [NaN, Infinity, -Infinity]) {
      // Unbounded, so the grid anchor is the only defined answer.
      expect(Number.isFinite(stepBy(value, 1, { step: 2 }))).toBe(true)
      expect(Number.isFinite(stepBy(value, 0, { step: 2 }))).toBe(true)
      expect(Number.isFinite(stepBy(value, 1, {}))).toBe(true)
    }
  })
})
