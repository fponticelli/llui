/**
 * The ONE real-pixel path for this repo's forced-colors / non-text-contrast
 * assertions (#264 review items 5 and 7).
 *
 * Before this module, `probeForcedColorCues` (navigation-data-browser-
 * probes.ts) compared `getComputedStyle` STRINGS with a regex — which stays
 * green even when every fill collapses to the literal system keyword
 * `CanvasText` under real `forced-colors: active` emulation, because two
 * elements sharing that keyword still produce two (identical) strings to
 * diff against a THIRD unrelated string built from other CSS properties. And
 * `registry/test/forced-colors-chart-series.browser.test.ts` carried two
 * near-duplicate pixel readers (`paintedColorCount` for its self-check
 * canary, `patternColorCount` for the real verdict) that could silently
 * diverge. Both problems are closed by the same fix: paint real colour
 * values on an in-page `<canvas>` (or screenshot a real rendered element),
 * PNG round-trip the result (`toDataURL`/screenshot -> `Image` ->
 * `drawImage` -> `getImageData`), and read the pixels back — never a string
 * parse — through this one module, used identically by the self-check
 * canaries and the real verdicts.
 */
import type { Locator, Page } from 'playwright'

export interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

const BUCKET = 8
const bucket = (value: number): number => Math.round(value / BUCKET) * BUCKET

/** Bucketed key for an RGB triple — collapses anti-aliased edge noise
 * without merging two genuinely different painted colours. */
export function bucketedKey({ r, g, b }: RGB): string {
  return `${bucket(r)},${bucket(g)},${bucket(b)}`
}

/**
 * Runs entirely INSIDE the page: paints each given CSS colour string as its
 * own tile on an in-page canvas, PNG round-trips the whole canvas, and
 * returns the resolved RGB for each tile's centre pixel. Self-contained (no
 * outer closures) so Playwright can serialize it directly via
 * `page.evaluate(fn, args)`.
 *
 * A real paint is required, not a regex over the CSS string, because CSS
 * Color 4 syntaxes (`oklch()`, `color-mix()`, and — the case this exists for
 * — forced-colors SYSTEM KEYWORDS like `CanvasText`/`Canvas`) do not
 * normalize to `rgb()` the way legacy sRGB keywords do, and a system keyword
 * has no fixed value at all until the browser actually paints it under the
 * active forced-colors palette.
 */
async function paintColorsInPage(colors: readonly string[]): Promise<RGB[]> {
  const tile = 8
  const source = document.createElement('canvas')
  source.width = tile * colors.length
  source.height = tile
  const ctx = source.getContext('2d')!
  // A translucent colour (e.g. `rgb(0 0 0 / 25%)`) has no fixed painted
  // value on its own — it composites against whatever sits behind it. This
  // path always composites against an explicit WHITE backing, matching the
  // repo's documented mid-tone canary ("composited over white").
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, source.width, source.height)
  colors.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(index * tile, 0, tile, tile)
  })

  const image = new Image()
  const loaded = new Promise<void>((res, rej) => {
    image.onload = () => res()
    image.onerror = () => rej(new Error('image failed to decode'))
  })
  image.src = source.toDataURL('image/png')
  await loaded

  const decoded = document.createElement('canvas')
  decoded.width = image.naturalWidth
  decoded.height = image.naturalHeight
  const decodedCtx = decoded.getContext('2d')!
  decodedCtx.drawImage(image, 0, 0)

  const half = Math.floor(tile / 2)
  return colors.map((_, index) => {
    const [r, g, b] = decodedCtx.getImageData(index * tile + half, half, 1, 1).data
    return { r: r!, g: g!, b: b! }
  })
}

/** Real-painted RGB for each of `colors`, resolved by the page itself. */
export async function paintedColors(page: Page, colors: readonly string[]): Promise<RGB[]> {
  return page.evaluate(paintColorsInPage, colors)
}

/** Self-contained: decodes a base64 PNG on an in-page canvas and returns the
 * set of distinct (bucketed) OPAQUE painted colours. Shared by every
 * pattern-paints-more-than-one-colour check in this repo — see the module
 * header. */
