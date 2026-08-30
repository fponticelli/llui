// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #241 / #242 — the token cascade, measured in a real browser.
 *
 * `token-cascade.test.ts` computes specificity from the selector text. This file
 * measures the thing specificity is a MODEL of: which declaration actually wins,
 * across all six (theme preference x OS) cells, for the override shapes a
 * consumer really writes. jsdom cannot answer it — it does not resolve the
 * custom-property cascade under a media query — so this is the only place the
 * property is observed rather than derived.
 *
 * Before the fix, with the guard at (0,3,0):
 *
 *   override                                 os=dark pref=dark   os=dark pref=system
 *   A shadcn generator verbatim (.dark)      BASE-WON            BASE-WON
 *   B .dark, [data-theme='dark']             BASE-WON            BASE-WON
 *   C B + twin media block                   BRAND               BRAND
 *
 * After: A and B win wherever their selector MATCHES. A `'system'` preference
 * writes no attribute and this package writes no class (#242), so nothing a
 * consumer can select on is present in that cell — C, the documented twin block,
 * remains the answer there and is asserted as such rather than assumed.
 */

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const tokens = readFileSync(resolve(STYLES, 'tokens.css'), 'utf8')
const tokensDark = readFileSync(resolve(STYLES, 'tokens-dark.css'), 'utf8')

/** The guard the stylesheet actually ships, read back out of it. */
const MEDIA_GUARD = tokensDark
  .match(/@media \(prefers-color-scheme: dark\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?([^{}]+?)\s*\{/)?.[1]
  ?.trim()

const BRAND = 'oklch(0.7 0.15 258)'
const LIGHT_PRIMARY = 'oklch(0.205 0 0)'
const DARK_PRIMARY = 'oklch(0.922 0 0)'
const LIGHT_BG = 'oklch(1 0 0)'
const DARK_BG = 'oklch(0.145 0 0)'

type Preference = 'light' | 'dark' | 'system'
type OsScheme = 'light' | 'dark'

/** The three shapes the issues name, plus the attribute-only spelling. */
const OVERRIDES = {
  shadcnGenerator: `.dark { --primary: ${BRAND}; }`,
  lluiSpelling: `.dark, [data-theme='dark'] { --primary: ${BRAND}; }`,
  lluiSpellingPlusTwin: `.dark, [data-theme='dark'] { --primary: ${BRAND}; }
@media (prefers-color-scheme: dark) { ${MEDIA_GUARD} { --primary: ${BRAND}; } }`,
} as const

type Verdict = 'BRAND' | 'BASE-WON' | 'base-light'

const classify = (raw: string): Verdict | string => {
  const v = raw.trim().replace(/\s+/g, ' ')
  if (v === BRAND) return 'BRAND'
  if (v === DARK_PRIMARY) return 'BASE-WON'
  if (v === LIGHT_PRIMARY) return 'base-light'
  return `?${v}`
}

const classifyBase = (raw: string): string => {
  const v = raw.trim().replace(/\s+/g, ' ')
  if (v === DARK_BG) return 'DARK'
  if (v === LIGHT_BG) return 'LIGHT'
  return `?${v}`
}

describe('#241/#242 — token cascade in Chromium', () => {
  let browser: Browser
  /** os -> preference -> override name -> { base, brand } */
  const matrix = new Map<string, { base: string; brand: string }>()
  let canary: { visibility: string; end: string } | undefined
  let sheetScan: { topLevel: number; withImports: number } | undefined

  beforeAll(async () => {
    if (MEDIA_GUARD === undefined)
      throw new Error('could not read the media guard out of tokens-dark.css')
    browser = await chromium.launch({ headless: true })

    for (const os of ['light', 'dark'] as OsScheme[]) {
      const context = await browser.newContext({ colorScheme: os })
      const page = await context.newPage()
      for (const [name, override] of Object.entries(OVERRIDES)) {
        for (const pref of ['light', 'dark', 'system'] as Preference[]) {
          await page.setContent(
            `<!doctype html><html><head>` +
              `<style>${tokens}</style><style>${tokensDark}</style><style>${override}</style>` +
              `</head><body>x</body></html>`,
          )
          const cell = await page.evaluate((pref) => {
            const html = document.documentElement
            // `applyTheme()` semantics exactly: the PREFERENCE, and the attribute
            // REMOVED for 'system'. Nothing writes a class (#242).
            if (pref === 'system') delete html.dataset['theme']
            else html.dataset['theme'] = pref
            const cs = getComputedStyle(html)
            return {
              primary: cs.getPropertyValue('--primary'),
              background: cs.getPropertyValue('--background'),
            }
          }, pref)
          matrix.set(`${os}|${pref}|${name}`, {
            base: classifyBase(cell.background),
            brand: classify(cell.primary),
          })
        }
      }

      if (canary === undefined) {
        // A hidden tab freezes transitions, and `getComputedStyle` then reports
        // the value a property is STUCK at rather than what the cascade says.
        // Prove the page is not in that state before trusting anything above.
        canary = await page.evaluate(async () => {
          const el = document.createElement('div')
          el.style.cssText = 'background: red; transition: background 40ms linear'
          document.body.appendChild(el)
          // Force a style flush so the transition starts from `red` rather than
          // coalescing both writes into one computed value.
          void getComputedStyle(el).backgroundColor
          el.style.background = 'blue'
          await new Promise((r) => setTimeout(r, 200))
          const end = getComputedStyle(el).backgroundColor
          el.remove()
          return { visibility: document.visibilityState as string, end }
        })
        sheetScan = await page.evaluate(() => {
          const count = (descend: boolean): number => {
            let n = 0
            const walk = (sheet: CSSStyleSheet): void => {
              for (const rule of Array.from(sheet.cssRules)) {
                n++
                const imported = (rule as CSSImportRule).styleSheet
                if (descend && imported) walk(imported)
              }
            }
            for (const s of Array.from(document.styleSheets)) walk(s as CSSStyleSheet)
            return n
          }
          return { topLevel: count(false), withImports: count(true) }
        })
      }
      await context.close()
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  const cell = (os: OsScheme, pref: Preference, name: keyof typeof OVERRIDES) => {
    const found = matrix.get(`${os}|${pref}|${name}`)
    if (!found) throw new Error(`no measurement for ${os}/${pref}/${name}`)
    return found
  }

  it('the probe is trustworthy: visible tab, transitions running, rules found', () => {
    // Each of these has produced a confident wrong reading in this repo before.
    expect(canary?.visibility).toBe('visible')
    expect(canary?.end).toBe('rgb(0, 0, 255)')
    // A `cssRules` walk that does not descend into `@import`ed sheets returns
    // nothing for a stylesheet built out of imports, and zero rows read as
    // confirmation. This page inlines the sheets, so both counts are non-zero —
    // the assertion is that the scan is not vacuous, whichever way it walks.
    expect(sheetScan?.topLevel ?? 0).toBeGreaterThan(0)
    expect(sheetScan?.withImports ?? 0).toBeGreaterThanOrEqual(sheetScan?.topLevel ?? 0)
  })

  it('the base palette still resolves correctly in all six cells', () => {
    // The `:where()` guard must still BEAT `tokens.css`'s own `:root`. The
    // broken variant (`:where(:root)`, (0,0,0)) fails exactly here, with dark
    // mode gone and every override assertion below still green.
    const base = (os: OsScheme, pref: Preference) => cell(os, pref, 'lluiSpelling').base
    expect({
      lightOs: [base('light', 'light'), base('light', 'dark'), base('light', 'system')],
      darkOs: [base('dark', 'light'), base('dark', 'dark'), base('dark', 'system')],
    }).toEqual({
      lightOs: ['LIGHT', 'DARK', 'LIGHT'],
      darkOs: ['LIGHT', 'DARK', 'DARK'],
    })
  })

  it('#241 — an explicit dark preference honours the consumer override on BOTH OS settings', () => {
    // This is the cell the issue is really about: the attribute is present, the
    // consumer's selector matches, and before the fix it still lost on a dark OS.
    expect(cell('light', 'dark', 'lluiSpelling').brand).toBe('BRAND')
    expect(cell('dark', 'dark', 'lluiSpelling').brand).toBe('BRAND')
  })

  it('#241 — the documented twin block wins the system-on-dark-OS cell', () => {
    expect(cell('dark', 'system', 'lluiSpellingPlusTwin').brand).toBe('BRAND')
    expect(cell('dark', 'dark', 'lluiSpellingPlusTwin').brand).toBe('BRAND')
  })

  it('a light preference is unaffected by a dark override, on either OS', () => {
    for (const os of ['light', 'dark'] as OsScheme[])
      for (const name of Object.keys(OVERRIDES) as (keyof typeof OVERRIDES)[])
        expect(cell(os, 'light', name), `${os}/light/${name}`).toEqual({
          base: 'LIGHT',
          brand: 'base-light',
        })
  })

  it('#242 — a shadcn generator block is still dead wherever nothing writes .dark', () => {
    // NOT a regression and NOT fixed by #241: `applyTheme` writes `data-theme`
    // only, so a `.dark`-only selector matches nothing in any cell. Pinned so the
    // docs' find-and-replace instruction cannot quietly stop being necessary.
    expect(cell('light', 'dark', 'shadcnGenerator').brand).toBe('BASE-WON')
    expect(cell('dark', 'dark', 'shadcnGenerator').brand).toBe('BASE-WON')
    expect(cell('dark', 'system', 'shadcnGenerator').brand).toBe('BASE-WON')
  })

  it("#242 — a 'system' preference leaves nothing for a consumer selector to match", () => {
    // The half `:where()` cannot repair, stated as a measurement rather than as
    // prose: without the twin block the library's media value wins here, because
    // the consumer's rule does not apply at all.
    expect(cell('dark', 'system', 'lluiSpelling').brand).toBe('BASE-WON')
    expect(cell('dark', 'system', 'lluiSpellingPlusTwin').brand).toBe('BRAND')
  })

  it('#242 — a consumer who DOES write .dark themselves gets the override, which is why the selector stays', () => {
    // next-themes and shadcn tooling write the class; the package does not. With
    // the class on <html> the generator-verbatim block wins — the measured reason
    // for keeping the `.dark` selector rather than dropping it (option 2).
    //
    // The OS is deliberately LIGHT. On a dark OS the media block supplies the dark
    // BASE palette on its own, so `base: DARK` would hold with the library's
    // `.dark` selector deleted and this case would pass against option 2 — checked,
    // by mutation. On a light OS only that selector can produce a dark palette,
    // which is exactly the next-themes consumer this argument is about.
    return (async () => {
      const context = await browser.newContext({ colorScheme: 'light' })
      const page = await context.newPage()
      await page.setContent(
        `<!doctype html><html class="dark"><head>` +
          `<style>${tokens}</style><style>${tokensDark}</style>` +
          `<style>${OVERRIDES.shadcnGenerator}</style>` +
          `</head><body>x</body></html>`,
      )
      const got = await page.evaluate(() => ({
        primary: getComputedStyle(document.documentElement).getPropertyValue('--primary'),
        background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
      }))
      await context.close()
      expect({ brand: classify(got.primary), base: classifyBase(got.background) }).toEqual({
        brand: 'BRAND',
        base: 'DARK',
      })
    })()
  })
})
