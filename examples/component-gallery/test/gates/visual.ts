/**
 * Deterministic visual regression for the gallery's path documents (#268).
 *
 * WHAT is compared: one PNG per visual case (`matrix.ts` `visualCases()`),
 * clipped to the union of everything the scenario painted (overlays included —
 * they portal to `<body>`), at device scale 1, after `settleAnimations`, with
 * the clock pinned, `Math.random` seeded, the network closed and icons frozen
 * (`document-page.ts`). Each PATH has its own baselines: the two
 * implementations are never compared with each other — alignment between them
 * is gated by shared token/state invariants elsewhere, not by pixels.
 *
 * WHERE baselines are valid: a rendering is only reproducible on the browser
 * build and platform that produced it (font rasterisation, Skia CPU paths), so
 * the manifest records the ENVIRONMENT it was captured in and a run compares
 * only in that environment. CI's `verify` job runs inside
 * `mcr.microsoft.com/playwright:<version>-noble`; `pnpm gallery:visual:update`
 * captures in that same image (`scripts/run-visual-container.mjs`).
 *
 * HOW a run behaves:
 *   - matching environment      → compare every case against its baseline;
 *   - other environment, local  → check DETERMINISM instead (capture twice,
 *                                 require identical pixels) and say so;
 *   - other environment, CI     → FAIL (`LLUI_VISUAL_REQUIRED=1`): a gate
 *                                 that silently compares nothing is not one.
 *                                 Each case is still rendered twice (and must
 *                                 be deterministic) and written, with a
 *                                 manifest, to `<output>/visual-baselines/`:
 *                                 a complete candidate set recorded in CI's
 *                                 own environment, uploaded as an artifact.
 *                                 In CI a comparing run writes that set too.
 *   - `LLUI_VISUAL_UPDATE=1`    → capture each case twice, refuse to record a
 *                                 non-deterministic one, write the baseline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Page } from 'playwright'

export const GALLERY_DIR = resolve(import.meta.dirname, '../..')
export const REPO_ROOT = resolve(GALLERY_DIR, '../..')
export const BASELINE_DIR = resolve(GALLERY_DIR, 'test/visual-baselines')
export const MANIFEST_PATH = resolve(BASELINE_DIR, 'manifest.json')

/** Relative values resolve against the REPO ROOT, like `LLUI_TEST_DURATIONS`. */
export function visualOutputDir(): string {
  return resolve(REPO_ROOT, process.env['LLUI_VISUAL_OUTPUT'] ?? '.visual-output')
}

export interface VisualEnvironment {
  readonly browser: string
  readonly platform: string
  readonly arch: string
}

export interface VisualManifest {
  readonly version: 1
  readonly environment: VisualEnvironment
  /** Keyed by `caseKey()`; the PNG lives at `<key>.png` beside this file. */
  readonly cases: Readonly<Record<string, { readonly width: number; readonly height: number }>>
}

/**
 * Pixel tolerance. A channel delta of up to `CHANNEL` (of 255) is rasteriser
 * noise, not a change; a case fails when more than `PIXELS` pixels (or
 * `RATIO` of its area, whichever is larger) exceed it. Within one environment
 * the renderings measured bit-identical (the determinism check below is
 * exactly that measurement, run on every local pass); the allowance is for
 * CPU-dispatched Skia paths across CI hosts of the same image, which differ
 * at anti-aliased EDGES (bounded by the pixel count), not across surfaces.
 * `CHANNEL` must stay small: dark tokens sit where sRGB is compressed, and
 * moving `--primary` from `oklch(0.205 0 0)` to `oklch(0.305 0 0)` — an
 * obvious change — shifts every pixel of a primary button by only ~23/255.
 * A channel allowance of 24 let that mutant pass the `button` cases (#268
 * mutation table); 3 catches it.
 */
export const TOLERANCE = { CHANNEL: 3, PIXELS: 12, RATIO: 0.0005 } as const

export function readManifest(): VisualManifest | undefined {
  if (!existsSync(MANIFEST_PATH)) return undefined
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  return parsed as VisualManifest
}

export function sameEnvironment(a: VisualEnvironment, b: VisualEnvironment): boolean {
  return a.browser === b.browser && a.platform === b.platform && a.arch === b.arch
}

export function describeEnvironment(environment: VisualEnvironment): string {
  return `chromium ${environment.browser} on ${environment.platform}/${environment.arch}`
}

export function baselinePath(key: string): string {
  return resolve(BASELINE_DIR, `${key}.png`)
}

