import { describe, expect, it } from 'vitest'
import { extractClassCandidates, UNRESOLVED_RECIPE_ALLOWED } from '../lib/registry-classes.mjs'

/**
 * #264 review LOW 3 (then M2): `extractClassCandidates`'s identifier
 * resolution (#264 item F2) used to throw on several shapes of legitimate,
 * genuinely DYNAMIC code — a `for…of` loop variable, a constructor
 * parameter, a nested-block `var` (which hoists past the block it is
 * declared in), a bare `undefined` argument. LOW 3 fixed those, but ALSO
 * started silently SKIPPING a `let` and a `const` with a non-literal
 * initializer (`pick()`) — which #264 review M2 correctly called out as
 * failing OPEN: a silent skip is exactly how a hoisted recipe with a dead
 * class inside it went unchecked in the first place. Both now FAIL LOUDLY
 * again, escapable only via a per-file, reasoned `UNRESOLVED_RECIPE_ALLOWED`
 * entry. These are unit tests for the resolver directly, not only exercised
 * incidentally via `tailwind-classes.test.ts` over the real registry corpus
 * (which may never happen to contain one of these shapes).
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

  it('FAILS LOUDLY on a `let` — never resolved as if it were a stable const (#264 review M2)', () => {
    // A `let` can be reassigned elsewhere in the file; resolving its first
    // initializer risks reporting a STALE value for what the recipe
    // actually resolves to at runtime, and a SILENT skip is exactly how a
    // hoisted recipe with a dead class went unchecked in the first place —
    // so this is a loud failure, not a quiet miss.
    const src = `
      import { cn } from '@/lib/utils'
      let B = 'p-2'
      export const A = () => cn(B)
    `
    expect(() => extractClassCandidates('x.ts', src)).toThrowError(/"B"/)
  })

  it('FAILS LOUDLY on a module const whose initializer is a function call (#264 review M2)', () => {
    const src = `
      import { cn } from '@/lib/utils'
      const B = pick()
      export const A = () => cn(B)
    `
    expect(() => extractClassCandidates('x.ts', src)).toThrowError(/"B"/)
  })

  it('an allowlisted identifier is skipped instead of thrown, and reported as used', () => {
    // `UNRESOLVED_RECIPE_ALLOWED` is empty in the shipped module (closed at
    // both ends by a real corpus sweep — see tailwind-classes.test.ts), so
    // this test injects a temporary entry to exercise the mechanism itself
    // without depending on a real exception existing in the registry today.
    const key = 'x.ts: B'
    UNRESOLVED_RECIPE_ALLOWED[key] = { reason: 'test-only' }
    try {
      const src = `
        import { cn } from '@/lib/utils'
        const B = pick()
        export const A = () => cn(B)
      `
      const used = new Set<string>()
      expect(extractClassCandidates('x.ts', src, used)).toEqual([])
      expect(used).toEqual(new Set([key]))
    } finally {
      delete UNRESOLVED_RECIPE_ALLOWED[key]
    }
  })

  it('every shipped UNRESOLVED_RECIPE_ALLOWED entry is well-formed (#264 review follow-up)', () => {
    // "Starts empty" broke the day a legitimate entry was ever added — the
    // allowlist exists precisely so a genuine exception CAN be recorded, so
    // asserting emptiness is a test that cannot survive its own mechanism
    // working as designed. What has to hold regardless of how many entries
    // ship is: every key names a REPO-RELATIVE path (never a bare basename
    // — that collision, between registry/llui/ui/avatar.ts and
    // examples/registry-demo/src/components/ui/avatar.ts, is what review-264h
    // fixed) and every entry carries a non-empty reason. "Closed at the
    // OTHER end" — every entry is actually consulted by a real sweep, and no
    // unlisted identifier is silently swallowed — is asserted separately in
    // tailwind-classes.test.ts, which is the only place a real corpus exists
    // to consult against; a unit file has no corpus to be closed over.
    for (const [key, allowed] of Object.entries(UNRESOLVED_RECIPE_ALLOWED)) {
      const [fileName] = key.split(': ')
      expect(fileName, `allowlist key "${key}" must be "path: identifier"`).toBeTruthy()
      expect(
        fileName?.includes('/'),
        `allowlist key "${key}" must name a repo-relative path, not a bare basename`,
      ).toBe(true)
      expect(
        typeof allowed.reason === 'string' && allowed.reason.trim().length > 0,
        `allowlist entry "${key}" must carry a non-empty reason`,
      ).toBe(true)
    }
  })

  it('FAILS LOUDLY on a switch-case const shadowed at use (case block scoping, ported from scopeIntroduces)', () => {
    // A hand-rolled scope walker that only recognized `Block` (not
    // `CaseBlock`) would treat this `c` as an unresolved MODULE reference —
    // it is really a per-case local, so it must be treated as locally
    // bound (skip), never resolved against a same-named module const.
    const src = `
      import { cn } from '@/lib/utils'
      const c = 'module-level-should-not-be-read'
      export function f(x: number) {
        switch (x) {
          case 1: {
            const c = 'p-2'
            cn(c)
            break
          }
        }
      }
    `
    expect(extractClassCandidates('x.ts', src)).toEqual([])
  })

  it('recognizes a function EXPRESSION self-name as locally bound (ported from scopeIntroduces)', () => {
    // `send` inside the function expression's own body refers to the
    // function itself (how a self-recursive callback calls itself), not any
    // module-level `send` — must be treated as locally bound, never
    // resolved as an unrelated module reference.
    const src = `
      import { cn } from '@/lib/utils'
      export const A = function send(depth: number) {
        if (depth > 0) return send(depth - 1)
        return cn(send)
      }
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