async function decodePngColors(pngBase64: string): Promise<string[]> {
  const image = new Image()
  const loaded = new Promise<void>((res, rej) => {
    image.onload = () => res()
    image.onerror = () => rej(new Error('image failed to decode'))
  })
  image.src = `data:image/png;base64,${pngBase64}`
  await loaded
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  const bucketLocal = (value: number): number => Math.round(value / 8) * 8
  const colors = new Set<string>()
  for (let x = 0; x < canvas.width; x++) {
    for (let y = 0; y < canvas.height; y++) {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      if (a === 0) continue
      colors.add(`${bucketLocal(r!)},${bucketLocal(g!)},${bucketLocal(b!)}`)
    }
  }
  return [...colors]
}

/**
 * Self-contained: decodes a base64 PNG and returns a normalized SPATIAL
 * fingerprint — the element scaled to a fixed 12x12 grid (`drawImage` with
 * explicit destination width/height, which resamples rather than merely
 * cropping) and read back cell by cell. A plain SET of distinct colours
 * cannot tell two patterns apart when they share the same two-colour
 * forced-colors palette (Canvas/CanvasText) at a different angle or spacing
 * — e.g. a 45deg vs 135deg hatch, or a wider vs narrower dash gap — because
 * the set of colours USED is identical either way; only the ARRANGEMENT
 * differs. Resampling to a fixed grid captures that arrangement so two
 * differently-angled or differently-spaced patterns produce different
 * fingerprints even though `decodePngColors` on either alone reports the
 * same two colours.
 */
async function decodePngSpatialSignature(pngBase64: string): Promise<string> {
  const image = new Image()
  const loaded = new Promise<void>((res, rej) => {
    image.onload = () => res()
    image.onerror = () => rej(new Error('image failed to decode'))
  })
  image.src = `data:image/png;base64,${pngBase64}`
  await loaded
  const grid = 12
  const canvas = document.createElement('canvas')
  canvas.width = grid
  canvas.height = grid
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, grid, grid)
  const bucketLocal = (value: number): number => Math.round(value / 16) * 16
  const cells: string[] = []
  for (let x = 0; x < grid; x++) {
    for (let y = 0; y < grid; y++) {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      cells.push(a === 0 ? 'x' : `${bucketLocal(r!)},${bucketLocal(g!)},${bucketLocal(b!)}`)
    }
  }
  return cells.join('|')
}

/**
 * Paint a KNOWN pattern (two-tone or solid, both 40x40) on an in-page canvas
 * and read back its distinct painted colour count — self-contained for
 * `page.evaluate`. This is the harness's OWN self-check: a two-tone canvas
 * must read back as >= 2 colours and a solid one as exactly 1, proven before
 * any real element's signature is trusted (#264 review item 5's "two-tone
 * canary uses paintedColorCount while the verdict uses patternColorCount" —
 * both now call this one function).
 */
async function paintKnownPatternInPage(twoTone: boolean): Promise<string[]> {
  const source = document.createElement('canvas')
  source.width = 40
  source.height = 40
  const ctx = source.getContext('2d')!
  if (twoTone) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 20, 40)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(20, 0, 20, 40)
  } else {
    ctx.fillStyle = '#336699'
    ctx.fillRect(0, 0, 40, 40)
  }
  const image = new Image()
  const loaded = new Promise<void>((res, rej) => {
    image.onload = () => res()
    image.onerror = () => rej(new Error('image failed to decode'))
  })
  image.src = source.toDataURL('image/png')
  await loaded
  const decoded = document.createElement('canvas')
  decoded.width = image.naturalWidth
  decoded.height = image.naturalHeight
  const decodedCtx = decoded.getContext('2d')!
  decodedCtx.drawImage(image, 0, 0)
  const bucketLocal = (value: number): number => Math.round(value / 8) * 8
  const colors = new Set<string>()
  for (let x = 0; x < decoded.width; x++) {
    for (let y = 0; y < decoded.height; y++) {
      const [r, g, b, a] = decodedCtx.getImageData(x, y, 1, 1).data
      if (a === 0) continue
      colors.add(`${bucketLocal(r!)},${bucketLocal(g!)},${bucketLocal(b!)}`)
    }
  }
  return [...colors]
}

