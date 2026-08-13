import { describe, it, expect } from 'vitest'
import { clamp, clampToStep, decimalPlaces, snapToStep, stepBy } from '../../src/utils/number'

describe('clamp', () => {
  it('bounds a value to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('leaves an unbounded range alone', () => {
    expect(clamp(1e9, -Infinity, Infinity)).toBe(1e9)
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
})
