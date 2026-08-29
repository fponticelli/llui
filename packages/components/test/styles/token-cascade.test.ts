import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  compareSpecificity,
  formatSpecificity,
  parseSpecificity,
  splitSelectorList,
  type Specificity,
} from './specificity'

/**
 * #241 / #242 — the token stylesheet's SPECIFICITY contract.
 *
 * The property under test is not how the selectors are spelled, it is which
 * block wins when a consumer overrides a base token. `tokens-dark.css`'s media
 * guard used to be (0,3,0), so on a dark OS it outranked every consumer override
 * — including `[data-theme='dark']` under an explicit `'dark'` preference, where
 * the consumer's selector matches perfectly well and still loses. Measured in
 * real Chromium before the fix, with `--primary` overridden by the consumer:
 *
 *   os=dark pref=dark    base=DARK  brand=!!BASE-WON!!
 *   os=dark pref=system  base=DARK  brand=!!BASE-WON!!
 *
 * A string assertion on the selector cannot see any of that, which is why this
 * file computes specificity from the text instead of comparing it. The real
 * cascade — the thing specificity is a model OF — is measured against Chromium
 * in `token-cascade.browser.test.ts`; this suite is the cheap half that runs
 * everywhere and fails fast.
 */

const STYLES = resolve(import.meta.dirname, '../../src/styles')