export function writeFileEnsuringDir(path: string, data: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

/**
 * Screenshot everything the scenario painted: the union of every rendered
 * box under `<body>` (portaled overlays included), padded, inside the
 * viewport. Deterministic because the layout is.
 */
export async function captureCase(page: Page): Promise<Buffer> {
  const clip = await page.evaluate(() => {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    // The scenario's own content plus anything portaled outside the
    // document root (overlays) — never the layout containers themselves,
    // which span the viewport and would make every capture full-width.
    const host = document.getElementById('gallery-scenario')
    const root = document.getElementById('gallery-document')
    const painted = [
      ...Array.from(host?.querySelectorAll('*') ?? []),
      ...Array.from(document.body.querySelectorAll('*')).filter(
        (element) => root === null || !root.contains(element),
      ),
    ]
    for (const element of painted) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.right)
      bottom = Math.max(bottom, rect.bottom)
    }
    const pad = 8
    const x = Math.max(0, Math.floor(left - pad))
    const y = Math.max(0, Math.floor(top - pad))
    const width = Math.min(window.innerWidth, Math.ceil(right + pad)) - x
    const height = Math.min(window.innerHeight, Math.ceil(bottom + pad)) - y
    return width > 0 && height > 0
      ? { x, y, width, height }
      : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  })
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' })
}

/**
 * `captureCase` until two CONSECUTIVE captures are byte-identical (the rule
 * Playwright's own `toHaveScreenshot` uses). `settleAnimations` can only
 * finish Web Animations; a JS-driven motion — the disclosure family's
 * measured block-size interpolation runs on `requestAnimationFrame` — is
 * invisible to `document.getAnimations()`, and captured mid-flight it made two
 * renders of an accordion's `closing` case differ. Converges to the resting
 * state; a case that never rests fails loudly instead of being recorded.
 */
export async function captureStable(page: Page, attempts = 20): Promise<Buffer> {
  let previous = await captureCase(page)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(() => resolve(), 50)),
        ),
    )
    const next = await captureCase(page)
    if (next.equals(previous)) return next
    previous = next
  }
  throw new Error(`the rendering never came to rest (${attempts} consecutive captures differed)`)
}

export interface PixelComparison {
  readonly width: number
  readonly height: number
  readonly sameSize: boolean
  readonly differing: number
  /** A PNG highlighting differing pixels in red over a faded actual. */
  readonly diffPng: Buffer | undefined
}

/**
 * Decode both PNGs with the BROWSER (lossless, no image dependency in the
 * repo) and count pixels whose largest channel delta exceeds the tolerance.
 */
export async function comparePngs(
  page: Page,
  actual: Buffer,
  expected: Buffer,
): Promise<PixelComparison> {
  const result = await page.evaluate(
    async ({ actual, expected, channel }) => {
      const load = (base64: string): Promise<HTMLImageElement> =>
        new Promise((done, fail) => {
          const image = new Image()
          image.onload = () => done(image)
          image.onerror = () => fail(new Error('PNG failed to decode'))
          image.src = `data:image/png;base64,${base64}`
        })
      const [a, b] = await Promise.all([load(actual), load(expected)])
      const width = a.naturalWidth
      const height = a.naturalHeight
      const sameSize = width === b.naturalWidth && height === b.naturalHeight
      if (!sameSize) return { width, height, sameSize, differing: -1, diff: null }
      const pixels = (image: HTMLImageElement): Uint8ClampedArray => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, width, height).data
      }
      const pa = pixels(a)
      const pb = pixels(b)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      const out = context.createImageData(width, height)
      let differing = 0
      for (let index = 0; index < pa.length; index += 4) {
        let delta = 0
        for (let c = 0; c < 4; c += 1) {
          delta = Math.max(delta, Math.abs(pa[index + c]! - pb[index + c]!))
        }
        if (delta > channel) {
          differing += 1
          out.data.set([255, 0, 0, 255], index)
        } else {
          const grey = (pa[index]! + pa[index + 1]! + pa[index + 2]!) / 3
          const faded = 255 - (255 - grey) * 0.25
          out.data.set([faded, faded, faded, 255], index)
        }
      }
      context.putImageData(out, 0, 0)
      const diff = differing > 0 ? canvas.toDataURL('image/png').split(',')[1]! : null
      return { width, height, sameSize, differing, diff }
    },
    {
      actual: actual.toString('base64'),
      expected: expected.toString('base64'),
      channel: TOLERANCE.CHANNEL,
    },
  )
  return {
    width: result.width,
    height: result.height,
    sameSize: result.sameSize,
    differing: result.differing,
    diffPng: result.diff === null ? undefined : Buffer.from(result.diff, 'base64'),
  }
}

export function withinTolerance(comparison: PixelComparison): boolean {
  if (!comparison.sameSize) return false
  const allowed = Math.max(
    TOLERANCE.PIXELS,
    Math.floor(comparison.width * comparison.height * TOLERANCE.RATIO),
  )
  return comparison.differing <= allowed
}
