// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../scripts/lib/vite-source-aliases.mjs'
import { contrast, srgb8ToLinear } from '../../scripts/lib/oklch.mjs'

/**
 * Proves the #264 forced-colors fix end to end: `forced-colors: active`
 * collapses every author colour to a tiny system palette, so `fill:
 * CanvasText` alone made every bar/area series paint identically (two bar
 * series were genuinely indistinguishable) and a dashed STROKE did nothing
 * for a filled shape's FILL. The fix gives bar/area marks an SVG `<pattern>`
 * fill per series-cue and gives dot markers a distinct radius/fill/stroke-
 * dash combination. This test mounts a REAL 3-bar + 3-area chart through the
 * real machine and BOTH real skins (registry Tailwind + baseline CSS) under
 * real `forced-colors: active` emulation in Chromium, and checks two things
 * derived from the RENDERED output, never a regex over computed-style text:
 *
 * 1. Each series' resolved `fill` (a real browser-computed value: either a
 *    literal system colour or a `url(#pattern-id)` reference) differs from
 *    its same-mark siblings — the actual paint target differs, not just an
 *    attribute in the source.
 * 2. Every pattern a mark references is independently confirmed to paint at
 *    least two DISTINCT pixels, by drawing that pattern's own tile onto an
 *    in-page canvas and reading the pixels back (`getImageData`) — real
 *    paint, not a string.
 *
 * The pixel harness is SELF-CHECKED before it is trusted: a known two-tone
 * canvas rect must read back as two colours (never one), and the repo's two
 * standard contrast pairs (#000/#fff -> 21:1, rgb(0 0 0 / 25%) over white ->
 * 1.838893:1) must round-trip through the same contrast math this repo uses
 * elsewhere (`scripts/lib/oklch.mjs`).
 */

const repoRoot = resolve(import.meta.dirname, '../..')

const sourceAliases: Alias[] = [
  ...sourceAliasesFromExports({
    packageName: '@llui/components',
    packageJsonPath: resolve(repoRoot, 'packages/components/package.json'),
    srcDir: resolve(repoRoot, 'packages/components/src'),
  }),
  ...sourceAliasesFromExports({
    packageName: '@llui/dom',
    packageJsonPath: resolve(repoRoot, 'packages/dom/package.json'),
    srcDir: resolve(repoRoot, 'packages/dom/src'),
  }),
  ...sourceAliasesFromExports({
    packageName: '@llui/interactions',
    packageJsonPath: resolve(repoRoot, 'packages/interactions/package.json'),
    srcDir: resolve(repoRoot, 'packages/interactions/src'),
  }),
]

async function startExample(directory: string): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: resolve(repoRoot, directory),
    logLevel: 'error',
    resolve: { alias: sourceAliases },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error(`Vite did not bind ${directory} to a TCP port`)
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

/**
 * Paint a KNOWN pattern (two-tone or solid) on an in-page canvas, decode the
 * resulting PNG back onto a SECOND canvas (`toDataURL` + `Image` +
 * `drawImage` + `getImageData` — a real pixel round-trip, never a
 * CSS-string parse), and return the count of distinct (bucketed) colours.
 * Bucketing (nearest 8 per channel) collapses anti-aliased edge pixels
 * without merging two genuinely different paint colours.
 */
