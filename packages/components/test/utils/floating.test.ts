import { describe, it, expect } from 'vitest'
import { flipPlacement } from '../../src/utils/floating'
import type { Placement } from '../../src/utils/floating'

describe('flipPlacement', () => {
  it('leaves every placement unchanged in ltr', () => {
    const all: Placement[] = [
      'top',
      'top-start',
      'top-end',
      'bottom',
      'bottom-start',
      'bottom-end',
      'left',
      'left-start',
      'left-end',
      'right',
      'right-start',
      'right-end',
    ]
    for (const p of all) expect(flipPlacement(p, 'ltr')).toBe(p)
  })

  it('swaps -start and -end under rtl', () => {
    expect(flipPlacement('bottom-start', 'rtl')).toBe('bottom-end')
    expect(flipPlacement('bottom-end', 'rtl')).toBe('bottom-start')
    expect(flipPlacement('top-start', 'rtl')).toBe('top-end')
    expect(flipPlacement('top-end', 'rtl')).toBe('top-start')
    expect(flipPlacement('left-start', 'rtl')).toBe('left-end')
    expect(flipPlacement('right-end', 'rtl')).toBe('right-start')
  })

  it('leaves physical (suffix-less) placements unchanged under rtl', () => {
    expect(flipPlacement('top', 'rtl')).toBe('top')
    expect(flipPlacement('bottom', 'rtl')).toBe('bottom')
    expect(flipPlacement('left', 'rtl')).toBe('left')
    expect(flipPlacement('right', 'rtl')).toBe('right')
  })

  it('is an involution under rtl (flipping twice restores the original)', () => {
    const logical: Placement[] = ['bottom-start', 'bottom-end', 'top-start', 'top-end']
    for (const p of logical) {
      expect(flipPlacement(flipPlacement(p, 'rtl'), 'rtl')).toBe(p)
    }
  })
})
