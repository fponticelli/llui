import { describe, expect, it } from 'vitest'
import {
  createVariantsAxisNames,
  createVariantsAxisValueNames,
  cssHasScopeSelector,
  cssScopeHasDensityOrSizeSelector,
  hasDensityOrSizeProperty,
  optionsInterfacePropertyNames,
} from './density-source-audit'

/**
 * #264 review item 5: `hasDensityOrSizeProperty` and
 * `cssScopeHasDensityOrSizeSelector` were exercised ONLY in the direction
 * that asserts `false` (`navigation-data-contract.test.ts`'s density-N/A
 * rationale check) — mutating either to unconditionally `return false`
 * left every consuming test green (`review-264d/mut/rows3.mjs`'s D1/D2).
 * This file is the missing KNOWN-POSITIVE half: real snippets that DO
 * declare a density/size field or DO carry a density/size-scoped CSS
 * selector, asserted to come back `true`. A mutant that always answers
 * `false` now fails here immediately, independent of what any consumer
 * asserts.
 */
describe('hasDensityOrSizeProperty — known-positive self-checks', () => {
  it('is true for a ConnectOptions interface with a density field', () => {
    const source = `
      export interface ConnectOptions {
        id: string
        density?: 'compact' | 'comfortable'
      }
    `
    expect(hasDensityOrSizeProperty(source)).toBe(true)
  })

  it('is true for an *Init interface with a size field', () => {
    const source = `
      export interface WidgetInit {
        size?: 'sm' | 'default' | 'lg'
      }
    `
    expect(hasDensityOrSizeProperty(source)).toBe(true)
  })

  it('is true for a createVariants size axis (the registry recipe spelling)', () => {
    const source = `
      export const avatarVariants = createVariants({
        base: 'inline-flex',
        variants: {
          size: {
            sm: 'size-6',
            default: 'size-8',
          },
        },
      })
    `
    expect(hasDensityOrSizeProperty(source)).toBe(true)
  })

  it('optionsInterfacePropertyNames finds the exact declared names', () => {
    const source = `
      export interface ConnectOptions {
        density?: string
        id: string
      }
    `
    expect(optionsInterfacePropertyNames(source)).toEqual(expect.arrayContaining(['density', 'id']))
  })

  it('createVariantsAxisNames finds the axis key, not the option values', () => {
    const source = `
      createVariants({ variants: { density: { compact: 'a', comfortable: 'b' } } })
    `
    expect(createVariantsAxisNames(source)).toEqual(['density'])
  })

  it('createVariantsAxisNames follows a variants SHORTHAND to its module-level const (#264 item F3)', () => {
    // `button.ts`/`badge.ts`'s real shape: the variants map is a separate
    // const, spread into `createVariants` by shorthand rather than written
    // inline — the exact hole M2's mutation (a `size` axis added this way)
    // exploited, since the old code only read an INLINE `variants: {...}`.
    const source = `
      const variants = { size: { sm: 'h-5', lg: 'h-7' } }
      export const badgeVariants = createVariants({ base: 'inline-flex', variants })
    `
    expect(createVariantsAxisNames(source)).toEqual(['size'])
    expect(hasDensityOrSizeProperty(source)).toBe(true)
  })

  it('createVariantsAxisValueNames follows the same shorthand to the axis rungs', () => {
    const source = `
      const variants = { size: { sm: 'h-5', lg: 'h-7' } }
      export const badgeVariants = createVariants({ base: 'inline-flex', variants })
    `
    expect(createVariantsAxisValueNames(source, 'size')).toEqual(['sm', 'lg'])
  })

  it('is still false for an unrelated field merely mentioning "density" in prose', () => {
    const source = `
      // This component has no density option — see densityRationale below.
      export interface ConnectOptions {
        id: string
      }
    `
    expect(hasDensityOrSizeProperty(source)).toBe(false)
  })
})

describe('cssScopeHasDensityOrSizeSelector — known-positive self-checks', () => {
  it('is true for a real scoped density rule', () => {
    const css = `[data-scope='avatar'][data-part='root'][data-density='compact'] { gap: 0; }`
    expect(cssScopeHasDensityOrSizeSelector(css, 'avatar')).toBe(true)
  })

  it('is true for a real scoped size rule among several unrelated rules', () => {
    const css = `
      .unrelated { color: red; }
      [data-scope='table'][data-size='sm'] { font-size: 0.75rem; }
    `
    expect(cssScopeHasDensityOrSizeSelector(css, 'table')).toBe(true)
  })

  it('is false when the density selector belongs to a DIFFERENT scope', () => {
    const css = `[data-scope='avatar'][data-density='compact'] { gap: 0; }`
    expect(cssScopeHasDensityOrSizeSelector(css, 'table')).toBe(false)
  })

  it('is ROBUST to a brace inside a /* comment */ naming this scope + density', () => {
    // The comment text below contains BOTH the scope attribute selector and
    // a density attribute selector, plus a brace — exactly the shape a
    // naive `.split('{')` scan reads as a live rule. It must not.
    const css = `
      /* removed: [data-scope='avatar'][data-density='compact'] { gap: 0 } */
      .avatar-unrelated { color: red; }
    `
    expect(cssScopeHasDensityOrSizeSelector(css, 'avatar')).toBe(false)
  })

  it('is ROBUST to a brace inside a quoted declaration-value string', () => {
    const css = `
      [data-scope='avatar'][data-part='label'] { content: "{ [data-density='compact'] }"; }
    `
    // The declaration value is a decoy: it contains the scope+density text
    // and a brace, but it is not a live selector — the RULE's own selector
    // (before the first real '{') carries no density/size attribute.
    expect(cssScopeHasDensityOrSizeSelector(css, 'avatar')).toBe(false)
  })

  it('still matches the real attribute-selector string alongside a decoy comment', () => {
    const css = `
      /* a brace { in a comment } near a real rule */
      [data-scope='avatar'][data-density='compact'] { gap: 0; }
    `
    expect(cssScopeHasDensityOrSizeSelector(css, 'avatar')).toBe(true)
  })
})

describe('cssHasScopeSelector — the "was this scope ever audited at all" half (#264 item F3)', () => {
  it('is true for a scope with ANY baseline rule, density/size or not', () => {
    const css = `[data-scope='avatar'][data-part='root'] { display: flex; }`
    expect(cssHasScopeSelector(css, 'avatar')).toBe(true)
  })

  it('is false for a scope with no baseline rule at all', () => {
    const css = `[data-scope='table'][data-part='root'] { display: block; }`
    expect(cssHasScopeSelector(css, 'avatar')).toBe(false)
  })

  it("disambiguates cssScopeHasDensityOrSizeSelector's false: unaudited vs. genuinely clean", () => {
    // A scope this baseline never styles at all: the density check is
    // vacuously false, and cssHasScopeSelector is what says so.
    const noRulesAtAll = `.unrelated { color: red; }`
    expect(cssScopeHasDensityOrSizeSelector(noRulesAtAll, 'avatar')).toBe(false)
    expect(cssHasScopeSelector(noRulesAtAll, 'avatar')).toBe(false)

    // A scope this baseline DOES style, with no density/size selector: the
    // same `false` from the density check now means something real.
    const genuinelyClean = `[data-scope='avatar'][data-part='root'] { display: flex; }`
    expect(cssScopeHasDensityOrSizeSelector(genuinelyClean, 'avatar')).toBe(false)
    expect(cssHasScopeSelector(genuinelyClean, 'avatar')).toBe(true)
  })
})
