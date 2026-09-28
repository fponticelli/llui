/**
 * Open gallery path documents for gate cases, deterministically, recording
 * every runtime fault the gates fail on (#268):
 *
 *   - console errors and uncaught page exceptions;
 *   - failed requests and HTTP error responses;
 *   - ANY request leaving the gallery origin — it is aborted (a scenario must
 *     render with no network) and recorded as a fault, so a renderer that
 *     starts fetching (an icon CDN, a font) fails loudly instead of rendering
 *     a blank box that a screenshot would then bake in;
 *   - the document's own status (`data-gallery-status` must reach `ready`).
 *
 * Determinism: `Date` is pinned (`clock.setFixedTime` — timers still run, so
 * the document's own `setTimeout` settle is untouched), `Math.random` is a
 * seeded PRNG, the OS preferences the environment axes stand for are
 * emulated (color scheme, reduced motion, forced colors, window width) in
 * addition to the attributes the document sets, and every FINITE animation
 * or transition is run to its end state before anything is measured
 * (`settleAnimations`) — a `closing` case measured mid-fade reports whatever
 * contrast the fade happened to be at, which is timing, not a finding.
 *
 * Pages are POOLED: one context + page per concurrent slot, re-emulated per
 * case. A fresh context per case measured ~2.3x the wall time of the whole
 * audit (201 s vs ~88 s for 972 cases at concurrency 4), for isolation the
 * navigation already provides: every case is a full page load of its own
 * document, and the slot's fault sink is reset in between.
 */
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright'
import type { GalleryCase } from './matrix'
import { documentHref } from './matrix'

/** 2026-01-15T12:00:00Z — a fixed instant for every scenario's `Date`. */
export const FIXED_TIME = Date.UTC(2026, 0, 15, 12, 0, 0)

export const WINDOW = {
  wide: { width: 1280, height: 800 },
  narrow: { width: 390, height: 844 },
} as const

/**
 * The context every gate page renders in. The rendering fingerprint
 * (`fingerprint.ts`) is measured in a context with exactly these options, so
 * it identifies the rendering the cases are captured with.
 */
export const GATE_CONTEXT_OPTIONS = {
  viewport: WINDOW.wide,
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
} as const satisfies BrowserContextOptions

export interface RuntimeFaults {
  console: string[]
  exceptions: string[]
  requests: string[]
  external: string[]
}

const emptyFaults = (): RuntimeFaults => ({
  console: [],
  exceptions: [],
  requests: [],
  external: [],
})

export function faultLines(faults: RuntimeFaults): string[] {
  return [
    ...faults.console.map((line) => `console.error: ${line}`),
    ...faults.exceptions.map((line) => `uncaught exception: ${line}`),
    ...faults.requests.map((line) => `failed resource: ${line}`),
    ...faults.external.map((line) => `network request left the gallery origin: ${line}`),
  ]
}

/** mulberry32, seeded — installed before any page script runs. */
const SEEDED_RANDOM = `(() => {
  let seed = 0x2680268
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()`

interface Slot {
  readonly context: BrowserContext
  readonly page: Page
  faults: RuntimeFaults
}

/** Instrument one context: route, clock, PRNG, and the fault listeners. */
export async function instrument(
  context: BrowserContext,
  origin: string,
  sink: () => RuntimeFaults,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue()
      return
    }
    sink().external.push(`${route.request().method()} ${url.href}`)
    await route.abort('blockedbyclient')
  })
  await context.addInitScript(SEEDED_RANDOM)
  await context.clock.setFixedTime(FIXED_TIME)
  context.on('console', (message) => {
    if (message.type() !== 'error') return
    const { url, lineNumber } = message.location()
    const where = url === '' ? '' : ` (${url.replace(origin, '')}:${lineNumber})`
    sink().console.push(`${message.text()}${where}`)
  })
  context.on('weberror', (error) => sink().exceptions.push(error.error().message))
  context.on('requestfailed', (request) => {
    const url = new URL(request.url())
    // An aborted off-origin request is already recorded as `external`.
    if (url.origin !== origin) return
    const reason = request.failure()?.errorText ?? 'failed'
    sink().requests.push(`${request.method()} ${url.pathname}${url.search}: ${reason}`)
  })
  context.on('response', (response) => {
    if (response.status() < 400) return
    const url = new URL(response.url())
    sink().requests.push(`${response.status()} ${url.pathname}${url.search}`)
  })
}

/** Emulate the OS preferences a case's environment stands for. */
async function emulate(page: Page, galleryCase: Pick<GalleryCase, 'environment'>): Promise<void> {
  const { environment } = galleryCase
  await page.setViewportSize(WINDOW[environment.viewport])
  await page.emulateMedia({
    colorScheme: environment.theme,
    reducedMotion: environment.motion === 'reduced' ? 'reduce' : 'no-preference',
    forcedColors: environment.forcedColors === 'active' ? 'active' : 'none',
  })
}

