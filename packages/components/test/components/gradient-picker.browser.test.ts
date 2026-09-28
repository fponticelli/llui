// @vitest-environment node
//
// Same lightweight Playwright pattern as `color-picker-oklch-canvas.browser.
// test.ts` (no vite dev server, `hermetic.launch()` + `page.setContent()`) —
// but here to check `colorAt`/`toCss` against what a REAL browser actually
// PAINTS for a `background: <gradient>`, not just that the string parses.
//
// A CSS gradient string cannot be read back through `getImageData` directly
// (`CanvasRenderingContext2D.fillStyle` takes a `CanvasGradient` OBJECT, not
// a gradient STRING, and a DOM element's CSS background never reaches a
// canvas's own pixel buffer). This uses the standard SVG `<foreignObject>`
// rasterization trick instead: embed a real HTML `<div style="background:
// ...">` inside an SVG, load that SVG as an `Image`, `drawImage` it onto a
// canvas, then `getImageData` — which IS real Chromium compositing/color
// management, not a re-implementation of it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import {
  init,
  toCss,
  colorAt,
  type GradientPickerState,
} from '../../src/components/gradient-picker'
import { parseCssColor, cssColorToSrgb, srgbToRgb255 } from '../../src/utils/color'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await hermetic.launch()
  page = await browser.newPage()
  await page.setContent('<!doctype html><div id="root"></div>')
})

afterAll(async () => {
  await browser.close()
})

const WIDTH = 400
const HEIGHT = 8
/** The row to sample — mid-height, away from any top/bottom edge
 * anti-aliasing. */
const SAMPLE_Y = 4

/** Rasterize `css` (a `background` value) at `WIDTH`x`HEIGHT` and return the
 * RGBA byte at `(x, SAMPLE_Y)`. */
async function pixelAt(css: string, x: number): Promise<[number, number, number, number]> {
  const pixels = await page.evaluate(
    async ({ css, width, height }: { css: string; width: number; height: number }) => {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:${css}"></div>` +
        `</foreignObject></svg>`
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('svg image failed to load'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(0, 0, width, height).data)
    },
    { css, width: WIDTH, height: HEIGHT },
  )
  const idx = (SAMPLE_Y * WIDTH + x) * 4
  return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!, pixels[idx + 3]!]
}

/** `colorAt`'s answer at `position` (0-100), as displayable sRGB bytes —
 * the same conversion the browser itself performs to paint any color space
 * onto screen pixels. */
function expectedRgbAt(state: GradientPickerState, position: number): [number, number, number] {
  const css = colorAt(state, position)
  const parsed = parseCssColor(css)!
  const rgb = srgbToRgb255(cssColorToSrgb(parsed))
  return [rgb.r, rgb.g, rgb.b]
}

/** Byte-level tolerance for real-browser color management / sRGB rounding —
 * a few LSBs, not a wide margin (mirrors `styling.md`'s token-contrast
 * guard's own "two 8-bit levels" discipline: a few units, never "close
 * enough to be meaningless"). */
const TOLERANCE = 6

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  for (let i = 0; i < expected.length; i++) {
    expect(
      Math.abs(actual[i]! - expected[i]!),
      `channel ${i}: ${actual} vs ${expected}`,
    ).toBeLessThanOrEqual(TOLERANCE)
  }
}