/** The harness self-check: a known two-tone paint reads back as >= 2
 * colours, a known solid paint as exactly 1 — both through
 * `paintKnownPatternInPage`, the SAME function `distinctPaintedColorCount`
 * (element screenshots) and `paintedElementSignature` decode with. */
export async function selfCheckPixelHarness(page: Page): Promise<void> {
  const twoTone = await page.evaluate(paintKnownPatternInPage, true)
  if (twoTone.length < 2) {
    throw new Error(
      `pixel harness self-check failed: two-tone paint read back as ${twoTone.length} colour(s)`,
    )
  }
  const solid = await page.evaluate(paintKnownPatternInPage, false)
  if (solid.length !== 1) {
    throw new Error(
      `pixel harness self-check failed: solid paint read back as ${solid.length} colour(s)`,
    )
  }

  // The spatial-fingerprint discriminator (`paintedSpatialSignature`) is
  // proven in BOTH directions before it is trusted: the SAME element
  // screenshotted twice must fingerprint IDENTICALLY (never flaky by
  // position or timing), and a DIFFERENT angle of the same two colours —
  // the exact shape a colour-SET comparison cannot tell apart — must
  // fingerprint DIFFERENTLY. Two SEPARATE elements at different page
  // positions are deliberately not compared for the "same" direction: a
  // repeating gradient can rasterize with a different sub-pixel phase
  // depending on the element's own absolute position, which would make
  // that comparison flaky for a reason having nothing to do with the
  // discriminator under test.
  await page.evaluate((deg) => {
    const el = document.createElement('div')
    el.id = 'pixel-probe-self-check-a'
    el.style.position = 'fixed'
    el.style.left = '0px'
    el.style.top = '0px'
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.backgroundImage = `repeating-linear-gradient(${deg}deg, black 0 3px, white 3px 6px)`
    document.body.appendChild(el)
  }, 45)
  await page.evaluate((deg) => {
    const el = document.createElement('div')
    el.id = 'pixel-probe-self-check-c'
    el.style.position = 'fixed'
    el.style.left = '32px'
    el.style.top = '0px'
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.backgroundImage = `repeating-linear-gradient(${deg}deg, black 0 3px, white 3px 6px)`
    document.body.appendChild(el)
  }, 135)
  const elementA = page.locator('#pixel-probe-self-check-a')
  const sigA1 = await paintedSpatialSignature(elementA)
  const sigA2 = await paintedSpatialSignature(elementA)
  const sigC = await paintedSpatialSignature(page.locator('#pixel-probe-self-check-c'))
  await page.evaluate(() => {
    for (const id of ['pixel-probe-self-check-a', 'pixel-probe-self-check-c']) {
      document.getElementById(id)?.remove()
    }
  })
  if (sigA1 !== sigA2) {
    throw new Error(
      'pixel harness self-check failed: the same element fingerprinted differently on re-screenshot',
    )
  }
  if (sigA1 === sigC) {
    throw new Error(
      'pixel harness self-check failed: a 45deg and a 135deg pattern fingerprinted identically',
    )
  }
}

/**
 * Screenshot an existing element (or an isolated in-page reconstruction of
 * one, e.g. a single SVG `<pattern>` tile) and read back the set of
 * distinct (bucketed) painted colours — a real pixel signature, never a
 * string built from CSS property text.
 */
export async function paintedElementSignature(locator: Locator): Promise<string[]> {
  const shot = await locator.screenshot()
  return locator.page().evaluate(decodePngColors, shot.toString('base64'))
}

export async function distinctPaintedColorCount(locator: Locator): Promise<number> {
  return (await paintedElementSignature(locator)).length
}

/** The normalized 12x12 spatial fingerprint of an element's real rendered
 * pixels — see `decodePngSpatialSignature`'s header for why a plain colour
 * SET is not enough to tell two same-palette patterns apart. */
export async function paintedSpatialSignature(locator: Locator): Promise<string> {
  const shot = await locator.screenshot()
  return locator.page().evaluate(decodePngSpatialSignature, shot.toString('base64'))
}
