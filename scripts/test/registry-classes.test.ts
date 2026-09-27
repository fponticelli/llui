import { describe, expect, it } from 'vitest'
import { extractClassCandidates } from '../lib/registry-classes.mjs'

/**
 * #264 review LOW 3: `extractClassCandidates`'s identifier resolution
 * (#264 item F2) used to throw on several shapes of legitimate code — a
 * `for…of` loop variable, a constructor parameter, a nested-block `var`
 * (which hoists past the block it is declared in), a bare `undefined`
 * argument, and a module const whose initializer is not a plain literal
 * (a `+`-concatenation or a function call) — and treated `let` the same as
 * `const`, which risks reporting a STALE value for a binding that can be
 * reassigned elsewhere in the file. These are unit tests for the resolver
 * directly, not only exercised incidentally via `tailwind-classes.test.ts`
 * over the real registry corpus (which may never happen to contain one of
 * these shapes).
 */
describe('extractClassCandidates — identifier resolution at a recipe position', () => {
  it('resolves a plain module-level const referenced by identifier', () => {
    const src = `
      import { cn } from '@/lib/utils'
      const B = 'p-2 foo-bar'
      export const A = () => cn(B)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['foo-bar', 'p-2'])
  })

  it('resolves a `+`-concatenation of literal consts', () => {
    const src = `
      import { cn } from '@/lib/utils'
      const B = 'p-2 ' + 'm-1'
      export const A = () => cn(B)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['m-1', 'p-2'])
  })

  it('resolves a `+`-concatenation chained through another const', () => {
    const src = `
      import { cn } from '@/lib/utils'
      const BASE = 'p-2'
      const FULL = BASE + ' m-1'
      export const A = () => cn(FULL)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['m-1', 'p-2'])
  })

  it('skips (never throws on) a bare `undefined` argument', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export const A = () => cn('p-2', undefined)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['p-2'])
  })

  it('skips (never throws on) a for…of loop variable', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export function f(xs: string[]) { for (const c of xs) cn(c) }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips (never throws on) a for…in loop variable', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export function f(xs: Record<string, string>) { for (const k in xs) cn(k) }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips (never throws on) a constructor parameter', () => {
    const src = `
      import { cn } from '@/lib/utils'
      class K { constructor(c: string) { cn(c) } }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips (never throws on) a nested-block `var` (hoists past the block)', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export function f() { if (1) { var c = 'x' } return cn(c) }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips (never throws on) a top-level module `var`', () => {
    const src = `
      import { cn } from '@/lib/utils'
      var B = 'p-2'
      export const A = () => cn(B)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips a destructured arrow-body local', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export const f = (o: {c: string}) => { const { c } = o; return cn(c) }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('a `let` is skipped, NOT resolved as if it were a stable const (#264 review LOW 3)', () => {
    // A `let` can be reassigned elsewhere in the file; trusting its first
    // initializer risks reporting a STALE value for what the recipe
    // actually resolves to at runtime.
    const src = `
      import { cn } from '@/lib/utils'
      let B = 'p-2'
      export const A = () => cn(B)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('skips (never throws on) a module const whose initializer is a function call', () => {
    const src = `
      import { cn } from '@/lib/utils'
      const B = pick()
      export const A = () => cn(B)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('still resolves the STATIC spans of an interpolated template const', () => {
    const src = `
      import { classPart } from '@/lib/utils'
      import { button } from '@llui/dom'
      const navButtonRecipe = \`\${buttonVariants({ variant: 'ghost' })} size-(--cell-size) p-0\`
      export const CalendarPrevious = classPart(button, navButtonRecipe)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['p-0', 'size-(--cell-size)'])
  })

  it('skips an imported identifier (resolved and checked in its own file)', () => {
    const src = `
      import { cn } from '@/lib/utils'
      import { inputRecipe } from '@/ui/input'
      export const A = () => cn(inputRecipe)
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it("skips classPart's/classPartWithDefaults' own TAG argument", () => {
    const src = `
      import { classPart } from '@/lib/utils'
      import { div } from '@llui/dom'
      export const Item = classPart(div, 'p-2')
    `
    expect(extractClassCandidates('x.ts', src)).toEqual(['p-2'])
  })

  it('FAILS LOUDLY on an identifier that resolves nowhere at all (a typo/dangling reference)', () => {
    const src = `
      import { cn } from '@/lib/utils'
      export const A = () => cn(genuinelyUndeclaredName)
    `
    expect(() => extractClassCandidates('x.ts', src)).toThrowError(/genuinelyUndeclaredName/)
  })
})
