import { describe, it, expect } from 'vitest'
import { cx } from '../../../src/styles/utils/cx'
import { createVariants } from '../../../src/styles/utils/variants'

describe('cx', () => {
  it('joins strings with spaces', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('filters false', () => {
    expect(cx('a', false, 'b')).toBe('a b')
  })

  it('filters null and undefined', () => {
    expect(cx('a', null, undefined, 'b')).toBe('a b')
  })

  it('returns empty string for no truthy values', () => {
    expect(cx(false, null, undefined)).toBe('')
  })

  it('returns single class without trailing space', () => {
    expect(cx('a')).toBe('a')
  })
})

describe('createVariants', () => {
  const button = createVariants({
    base: 'btn',
    variants: {
      size: { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' },
      variant: { solid: 'btn-solid', outline: 'btn-outline' },
    },
    defaultVariants: { size: 'md', variant: 'solid' },
  })

  it('applies base class always', () => {
    expect(button()).toContain('btn')
  })

  it('uses default variants when no props given', () => {
    expect(button()).toBe('btn btn-md btn-solid')
  })

  it('overrides defaults with provided props', () => {
    expect(button({ size: 'lg' })).toBe('btn btn-lg btn-solid')
  })

  it('allows overriding all variants', () => {
    expect(button({ size: 'sm', variant: 'outline' })).toBe('btn btn-sm btn-outline')
  })

  it('ignores unknown variant values gracefully', () => {
    // @ts-expect-error testing runtime behavior with invalid value
    expect(button({ size: 'xl' })).toBe('btn btn-solid')
  })

  it('works without defaultVariants', () => {
    const simple = createVariants({
      base: 'box',
      variants: { color: { red: 'box-red', blue: 'box-blue' } },
    })
    expect(simple()).toBe('box')
    expect(simple({ color: 'red' })).toBe('box box-red')
  })

  describe('compoundVariants', () => {
    const compound = createVariants({
      base: 'btn',
      variants: {
        size: { sm: 'btn-sm', lg: 'btn-lg' },
        variant: { solid: 'btn-solid', outline: 'btn-outline' },
      },
      defaultVariants: { size: 'sm', variant: 'solid' },
      compoundVariants: [{ size: 'lg', variant: 'solid', class: 'btn-lg-solid' }],
    })

    it('applies compound when conditions match', () => {
      expect(compound({ size: 'lg', variant: 'solid' })).toBe('btn btn-lg btn-solid btn-lg-solid')
    })

    it('skips compound when conditions do not match', () => {
      expect(compound({ size: 'sm', variant: 'solid' })).toBe('btn btn-sm btn-solid')
    })
  })
})