describe('gradient-picker colorAt matches real Chromium rendering (finding #4)', () => {
  it('srgb interpolation: exact byte match at several positions', async () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    for (const pct of [0, 25, 50, 75, 100]) {
      const x = Math.round((pct / 100) * (WIDTH - 1))
      const actual = await pixelAt(toCss(s), x)
      const expected = expectedRgbAt(s, pct)
      expectClose(actual, expected)
    }
  })

  it('oklch interpolation: matches, and genuinely differs from srgb at the midpoint', async () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'oklch', hue: 'shorter' },
    })
    const x = Math.round(0.5 * (WIDTH - 1))
    const actual = await pixelAt(toCss(s), x)
    const expected = expectedRgbAt(s, 50)
    expectClose(actual, expected)
    // Sanity: genuinely different from the plain sRGB midpoint (128,0,128).
    expect(Math.abs(actual[0]! - 128) + Math.abs(actual[2]! - 128)).toBeGreaterThan(TOLERANCE)
  })

  it('oklab interpolation: matches real rendering', async () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'lime' },
      ],
      interpolation: { space: 'oklab' },
    })
    for (const pct of [25, 50, 75]) {
      const x = Math.round((pct / 100) * (WIDTH - 1))
      const actual = await pixelAt(toCss(s), x)
      const expected = expectedRgbAt(s, pct)
      expectClose(actual, expected)
    }
  })

  it('longer hue: matches real rendering (a full hue sweep, not the short way round)', async () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'oklch(0.6 0.2 30)' },
      ],
      interpolation: { space: 'oklch', hue: 'longer' },
    })
    const x = Math.round(0.5 * (WIDTH - 1))
    const actual = await pixelAt(toCss(s), x)
    const expected = expectedRgbAt(s, 50)
    expectClose(actual, expected)
  })

  it('increasing hue: matches real rendering', async () => {
    const s = init({
      stops: [
        { position: 0, color: 'oklch(0.6 0.2 300)' },
        { position: 100, color: 'oklch(0.6 0.2 60)' },
      ],
      interpolation: { space: 'oklch', hue: 'increasing' },
    })
    const x = Math.round(0.5 * (WIDTH - 1))
    const actual = await pixelAt(toCss(s), x)
    const expected = expectedRgbAt(s, 50)
    expectClose(actual, expected)
  })

  it('finding #3: repeating wrap matches real repeating-linear-gradient painting', async () => {
    const s = init({
      repeating: true,
      stops: [
        { position: 20, color: 'red' },
        { position: 60, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    // colorAt(10) wraps to the same answer as colorAt(50) — both #4000bf.
    const x = Math.round((10 / 100) * (WIDTH - 1))
    const actual = await pixelAt(toCss(s), x)
    expectClose(actual, [0x40, 0x00, 0xbf])
  })

  it('finding #2a: an omitted `in <space>` with all-legacy stops renders as srgb (not oklab)', async () => {
    const parsed = init({ css: 'linear-gradient(90deg, red, blue)' })
    expect(parsed.interpolation.space).toBe('srgb')
    const x = Math.round(0.5 * (WIDTH - 1))
    const actual = await pixelAt(toCss(parsed), x)
    // The plain sRGB midpoint of red/blue, confirming the browser ALSO
    // defaults to sRGB for an all-legacy, `in`-omitted gradient.
    expectClose(actual, [0x80, 0x00, 0x80])
  })

  it('finding #2a: an omitted `in <space>` with a modern stop renders as oklab (not srgb)', async () => {
    const parsed = init({ css: 'linear-gradient(90deg, red, oklch(0.5 0.2 260))' })
    expect(parsed.interpolation.space).toBe('oklab')
    const x = Math.round(0.5 * (WIDTH - 1))
    const actual = await pixelAt(toCss(parsed), x)
    const expected = expectedRgbAt(parsed, 50)
    expectClose(actual, expected)
    // And it must NOT match the naive sRGB midpoint (a different color).
    const srgbState = {
      ...parsed,
      interpolation: { space: 'srgb' as const, hue: 'shorter' as const },
    }
    const srgbExpected = expectedRgbAt(srgbState, 50)
    expect(
      Math.abs(actual[0]! - srgbExpected[0]) + Math.abs(actual[2]! - srgbExpected[2]),
    ).toBeGreaterThan(TOLERANCE)
  })

  // The one case Lane A's own color-picker review could not verify in a
  // browser: an achromatic OKLCH stop's EXPLICIT hue vs a `none` hue.
  it("finding #4: an achromatic stop with an EXPLICIT hue rotates through it during interpolation; a `none` hue takes the OTHER stop's hue instead", async () => {
    // A: explicit hue 90 on an achromatic (c=0) stop — CSS Color 4 says an
    // EXPLICIT hue is used AS GIVEN, so this rotates from 90 toward 200.
    const explicitHue = init({
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.5, c: 0, h: 90 } },
        { position: 100, color: { model: 'oklch', l: 0.5, c: 0.2, h: 200 } },
      ],
      interpolation: { space: 'oklch', hue: 'shorter' },
    })
    // B: a genuinely `none` hue — the missing component takes the OTHER
    // stop's hue (200) throughout, so hue never rotates through 90 at all.
    const noneHueParsed = init({
      css: 'linear-gradient(90deg in oklch, oklch(0.5 0 none), oklch(0.5 0.2 200))',
    })

    const x = Math.round(0.25 * (WIDTH - 1)) // early enough that hue divergence is visible

    const explicitPixel = await pixelAt(toCss(explicitHue), x)
    const explicitExpected = expectedRgbAt(explicitHue, 25)
    expectClose(explicitPixel, explicitExpected)

    const nonePixel = await pixelAt(toCss(noneHueParsed), x)
    const noneExpected = expectedRgbAt(noneHueParsed, 25)
    expectClose(nonePixel, noneExpected)

    // The two must be genuinely DIFFERENT colors — this is the property
    // Lane A could not check in a browser: if `interpolateColor` treated
    // the explicit hue 90 as "missing" too (collapsing both cases to the
    // same answer), this assertion is what would catch it.
    const diff =
      Math.abs(explicitPixel[0]! - nonePixel[0]!) +
      Math.abs(explicitPixel[1]! - nonePixel[1]!) +
      Math.abs(explicitPixel[2]! - nonePixel[2]!)
    expect(diff).toBeGreaterThan(TOLERANCE)
  })
})