/**
 * Run every finite animation and transition to its end state, repeatedly —
 * finishing one can start another (an exit ends, the part unmounts, a
 * sibling transitions) — and cancel infinite ones (spinners, skeleton
 * pulses) back to their base style. Deterministic regardless of how long the
 * page happened to take to get here.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Animations and transitions are created at the next style/animation
    // frame after a commit: wait two frames first, or a `closing` case is
    // measured before its exit has even started (seen as a capture whose
    // SIZE differed between two renders of the same case).
    const frame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()))
    await frame()
    await frame()
    for (let round = 0; round < 20; round += 1) {
      const running = document
        .getAnimations()
        .filter((animation) => animation.playState !== 'finished' && animation.playState !== 'idle')
      if (running.length === 0) break
      for (const animation of running) {
        const iterations = animation.effect?.getComputedTiming().iterations ?? 1
        if (iterations === Infinity) animation.cancel()
        else animation.finish()
      }
      // Let end events dispatch, any resulting commit land, and any
      // animation it starts be created before the next round looks.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await frame()
    }
  })
}

export interface OpenedDocument {
  readonly page: Page
  readonly status: string
  readonly error: string | null
  /** Every fault recorded since this case began, one line each. */
  faultLines(): string[]
}

const SETTLED = 'html[data-gallery-status="ready"], html[data-gallery-status="error"]'

export class DocumentPool {
  readonly #browser: Browser
  readonly #base: string
  readonly #size: number
  readonly #free: Slot[] = []
  readonly #waiting: ((slot: Slot) => void)[] = []
  readonly #all: Slot[] = []

  constructor(browser: Browser, base: string, size: number) {
    this.#browser = browser
    this.#base = base
    this.#size = size
  }

  async #acquire(): Promise<Slot> {
    const free = this.#free.pop()
    if (free !== undefined) return free
    if (this.#all.length < this.#size) {
      const context = await this.#browser.newContext(GATE_CONTEXT_OPTIONS)
      const slot: Slot = { context, page: await context.newPage(), faults: emptyFaults() }
      await instrument(context, new URL(this.#base).origin, () => slot.faults)
      this.#all.push(slot)
      return slot
    }
    return new Promise((resolve) => this.#waiting.push(resolve))
  }

  #release(slot: Slot): void {
    const next = this.#waiting.shift()
    if (next !== undefined) next(slot)
    else this.#free.push(slot)
  }

  /**
   * Open a case's document in a pooled page, settle it, hand it to `use`,
   * and release the page — whatever `use` does.
   */
  async with<T>(galleryCase: GalleryCase, use: (opened: OpenedDocument) => Promise<T>): Promise<T> {
    return this.withHref(documentHref(galleryCase), galleryCase, use)
  }

  /** `with`, for a document URL that is not a rendered case (e.g. a refusal). */
  async withHref<T>(
    href: string,
    galleryCase: Pick<GalleryCase, 'environment'>,
    use: (opened: OpenedDocument) => Promise<T>,
    { shell }: { shell?: { readonly frames: number } } = {},
  ): Promise<T> {
    const slot = await this.#acquire()
    try {
      // Leave the previous document first, so its teardown cannot report
      // into this case's sink.
      await slot.page.goto('about:blank')
      slot.faults = emptyFaults()
      await emulate(slot.page, galleryCase)
      await slot.page.goto(new URL(href, this.#base).href)
      if (shell !== undefined) {
        // The shell reports no status of its own: it is settled once it has
        // rendered its main landmark, framed the documents the caller expects,
        // and every one of those has settled.
        await slot.page.waitForSelector('#gallery-main', { state: 'attached' })
        await slot.page.waitForFunction(
          (count) => document.querySelectorAll('iframe').length === count,
          shell.frames,
        )
        for (const handle of await slot.page.$$('iframe')) {
          const frame = await handle.contentFrame()
          if (frame === null) throw new Error(`${href}: a framed document did not load`)
          await frame.waitForSelector(SETTLED, { state: 'attached' })
        }
      } else {
        await slot.page.waitForSelector(SETTLED, { state: 'attached' })
      }
      await settleAnimations(slot.page)
      const [status, error] = await slot.page.evaluate(() => [
        document.documentElement.getAttribute('data-gallery-status') ?? '',
        document.documentElement.getAttribute('data-gallery-error'),
      ])
      const faults = slot.faults
      return await use({
        page: slot.page,
        status: status ?? '',
        error: error ?? null,
        faultLines: () => faultLines(faults),
      })
    } finally {
      this.#release(slot)
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.#all.map(({ context }) => context.close()))
  }
}