async function paintedColorCount(page: Page, twoTone: boolean): Promise<number> {
  return page.evaluate(async (wantTwoTone) => {
    const source = document.createElement('canvas')
    source.width = 40
    source.height = 40
    const sourceCtx = source.getContext('2d')!
    if (wantTwoTone) {
      sourceCtx.fillStyle = '#000000'
      sourceCtx.fillRect(0, 0, 20, 40)
      sourceCtx.fillStyle = '#ffffff'
      sourceCtx.fillRect(20, 0, 20, 40)
    } else {
      sourceCtx.fillStyle = '#336699'
      sourceCtx.fillRect(0, 0, 40, 40)
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

    const bucket = (value: number): number => Math.round(value / 8) * 8
    const colors = new Set<string>()
    for (let x = 0; x < decoded.width; x++) {
      for (let y = 0; y < decoded.height; y++) {
        const [r, g, b, a] = decodedCtx.getImageData(x, y, 1, 1).data
        if (a === 0) continue
        colors.add(`${bucket(r)},${bucket(g)},${bucket(b)}`)
      }
    }
    return colors.size
  }, twoTone)
}

/**
 * Render an existing `<pattern>` element's tile in isolation (a fresh 8x8
 * SVG containing only that pattern's `<defs>` and a `<rect>` filled with it),
 * screenshot it, and read back the number of distinct painted colours —
 * confirming the pattern genuinely paints more than one colour, independent
 * of where any chart mark happens to reference it.
 */
const PATTERN_PROBE_ID = 'forced-colors-pattern-probe'

async function patternColorCount(page: Page, patternId: string): Promise<number> {
  await page.evaluate(
    ({ id, probeId }) => {
      const pattern = document.getElementById(id)
      if (pattern === null) throw new Error(`missing pattern #${id}`)
      const patternMarkup = new XMLSerializer().serializeToString(pattern)
      const container = document.createElement('div')
      container.id = probeId
      container.innerHTML = `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><defs>${patternMarkup}</defs><rect width="16" height="16" fill="url(#pattern-under-test)"/></svg>`
      container.querySelector('pattern')!.setAttribute('id', 'pattern-under-test')
      document.body.appendChild(container)
    },
    { id: patternId, probeId: PATTERN_PROBE_ID },
  )

  const shot = await page.locator(`#${PATTERN_PROBE_ID} svg`).screenshot()
  await page.evaluate((probeId) => document.getElementById(probeId)?.remove(), PATTERN_PROBE_ID)

  return page.evaluate(async (pngBase64) => {
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
    const bucket = (value: number): number => Math.round(value / 8) * 8
    const colors = new Set<string>()
    for (let x = 0; x < canvas.width; x++) {
      for (let y = 0; y < canvas.height; y++) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
        if (a === 0) continue
        colors.add(`${bucket(r)},${bucket(g)},${bucket(b)}`)
      }
    }
    return colors.size
  }, shot.toString('base64'))
}

interface SeriesFill {
  readonly series: string
  readonly fill: string
}

// Scoped to `#chart-svg` (the VISIBLE chart), never `document` (#264 review
// item 3): the fixture page also mounts a HIDDEN chart FIRST, reusing the
// exact same series keys, so an unscoped query would silently read whichever
// instance's elements happen to come first in document order.
async function seriesFills(page: Page, markSelector: string): Promise<SeriesFill[]> {
  return page.evaluate((selector) => {
    const root = document.getElementById('chart-svg')
    if (root === null) throw new Error('missing #chart-svg')
    const bySeries = new Map<string, string>()
    for (const el of root.querySelectorAll(selector)) {
      const series = el.getAttribute('data-series')
      if (series === null || bySeries.has(series)) continue
      bySeries.set(series, getComputedStyle(el).fill)
    }
    return [...bySeries.entries()].map(([series, fill]) => ({ series, fill }))
  }, markSelector)
}

interface DotSignature {
  readonly series: string
  readonly signature: string
}

// Scoped to `#chart-svg` for the same reason as `seriesFills` above.
async function dotSignatures(page: Page, dotSelector: string): Promise<DotSignature[]> {
  return page.evaluate((selector) => {
    const root = document.getElementById('chart-svg')
    if (root === null) throw new Error('missing #chart-svg')
    const bySeries = new Map<string, string>()
    for (const el of root.querySelectorAll(selector)) {
      const series = el.getAttribute('data-series')
      if (series === null || bySeries.has(series)) continue
      const style = getComputedStyle(el)
      // The forced-colors skin sets `r` via a CSS `[r:...]` arbitrary-value
      // utility (#264 review item 11), so the SVG attribute's own `baseVal`
      // (what the machine/view wrote before CSS ever ran) is the WRONG
      // read — it is the computed style, not the DOM property, that
      // reflects what actually painted.
      const r = style.r
      bySeries.set(
        series,
        [r, style.fill, style.stroke, style.strokeWidth, style.strokeDasharray].join('|'),
      )
    }
    return [...bySeries.entries()].map(([series, signature]) => ({ series, signature }))
  }, dotSelector)
}

function patternIdOf(fill: string): string | null {
  const match = /url\("?#([^")]+)"?\)/.exec(fill)
  return match?.[1] ?? null
}

