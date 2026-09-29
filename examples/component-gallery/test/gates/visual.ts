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
 * WHERE baselines are valid: a rendering is only reproducible where the
 * rendering is — the browser build, platform and architecture that produced
 * it AND the same fonts and rasteriser. The first three are names; the last
 * two are not (CI's exact Chromium build on linux/x64 with other system
 * fonts drew ~937 cases at other sizes and pixels), so the manifest records
 * the ENVIRONMENT it was captured in together with a RENDERING FINGERPRINT
 * (`fingerprint.ts`: a calibration document in the documents' own font
 * stacks and a shape sample, captured in the gate's context and hashed), and
 * a run compares only when every component matches
 * (`environmentDifferences`, `decideVisualMode`). CI's `verify` job runs
 * inside `mcr.microsoft.com/playwright:<version>-noble`;
 * `pnpm gallery:visual:update` captures in that same image
 * (`scripts/run-visual-container.mjs`).
 *
 * HOW a run behaves:
 *   - matching environment      → compare every case against its baseline;
 *   - other environment, local  → check DETERMINISM instead (capture twice,
 *                                 require identical pixels) and say so,
 *                                 naming what differs;
 *   - other environment, CI     → FAIL (`LLUI_VISUAL_REQUIRED=1`): a gate
 *                                 that silently compares nothing is not one.
 *                                 The message names each differing component
 *                                 (browser, fonts, raster, …). Each case is still rendered twice (and must
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

/**
 * Relative values resolve against the REPO ROOT, not the package cwd: CI sets a
 * relative value because its container mounts the workspace at a different
 * path than `github.workspace` names.
 */
export function visualOutputDir(): string {
  return resolve(REPO_ROOT, process.env['LLUI_VISUAL_OUTPUT'] ?? '.visual-output')
}

/** What one font stack draws in the calibration document (`fingerprint.ts`). */
export interface StackFingerprint {
  /** The platform fonts Chromium used for it, fallbacks included, sorted. */
  readonly fonts: readonly string[]
  /** SHA-256 of the captured pixels. */
  readonly pixels: string
}

/** What the environment DRAWS — `fingerprint.ts` has the calibration. */
export interface RenderingFingerprint {
  /** SHA-256 of the calibration document that was rendered. */
  readonly calibration: string
  /** Keyed by the computed `font-family` stack. */
  readonly stacks: Readonly<Record<string, StackFingerprint>>
  /** SHA-256 of the text-free shape sample. */
  readonly raster: string
}

export interface VisualEnvironment {
  readonly browser: string
  readonly platform: string
  readonly arch: string
  readonly rendering: RenderingFingerprint
}

export const MANIFEST_VERSION = 2

export interface VisualManifest {
  readonly version: typeof MANIFEST_VERSION
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
  return parseManifest(parsed)
}

const RE_RECORD =
  "run `pnpm gallery:visual:update` in CI's image or download the CI `visual-baselines` artifact"

class ManifestError extends Error {
  constructor(where: string, expected: string) {
    super(`visual manifest: ${where} is not ${expected} (${RE_RECORD})`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ManifestError(where, 'an object')
  return value
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new ManifestError(where, 'a string')
  return value
}

function count(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ManifestError(where, 'a non-negative integer')
  }
  return value
}

function texts(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new ManifestError(where, 'an array of strings')
  return value.map((item: unknown, index) => text(item, `${where}[${index}]`))
}

/** Validate a parsed manifest, naming the first malformed field. */
export function parseManifest(value: unknown): VisualManifest {
  const manifest = record(value, 'the manifest')
  if (manifest['version'] !== MANIFEST_VERSION) {
    throw new Error(
      `visual manifest version ${String(manifest['version'])} is not supported ` +
        `(expected ${MANIFEST_VERSION}, which records the rendering fingerprint): ${RE_RECORD}`,
    )
  }
  const environment = record(manifest['environment'], 'environment')
  const rendering = record(environment['rendering'], 'environment.rendering')
  const stacks: Record<string, StackFingerprint> = {}
  for (const [stack, entry] of Object.entries(
    record(rendering['stacks'], 'environment.rendering.stacks'),
  )) {
    const where = `environment.rendering.stacks[${JSON.stringify(stack)}]`
    const fingerprint = record(entry, where)
    stacks[stack] = {
      fonts: texts(fingerprint['fonts'], `${where}.fonts`),
      pixels: text(fingerprint['pixels'], `${where}.pixels`),
    }
  }
  const cases: Record<string, { width: number; height: number }> = {}
  for (const [key, entry] of Object.entries(record(manifest['cases'], 'cases'))) {
    const where = `cases[${JSON.stringify(key)}]`
    const size = record(entry, where)
    cases[key] = {
      width: count(size['width'], `${where}.width`),
      height: count(size['height'], `${where}.height`),
    }
  }
  return {
    version: MANIFEST_VERSION,
    environment: {
      browser: text(environment['browser'], 'environment.browser'),
      platform: text(environment['platform'], 'environment.platform'),
      arch: text(environment['arch'], 'environment.arch'),
      rendering: {
        calibration: text(rendering['calibration'], 'environment.rendering.calibration'),
        stacks,
        raster: text(rendering['raster'], 'environment.rendering.raster'),
      },
    },
    cases,
  }
}

/** The component of the environment a difference is in. */
export type EnvironmentComponent =
  | 'browser'
  | 'platform'
  | 'arch'
  | 'coverage'
  | 'calibration'
  | 'fonts'
  | 'text'
  | 'raster'

export interface EnvironmentDifference {
  readonly component: EnvironmentComponent
  readonly detail: string
}

/** The components that ARE the rendering fingerprint, not the environment's name. */
const FINGERPRINT_COMPONENTS: ReadonlySet<EnvironmentComponent> = new Set<EnvironmentComponent>([
  'coverage',
  'calibration',
  'fonts',
  'text',
  'raster',
])

/**
 * Every way `current` is not the environment that recorded the baselines;
 * empty means the baselines are reproducible here. `current.rendering` must
 * have been measured over the RECORDED stacks (the same calibration
 * document), so it compares like with like; `declaredStacks` are the stacks
 * the documents declare NOW, each of which the recording must have rendered.
 */
export function environmentDifferences(
  recorded: VisualEnvironment,
  current: VisualEnvironment,
  declaredStacks: readonly string[],
): EnvironmentDifference[] {
  const differences: EnvironmentDifference[] = []
  const identity = (component: 'browser' | 'platform' | 'arch', prefix: string): void => {
    if (recorded[component] === current[component]) return
    differences.push({
      component,
      detail: `${prefix}${current[component]} here, ${recorded[component]} when recorded`,
    })
  }
  identity('browser', 'chromium ')
  identity('platform', '')
  identity('arch', '')

  const unrecorded = declaredStacks.filter((stack) => !(stack in recorded.rendering.stacks))
  if (unrecorded.length > 0) {
    differences.push({
      component: 'coverage',
      detail: `the documents declare font stacks the fingerprint never rendered: ${unrecorded
        .map((stack) => JSON.stringify(stack))
        .join(', ')}`,
    })
  }
  if (recorded.rendering.calibration !== current.rendering.calibration) {
    // Different documents draw different pixels: nothing below is comparable.
    differences.push({
      component: 'calibration',
      detail: 'the calibration document changed since the fingerprint was recorded',
    })
    return differences
  }
  for (const [stack, was] of Object.entries(recorded.rendering.stacks)) {
    const now = current.rendering.stacks[stack]
    const quoted = JSON.stringify(stack)
    if (now === undefined) {
      differences.push({ component: 'fonts', detail: `${quoted} was not measured here` })
    } else if (now.fonts.join('\n') !== was.fonts.join('\n')) {
      differences.push({
        component: 'fonts',
        detail: `${quoted} resolves to ${now.fonts.join(', ')} here, ${was.fonts.join(', ')} when recorded`,
      })
    } else if (now.pixels !== was.pixels) {
      differences.push({
        component: 'text',
        detail: `${quoted} draws different pixels with the same fonts (hinting, antialiasing or font file version)`,
      })
    }
  }
  if (recorded.rendering.raster !== current.rendering.raster) {
    differences.push({
      component: 'raster',
      detail:
        'the shape calibration draws different pixels (Skia/GPU raster configuration differs)',
    })
  }
  return differences
}

export type VisualMode = 'update' | 'compare' | 'determinism' | 'unavailable'

export interface VisualModeInput {
  /** `LLUI_VISUAL_UPDATE=1`. */
  readonly update: boolean
  /** `LLUI_VISUAL_REQUIRED=1` (CI). */
  readonly required: boolean
  /** The committed manifest's environment, if there is one. */
  readonly recorded: VisualEnvironment | undefined
  /** This run's environment, fingerprinted over the RECORDED stacks. */
  readonly current: VisualEnvironment
  /** The font stacks the path documents declare now. */
  readonly declaredStacks: readonly string[]
}

/**
 * Compare only where the baselines are reproducible — the browser build,
 * platform, architecture AND the rendering fingerprint all match. Anywhere
 * else check determinism, unless the gate is required (CI), where being
 * unable to compare is a failure.
 */
export function decideVisualMode(input: VisualModeInput): {
  readonly mode: VisualMode
  readonly differences: readonly EnvironmentDifference[]
} {
  const differences =
    input.recorded === undefined
      ? []
      : environmentDifferences(input.recorded, input.current, input.declaredStacks)
  const mode: VisualMode = input.update
    ? 'update'
    : input.recorded !== undefined && differences.length === 0
      ? 'compare'
      : input.required
        ? 'unavailable'
        : 'determinism'
  return { mode, differences }
}

/**
 * One line naming WHICH components differ, with each detail and the fix. A
 * fingerprint-only mismatch is the case the fingerprint exists for: CI's
 * browser build on a host with other fonts.
 */
export function describeDifferences(differences: readonly EnvironmentDifference[]): string {
  const components = [...new Set(differences.map(({ component }) => component))]
  const headline = components.every((component) => FINGERPRINT_COMPONENTS.has(component))
    ? `rendering fingerprint differs (${components.join(', ')}): fonts/raster differ from the recording environment`
    : `recording environment differs (${components.join(', ')})`
  const details = differences.map(({ detail }) => detail).join('; ')
  return `${headline}: ${details} — ${RE_RECORD}`
}

export function describeEnvironment(
  environment: Pick<VisualEnvironment, 'browser' | 'platform' | 'arch'>,
): string {
  return `chromium ${environment.browser} on ${environment.platform}/${environment.arch}`
}

export function baselinePath(key: string): string {
  return resolve(BASELINE_DIR, `${key}.png`)
}

export function writeFileEnsuringDir(path: string, data: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

export interface PaintedClip {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The page region the scenario painted: the union of every rendered box under
 * the scenario host plus anything portaled outside the document root
 * (overlays), padded and kept inside the viewport. Never the layout
 * containers themselves, which span the viewport and would make every capture
 * full-width. Deterministic because the layout is.
 *
 * An element that is VISUALLY HIDDEN paints nothing and contributes nothing,
 * and neither does anything inside it: the screen-reader-only pattern
 * (`clip: rect(0 0 0 0)`, `clip-path: inset(50%)`, or a box of at most 1x1
 * that clips its overflow) is a 1px box pulled out by `margin: -1px`, and
 * counting it widened a sortable capture by one column of background once
 * the list gained a live region.
 *
 * Runs IN THE PAGE (`page.evaluate(paintedBounds)`), so it must stay
 * self-contained.
 */
export function paintedBounds(): PaintedClip {
  const hidden = new Map<Element, boolean>()
  const clipsEverything = (element: Element): boolean => {
    const style = getComputedStyle(element)
    if (style.clipPath === 'inset(50%)') return true
    const positioned = style.position === 'absolute' || style.position === 'fixed'
    if (positioned && style.clip === 'rect(0px, 0px, 0px, 0px)') return true
    if (style.overflowX === 'visible' || style.overflowY === 'visible') return false
    const rect = element.getBoundingClientRect()
    return rect.width <= 1 && rect.height <= 1
  }
  const visuallyHidden = (element: Element): boolean => {
    const known = hidden.get(element)
    if (known !== undefined) return known
    const parent = element.parentElement
    const result = clipsEverything(element) || (parent !== null && visuallyHidden(parent))
    hidden.set(element, result)
    return result
  }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
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
    if (visuallyHidden(element)) continue
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
}

/** Screenshot the region `paintedBounds` reports. */
export async function captureCase(page: Page): Promise<Buffer> {
  const clip = await page.evaluate(paintedBounds)
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