/** CSS comments carry `:root:where(...)` prose, so strip them before matching. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const tokensDark = stripComments(readFileSync(resolve(STYLES, 'tokens-dark.css'), 'utf8'))
const tokens = stripComments(readFileSync(resolve(STYLES, 'tokens.css'), 'utf8'))

/** The guard inside `@media (prefers-color-scheme: dark)`. */
const mediaSelector = tokensDark
  .match(/@media \(prefers-color-scheme: dark\) \{\s*([^{}]+?)\s*\{/)?.[1]
  ?.trim()
/** The explicit-dark selector list outside any media query. */
const explicitSelector = tokensDark.match(/\n(\.dark,\n\[data-theme='dark'\]) \{/)?.[1]

/** What a consumer writes. The first is what a shadcn theme generator emits. */
const SHADCN_GENERATOR = '.dark'
const LLUI_SPELLING = ".dark, [data-theme='dark']"
const PLAIN_ROOT = ':root'

describe('parseSpecificity (the measuring instrument, checked before it is trusted)', () => {
  it.each<[string, Specificity]>([
    [':root', [0, 1, 0]],
    ['.dark', [0, 1, 0]],
    ["[data-theme='dark']", [0, 1, 0]],
    [".dark, [data-theme='dark']", [0, 1, 0]],
    ['#app', [1, 0, 0]],
    ['div', [0, 0, 1]],
    ['*', [0, 0, 0]],
    ['div.a#b', [1, 1, 1]],
    // The two spellings #241 is about, plus the broken variant.
    [":root:not([data-theme='light']):not(.light)", [0, 3, 0]],
    [":root:where(:not([data-theme='light'])):where(:not(.light))", [0, 1, 0]],
    [":where(:root):where(:not([data-theme='light'])):where(:not(.light))", [0, 0, 0]],
    // `:not()` takes its most specific argument, not its argument count.
    [':not(a, .b, #c)', [1, 0, 0]],
    ['::before', [0, 0, 1]],
    ['a:hover', [0, 1, 1]],
  ])('%s is %s', (selector, expected) => {
    expect(parseSpecificity(selector)).toEqual(expected)
  })

  it('throws rather than guessing on a form it does not model', () => {
    // A silent zero would read as "this guard is harmless" — the exact wrong
    // answer for the property being measured.
    expect(() => parseSpecificity(':nth-child(2 of .item)')).toThrow(/unsupported/)
    expect(() => parseSpecificity(':not(.a')).toThrow(/unbalanced/)
    expect(() => parseSpecificity('')).toThrow(/empty/)
  })

  it('splits a selector list only at the top level', () => {
    expect(splitSelectorList(":not(a, b), [x='y,z']")).toEqual([':not(a, b)', "[x='y,z']"])
  })
})

describe('tokens-dark.css ships the selectors the token contract names', () => {
  it('extracts both (a rename here is a silent theme break)', () => {
    expect(mediaSelector).toBe(":root:where(:not([data-theme='light'])):where(:not(.light))")
    expect(explicitSelector).toBe(".dark,\n[data-theme='dark']")
  })

  it('the light default is a plain :root in tokens.css', () => {
    // The media guard has to BEAT this on source order, which is only true while
    // it is at least as specific. See the (0,0,0) case below.
    expect(tokens).toMatch(/\n:root \{/)
  })
})

describe('#241 — the media guard must not outrank a consumer override', () => {
  const guard = (): Specificity => parseSpecificity(mediaSelector as string)

  it('is (0,1,0), not the (0,3,0) it reads as', () => {
    // `:not()` takes its argument's specificity and two of them STACK, so the
    // unwrapped spelling is (0,3,0). That is the whole of #241.
    expect(formatSpecificity(guard())).toBe('(0,1,0)')
  })

  it.each([
    ['a shadcn generator block', SHADCN_GENERATOR],
    ['the LLui spelling', LLUI_SPELLING],
    ['a plain :root override', PLAIN_ROOT],
  ])('does not outrank %s, so source order decides', (_label, consumer) => {
    const cmp = compareSpecificity(guard(), parseSpecificity(consumer))
    expect(
      cmp,
      `guard ${formatSpecificity(guard())} vs consumer ${formatSpecificity(parseSpecificity(consumer))}`,
    ).toBeLessThanOrEqual(0)
  })

  it('still at least ties the light default it has to beat on source order', () => {
    // The broken variant of the fix — `:where(:root)` — is (0,0,0) and LOSES to
    // `tokens.css`'s own `:root`, which breaks dark mode outright. Measured, and
    // it is the variant an earlier comment named as if it were the fix.
    expect(compareSpecificity(guard(), parseSpecificity(':root'))).toBeGreaterThanOrEqual(0)
    expect(formatSpecificity(parseSpecificity(':where(:root):where(:not(.light))'))).toBe('(0,0,0)')
  })

  it('the explicit block ties a consumer block too, and comes BEFORE it in the file', () => {
    const explicit = parseSpecificity((explicitSelector as string).replace(/\n/g, ' '))
    expect(compareSpecificity(explicit, parseSpecificity(LLUI_SPELLING))).toBe(0)
    // Source order is the tiebreak, so the library's own block must be declared
    // before anything a consumer imports after it — i.e. inside this file, which
    // is what `@import` order gives.
    expect(tokensDark.indexOf('@media (prefers-color-scheme: dark)')).toBeLessThan(
      tokensDark.indexOf('.dark,'),
    )
  })
})

describe('#242 — the .dark class is a CONSUMER convention, and the file says so', () => {
  const raw = readFileSync(resolve(STYLES, 'tokens-dark.css'), 'utf8')

  it('still ships the .dark selector (dropping it would break next-themes consumers)', () => {
    // Measured: with the class present on <html> — which is what next-themes and
    // shadcn tooling write — a `.dark`-only consumer override wins in every cell
    // once #241's `:where()` is in place. Removing the selector would take dark
    // mode away from those consumers entirely, which is why option 2 lost.
    expect(explicitSelector).toContain('.dark')
  })

  it('no longer advertises .dark as something this package writes', () => {
    // The old header called `.dark` "what a shadcn theme generator emits" with no
    // qualification, while nothing in @llui/components has ever written it.
    expect(raw).toMatch(/THE ONLY ONE THIS\n \* +PACKAGE WRITES/)
    expect(raw).toMatch(/nothing in `@llui\/components` ever adds it/)
  })
})