async function selfCheckHarness(page: Page): Promise<void> {
  // A KNOWN two-tone canvas (black left half, white right half) must read
  // back as MORE than one colour, and a known SOLID canvas must read back as
  // EXACTLY one — both directions of the discriminator every check below
  // relies on, proven before it is trusted on the real chart's patterns.
  const twoTone = await paintedColorCount(page, true)
  expect(twoTone).toBeGreaterThanOrEqual(2)
  const solid = await paintedColorCount(page, false)
  expect(solid).toBe(1)

  // Self-check the CONTRAST math itself (reused from scripts/lib/oklch.mjs,
  // the repo's one shared implementation) against the repo's two standard
  // pairs, independent of the chart.
  const black: RGB = { r: 0, g: 0, b: 0 }
  const white: RGB = { r: 255, g: 255, b: 255 }
  const blackWhite = contrast(
    srgb8ToLinear([black.r, black.g, black.b]),
    srgb8ToLinear([white.r, white.g, white.b]),
  )
  expect(blackWhite).toBeCloseTo(21, 1)
  // rgb(0 0 0 / 25%) composited over white -> rgb(191,191,191) at 1.838893:1
  // (0.75 * 255 = 191.25, which rounds unambiguously — the repo's own reason
  // for using 25%, not 50%, as the mid-tone canary elsewhere).
  const midTone: RGB = { r: 191, g: 191, b: 191 }
  const midToneVsWhite = contrast(
    srgb8ToLinear([midTone.r, midTone.g, midTone.b]),
    srgb8ToLinear([white.r, white.g, white.b]),
  )
  expect(midToneVsWhite).toBeCloseTo(1.838893, 5)
}

describe('forced-colors chart series distinctness (real pixels, both paths)', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  let demos: { path: 'baseline' | 'registryTailwind'; url: string }[] = []

  beforeAll(async () => {
    const [baseline, registryTailwind] = await Promise.all([
      startExample('examples/components-demo'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registryTailwind.server]
    demos = [
      { path: 'baseline', url: `${baseline.url}src/test-fixtures/forced-colors-chart.html` },
      {
        path: 'registryTailwind',
        url: `${registryTailwind.url}src/test-fixtures/forced-colors-chart.html`,
      },
    ]
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s: three bar series and three area series resolve to pairwise-distinct, genuinely two-toned fills under forced colors',
    async (path) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const context: BrowserContext = await browser.newContext({ forcedColors: 'active' })
      const page = await context.newPage()
      await page.goto(demo.url)
      await page.locator('#chart-svg').waitFor({ state: 'attached' })

      await selfCheckHarness(page)

      const barFills = await seriesFills(
        page,
        '[data-scope="chart"][data-part="mark"][data-mark="bar"]',
      )
      const areaFills = await seriesFills(
        page,
        '[data-scope="chart"][data-part="mark"][data-mark="area"]',
      )
      // Exact, not a floor (#264 review item 11): the fixture declares
      // exactly 3 bar and 3 area series, so a floor could not catch a
      // regression that silently dropped or duplicated one.
      expect(barFills.length).toBe(3)
      expect(areaFills.length).toBe(3)

      // 1. Each series' resolved fill differs from its same-mark siblings.
      expect(new Set(barFills.map((f) => f.fill)).size).toBe(barFills.length)
      expect(new Set(areaFills.map((f) => f.fill)).size).toBe(areaFills.length)

      // 2. Every referenced pattern is independently confirmed, by REAL
      // painted pixels, to use more than one colour — so the redundant cue
      // is not merely "a different string", it is a visibly different mark.
      const patternIds = new Set(
        [...barFills, ...areaFills].map((f) => patternIdOf(f.fill)).filter((id) => id !== null),
      )
      // Exact (#264 review item 11): 6 series cycling 5 cues mod-5 means
      // cue indices 0 and 5 both land on 'solid' (a literal CanvasText fill,
      // no pattern reference), so exactly 4 of the 5 cue names are ever
      // referenced by a pattern url() here — short-dash/dot/long-dash/dash-dot.
      expect(patternIds.size).toBe(4)
      for (const id of patternIds) {
        const colorCount = await patternColorCount(page, id)
        expect(colorCount, `pattern #${id} should paint >= 2 colours`).toBeGreaterThanOrEqual(2)
      }

      await context.close()
    },
  )

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s: dot markers resolve to pairwise-distinct radius/fill/stroke combinations under forced colors',
    async (path) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const context: BrowserContext = await browser.newContext({ forcedColors: 'active' })
      const page = await context.newPage()
      await page.goto(demo.url)
      await page.locator('#chart-svg').waitFor({ state: 'attached' })

      const dots = await dotSignatures(page, '[data-scope="chart"][data-part="dot"]')
      // Exact (#264 review item 11): `geometry()` only pushes vertices for
      // non-bar series (chart.ts's bar branch `continue`s before the vertex
      // loop), so only the 3 area series carry a rendered dot in this
      // fixture — a floor could not catch a regression dropping one.
      expect(dots.length).toBe(3)
      expect(new Set(dots.map((d) => d.signature)).size).toBe(dots.length)

      await context.close()
    },
  )

  // #264 review item 3, the exact regression: the fixture page mounts a
  // HIDDEN chart (`display:none`) FIRST and the real, visible one SECOND —
  // both defining pattern ids. Under the old shared, global id design,
  // `url(#llui-chart-pattern-dot)` on the VISIBLE chart's marks resolved to
  // whichever same-named `<pattern>` the browser's id table returned, which
  // was the HIDDEN chart's copy (first in document order) — and a paint
  // server referenced from inside a non-rendered subtree does not paint even
  // for a consumer outside it, so every visible bar/area mark went blank.
  // Per-instance ids close the bug structurally: this proves the two
  // instances never share an id at all, and that the visible chart still
  // paints with real, multi-colour patterns despite the hidden one coming
  // first.
  it.each(['baseline', 'registryTailwind'] as const)(
    '%s: a hidden chart mounted first does not blank the visible chart mounted second',
    async (path) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const context: BrowserContext = await browser.newContext({ forcedColors: 'active' })
      const page = await context.newPage()
      await page.goto(demo.url)
      await page.locator('#chart-svg').waitFor({ state: 'attached' })

      // The hidden chart is really hidden, and really mounted before the
      // visible one in document order.
      const order = await page.evaluate(() => {
        const hidden = document.getElementById('chart-hidden-svg')
        const visible = document.getElementById('chart-svg')
        if (hidden === null || visible === null) return null
        return {
          hiddenIsHidden: getComputedStyle(hidden.closest('#hidden-app') ?? hidden).display,
          hiddenComesFirst:
            (hidden.compareDocumentPosition(visible) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        }
      })
      expect(order).not.toBeNull()
      expect(order!.hiddenIsHidden).toBe('none')
      expect(order!.hiddenComesFirst).toBe(true)

      // No id collision between the two instances' patterns.
      const [hiddenPatternIds, visiblePatternIds] = await page.evaluate(() => {
        const idsIn = (svgId: string): string[] =>
          [...(document.getElementById(svgId)?.querySelectorAll('pattern') ?? [])].map((p) => p.id)
        return [idsIn('chart-hidden-svg'), idsIn('chart-svg')]
      })
      expect(hiddenPatternIds.length).toBeGreaterThan(0)
      expect(visiblePatternIds.length).toBeGreaterThan(0)
      expect(hiddenPatternIds.some((id) => visiblePatternIds.includes(id))).toBe(false)

      // And the visible chart's own marks still paint with real,
      // multi-colour patterns — the actual regression this closes.
      const barFills = await seriesFills(
        page,
        '[data-scope="chart"][data-part="mark"][data-mark="bar"]',
      )
      const areaFills = await seriesFills(
        page,
        '[data-scope="chart"][data-part="mark"][data-mark="area"]',
      )
      const patternIds = new Set(
        [...barFills, ...areaFills].map((f) => patternIdOf(f.fill)).filter((id) => id !== null),
      )
      expect(patternIds.size).toBe(4)
      for (const id of patternIds) {
        expect(visiblePatternIds, id).toContain(id)
        const colorCount = await patternColorCount(page, id)
        expect(colorCount, `pattern #${id} should paint >= 2 colours`).toBeGreaterThanOrEqual(2)
      }

      await context.close()
    },
  )
})
