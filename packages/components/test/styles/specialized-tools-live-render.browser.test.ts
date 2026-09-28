// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { loadProductContract } from './navigation-data-contract-source'

/**
 * The specialized-tools family, mounted LIVE through the real renderers in
 * real Chromium, on both styling paths (#266):
 *
 *  - baseline: `examples/baseline-css`, the one example with NO Tailwind, so
 *    the page is `theme.css` and nothing else;
 *  - registry: `examples/registry-demo`, the copied skins compiled by the
 *    app's real Tailwind v4 pipeline against `tokens.css`.
 *
 * Every claim below is measured on the renderer's own output — geometry,
 * computed paint, focus and keyboard — never on hand-written markup, and each
 * one is asked of BOTH paths, because a state one path shows and the other
 * hides is exactly the drift this ticket exists to remove.
 */

const repoRoot = resolve(import.meta.dirname, '../../../..')
const contract = loadProductContract()

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
  ...sourceAliasesFromExports({
    packageName: '@llui/cli',
    packageJsonPath: resolve(repoRoot, 'packages/cli/package.json'),
    srcDir: resolve(repoRoot, 'packages/cli/src'),
  }),
  { find: '@/lib', replacement: resolve(repoRoot, 'registry/llui/lib') },
  { find: '@/ui', replacement: resolve(repoRoot, 'registry/llui/ui') },
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

type Path = 'baseline' | 'registryTailwind'
type Environment = Partial<
  Record<'theme' | 'direction' | 'motion' | 'viewport' | 'forcedColors', string>
>

interface Fixture {
  readonly path: Path
  readonly url: string
  readonly mountFn: '__mountSpecializedToolsBaseline' | '__mountSpecializedToolsRegistry'
}

declare global {
  interface Window {
    __mountSpecializedToolsBaseline?: (contract: unknown, environment?: Environment) => void
    __mountSpecializedToolsRegistry?: (contract: unknown, environment?: Environment) => void
  }
}

const PATHS = ['baseline', 'registryTailwind'] as const

describe('specialized-tools live render, both styling paths, real Chromium (#266)', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  let fixtures: Fixture[] = []

  beforeAll(async () => {
    const [baseline, registry] = await Promise.all([
      startExample('examples/baseline-css'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registry.server]
    fixtures = [
      {
        path: 'baseline',
        url: `${baseline.url}src/test-fixtures/specialized-tools-live-render.html`,
        mountFn: '__mountSpecializedToolsBaseline',
      },
      {
        path: 'registryTailwind',
        url: `${registry.url}src/test-fixtures/specialized-tools-live-render.html`,
        mountFn: '__mountSpecializedToolsRegistry',
      },
    ]
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  async function open(
    path: Path,
    options: {
      environment?: Environment
      viewport?: { width: number; height: number }
      forcedColors?: 'active' | 'none'
      reducedMotion?: 'reduce' | 'no-preference'
    } = {},
  ): Promise<Page> {
    const fixture = fixtures.find((candidate) => candidate.path === path)!
    const page = await browser.newPage({
      viewport: options.viewport ?? { width: 1280, height: 900 },
    })
    await page.emulateMedia({
      forcedColors: options.forcedColors ?? 'none',
      reducedMotion: options.reducedMotion ?? 'no-preference',
      colorScheme: 'light',
    })
    // A module that fails to compile (a framework lint finding is a build
    // ERROR, served as a 500) leaves the mount function undefined forever.
    // Fail fast and name the module instead of timing out every case.
    const loadFailures: string[] = []
    page.on('pageerror', (error) => loadFailures.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400) loadFailures.push(`${response.status()} ${response.url()}`)
    })
    await page.goto(fixture.url)
    await page
      .waitForFunction((fn) => typeof window[fn] === 'function', fixture.mountFn, {
        timeout: 15_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${fixture.mountFn} never loaded: ${loadFailures.join('; ') || String(error)}`,
        )
      })
    await page.evaluate(
      ({ fn, contract, environment }) => {
        const mount = window[fn]
        if (mount === undefined) throw new Error(`Missing window.${fn}`)
        mount(contract, environment)
      },
      { fn: fixture.mountFn, contract, environment: options.environment },
    )
    await page
      .locator('[data-scenario-id="component:qr-code"][data-scenario-case="code"]')
      .waitFor({ state: 'attached' })
    // Measure the cascade, not a transition caught mid-flight.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important }' })
    return page
  }

  const box = (page: Page, product: string, caseId: string, selector: string) =>
    page.evaluate(
      ({ product, caseId, selector }) => {
        const host = document.querySelector(
          `[data-scenario-product="${product}"][data-scenario-case="${caseId}"]`,
        )
        const element = host?.querySelector<HTMLElement>(selector)
        if (host === null || host === undefined || element === null || element === undefined) {
          throw new Error(`Missing ${selector} in ${product}/${caseId}`)
        }
        const rect = element.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        return {
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        }
      },
      { product, caseId, selector },
    )

  it.each(PATHS)(
    '%s renders every complex product with real, non-collapsed chrome',
    async (path) => {
      const page = await open(path)
      const probes: [string, string, string][] = [
        ['date-picker', 'single', '[data-part="day-cell"][data-today]'],
        ['date-picker', 'single', '[data-part="prev-month-trigger"]'],
        ['qr-code', 'code', '[data-part="svg"]'],
        ['scroll-area', 'vertical', '[data-part="thumb"][data-axis="y"]'],
        ['signature-pad', 'signed', '[data-part="control"]'],
        ['image-cropper', 'free', '[data-part="crop-box"]'],
        ['image-cropper', 'free', '[data-part="resize-handle"][data-handle="se"]'],
        ['splitter', 'horizontal', '[data-part="resize-trigger"]'],
        ['file-upload', 'empty', '[data-part="dropzone"]'],
        [
          'file-upload',
          'uploading',
          '[data-upload-status="uploading"] [data-part="item-progress-range"]',
        ],
        ['time-picker', 'twelve-hour', '[data-part="root"]'],
        ['floating-panel', 'open', '[data-part="drag-handle"]'],
        ['tour', 'first-step', '[data-part="root"]'],
        ['sortable', 'idle', '[data-part="item"]'],
        ['clipboard', 'idle', '[data-part="trigger"]'],
        ['timer', 'paused', '[data-part="display"]'],
        ['async-list', 'error', '[data-part="retry-trigger"]'],
        ['cascade-select', 'partial', '[data-part="level-select"]'],
        ['date-input', 'valid', '[data-part="input"]'],
        ['editable', 'preview', '[data-part="preview"]'],
      ]
      const collapsed: string[] = []
      for (const [product, caseId, selector] of probes) {
        const rect = await box(page, product, caseId, selector)
        if (rect.width < 1 || rect.height < 1) {
          collapsed.push(`${product}/${caseId} ${selector}: ${rect.width}x${rect.height}`)
        }
      }
      // Real chrome, not browser defaults: the date-picker cell is the
      // shared 2rem cell size, the dropzone a padded block.
      const cell = await box(page, 'date-picker', 'single', '[data-part="day-cell"][data-today]')
      const compact = await box(
        page,
        'date-picker',
        'compact',
        '[data-part="day-cell"][data-today]',
      )
      await page.close()
      expect(collapsed).toEqual([])
      expect(cell.height).toBeCloseTo(32, 0)
      expect(compact.height).toBeCloseTo(28, 0)
    },
  )

  it.each(PATHS)(
    '%s scroll area: no native scrollbar, a real thumb, and the machine policy honoured',
    async (path) => {
      const page = await open(path)
      const result = await page.evaluate(() => {
        const at = (caseId: string, selector: string) =>
          document.querySelector<HTMLElement>(
            `[data-scenario-product="scroll-area"][data-scenario-case="${caseId}"] ${selector}`,
          )!
        const viewport = at('vertical', '[data-part="viewport"]')
        const bar = at('vertical', '[data-part="scrollbar"][data-axis="y"]')
        const thumb = at('vertical', '[data-part="thumb"][data-axis="y"]')
        const fitsBar = at('fits', '[data-part="scrollbar"][data-axis="y"]')
        return {
          nativeScrollbar: viewport.offsetWidth - viewport.clientWidth,
          barVisible: bar.hasAttribute('data-visible'),
          barOpacity: getComputedStyle(bar).opacity,
          thumb: thumb.getBoundingClientRect().height,
          track: bar.getBoundingClientRect().height,
          fitsVisible: fitsBar.hasAttribute('data-visible'),
          fitsOpacity: getComputedStyle(fitsBar).opacity,
        }
      })
      await page.close()
      expect(result.nativeScrollbar).toBe(0)
      expect(result.barVisible).toBe(true)
      expect(result.barOpacity).toBe('1')
      expect(result.thumb).toBeGreaterThan(4)
      expect(result.thumb).toBeLessThan(result.track)
      expect(result.fitsVisible).toBe(false)
      expect(result.fitsOpacity).toBe('0')
    },
  )

  it.each(PATHS)(
    '%s keeps a QR code scannable in dark mode: a white plate and black modules',
    async (path) => {
      const page = await open(path, { environment: { theme: 'dark' } })
      const paint = await page.evaluate(() => {
        const host = document.querySelector(
          '[data-scenario-product="qr-code"][data-scenario-case="code"]',
        )!
        const surface = document.querySelector(
          '[data-scenario-product="date-picker"][data-scenario-case="single"] [data-part="day-cell"][data-today]',
        )!
        return {
          theme: host.getAttribute('data-theme'),
          plate: getComputedStyle(host.querySelector('[data-part="svg"]')!).backgroundColor,
          modules: getComputedStyle(host.querySelector('[data-part="foreground"]')!).fill,
          todayInDark: getComputedStyle(surface).backgroundColor,
        }
      })
      const light = await open(path)
      const todayInLight = await light.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(
              '[data-scenario-product="date-picker"][data-scenario-case="single"] [data-part="day-cell"][data-today]',
            )!,
          ).backgroundColor,
      )
      await page.close()
      await light.close()
      expect(paint.theme).toBe('dark')
      expect(paint.plate).toBe('rgb(255, 255, 255)')
      expect(paint.modules).toBe('rgb(0, 0, 0)')
      // The rest of the family DOES follow the theme.
      expect(paint.todayInDark).not.toBe(todayInLight)
    },
  )

  it.each(PATHS)(
    '%s mirrors text-adjacent chrome under RTL and keeps canvas geometry physical',
    async (path) => {
      const ltr = await open(path)
      const rtl = await open(path, { environment: { direction: 'rtl' } })
      const measure = async (page: Page) => ({
        clipboardTrigger: await box(page, 'clipboard', 'idle', '[data-part="trigger"]'),
        clipboardInput: await box(page, 'clipboard', 'idle', '[data-part="input"]'),
        dateClear: await box(page, 'date-input', 'valid', '[data-part="clear-trigger"]'),
        dateInput: await box(page, 'date-input', 'valid', '[data-part="input"]'),
        cropBox: await box(page, 'image-cropper', 'free', '[data-part="crop-box"]'),
        cropRoot: await box(page, 'image-cropper', 'free', '[data-part="root"]'),
        primary: await box(page, 'splitter', 'horizontal', '[data-part="primary-panel"]'),
        secondary: await box(page, 'splitter', 'horizontal', '[data-part="secondary-panel"]'),
        tourClose: await box(page, 'tour', 'first-step', '[data-part="close-trigger"]'),
        tourCard: await box(page, 'tour', 'first-step', '[data-part="root"]'),
        scrollBar: await box(
          page,
          'scroll-area',
          'vertical',
          '[data-part="scrollbar"][data-axis="y"]',
        ),
        scrollRoot: await box(page, 'scroll-area', 'vertical', '[data-part="root"]'),
      })
      const l = await measure(ltr)
      const r = await measure(rtl)
      await ltr.close()
      await rtl.close()
      // LTR: end-side chrome on the right.
      expect(l.clipboardTrigger.left).toBeGreaterThan(
        l.clipboardInput.left + l.clipboardInput.width / 2,
      )
      expect(l.dateClear.left).toBeGreaterThan(l.dateInput.left + l.dateInput.width / 2)
      expect(l.primary.left).toBeLessThan(l.secondary.left)
      // RTL: the same chrome moves to the left edge.
      expect(r.clipboardTrigger.left).toBeLessThan(
        r.clipboardInput.left + r.clipboardInput.width / 2,
      )
      expect(r.dateClear.left).toBeLessThan(r.dateInput.left + r.dateInput.width / 2)
      expect(r.primary.left).toBeGreaterThan(r.secondary.left)
      expect(r.tourClose.left).toBeLessThan(r.tourCard.left + r.tourCard.width / 2)
      expect(l.tourClose.left).toBeGreaterThan(l.tourCard.left + l.tourCard.width / 2)
      expect(r.scrollBar.left).toBeLessThan(r.scrollRoot.left + r.scrollRoot.width / 2)
      expect(l.scrollBar.left).toBeGreaterThan(l.scrollRoot.left + l.scrollRoot.width / 2)
      // The crop box is image geometry: identical offset inside its frame.
      expect(r.cropBox.left - r.cropRoot.left).toBeCloseTo(l.cropBox.left - l.cropRoot.left, 0)
      expect(r.cropBox.top - r.cropRoot.top).toBeCloseTo(l.cropBox.top - l.cropRoot.top, 0)
    },
  )

  it.each(PATHS)(
    '%s gives the new keyboard paths real effect (focus via the element, keys via the keyboard)',
    async (path) => {
      const page = await open(path)
      const focusIn = (product: string, caseId: string, selector: string) =>
        page.evaluate(
          ({ product, caseId, selector }) => {
            const element = document.querySelector<HTMLElement>(
              `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
            )
            if (element === null) throw new Error(`Missing ${selector}`)
            // The raw element focus, never Playwright's page.focus().
            element.focus()
            return document.activeElement === element
          },
          { product, caseId, selector },
        )
      const attr = (product: string, caseId: string, selector: string, name: string) =>
        page.evaluate(
          ({ product, caseId, selector, name }) =>
            document
              .querySelector(
                `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
              )
              ?.getAttribute(name) ?? null,
          { product, caseId, selector, name },
        )

      expect(await focusIn('image-cropper', 'free', '[data-part="crop-box"]')).toBe(true)
      const cropBefore = await attr('image-cropper', 'free', '[data-part="crop-box"]', 'aria-label')
      await page.keyboard.press('ArrowRight')
      const cropAfter = await attr('image-cropper', 'free', '[data-part="crop-box"]', 'aria-label')

      expect(await focusIn('floating-panel', 'open', '[data-part="drag-handle"]')).toBe(true)
      const panelBefore = await attr('floating-panel', 'open', '[data-part="root"]', 'style')
      await page.keyboard.press('ArrowDown')
      const panelAfter = await attr('floating-panel', 'open', '[data-part="root"]', 'style')

      expect(await focusIn('date-picker', 'single', '[data-part="day-cell"][tabindex="0"]')).toBe(
        true,
      )
      await page.keyboard.press('PageDown')
      const rovingStop = await attr(
        'date-picker',
        'single',
        '[data-part="day-cell"][tabindex="0"]',
        'data-date',
      )

      expect(await focusIn('sortable', 'idle', '[data-part="handle"]')).toBe(true)
      await page.keyboard.press('Space')
      const grabbed = await attr('sortable', 'idle', '[data-part="handle"]', 'aria-pressed')
      await page.close()

      expect(cropBefore).toBe('Crop area: 240 × 180 at 60, 45')
      expect(cropAfter).toBe('Crop area: 240 × 180 at 64, 45')
      expect(panelBefore).toContain('top:16px')
      expect(panelAfter).toContain('top:26px')
      // PageDown moved the ROVING focus into the new month, so the new grid
      // still has its one tab stop (the #266 bug left it in the old month).
      expect(rovingStop).toBe('2026-04-18')
      expect(grabbed).toBe('true')
    },
  )

  it.each(PATHS)(
    '%s keeps a non-colour or system-colour cue for every state under forced colors',
    async (path) => {
      const page = await open(path, { forcedColors: 'active' })
      const result = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.background = 'Highlight'
        document.body.append(probe)
        const highlight = getComputedStyle(probe).backgroundColor
        probe.remove()
        const q = (product: string, caseId: string, selector: string) =>
          document.querySelector<HTMLElement>(
            `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
          )!
        // The baseline paints the cell; the registry, like upstream, paints the
        // day BUTTON inside it. Read whichever element carries the fill.
        const selectedCell = q('date-picker', 'single', '[data-part="day-cell"][data-selected]')
        const selected = selectedCell.querySelector<HTMLElement>('button') ?? selectedCell
        const today = q('date-picker', 'single', '[data-part="day-cell"][data-today]')
        const middleCell = q(
          'date-picker',
          'range',
          '[data-part="day-cell"][data-in-range]:not([data-range-start]):not([data-range-end])',
        )
        const rangeMiddle = middleCell.querySelector<HTMLElement>('button') ?? middleCell
        return {
          highlight,
          selected: getComputedStyle(selected).backgroundColor,
          todayOutline: getComputedStyle(today).outlineStyle,
          rangeMiddleOutline: getComputedStyle(rangeMiddle).outlineStyle,
          cropOutline: getComputedStyle(q('image-cropper', 'free', '[data-part="crop-box"]'))
            .outlineStyle,
          qrPlate: getComputedStyle(q('qr-code', 'code', '[data-part="svg"]')).backgroundColor,
          thumb: getComputedStyle(
            q('scroll-area', 'vertical', '[data-part="thumb"][data-axis="y"]'),
          ).backgroundColor,
          completeOutline: getComputedStyle(q('timer', 'complete', '[data-part="display"]'))
            .outlineStyle,
        }
      })
      await page.close()
      expect(result.selected).toBe(result.highlight)
      expect(result.cropOutline).toBe('solid')
      expect(result.qrPlate).toBe('rgb(255, 255, 255)')
      expect(result.thumb).not.toBe('rgba(0, 0, 0, 0)')
      expect(result.completeOutline).toBe('solid')
      expect(result.todayOutline).toBe('solid')
      expect(result.rangeMiddleOutline).toBe('solid')
    },
  )

  it.each(PATHS)('%s quiets motion under prefers-reduced-motion', async (path) => {
    const page = await open(path, { reducedMotion: 'reduce' })
    // Re-read WITHOUT the transition kill-switch this helper installs.
    const durations = await page.evaluate(() => {
      for (const style of document.querySelectorAll('style')) {
        if (style.textContent?.includes('transition: none !important')) style.remove()
      }
      const q = (product: string, caseId: string, selector: string) =>
        document.querySelector<HTMLElement>(
          `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
        )!
      const seconds = (element: HTMLElement): number => {
        const style = getComputedStyle(element)
        if (style.transitionProperty === 'none') return 0
        return Math.max(...style.transitionDuration.split(',').map((d) => Number.parseFloat(d)))
      }
      return {
        sortable: seconds(q('sortable', 'dragging', '[data-part="item"][data-shift]')),
        progress: seconds(
          q(
            'file-upload',
            'uploading',
            '[data-upload-status="uploading"] [data-part="item-progress-range"]',
          ),
        ),
      }
    })
    await page.close()
    expect(durations.sortable).toBeLessThan(0.001)
    expect(durations.progress).toBeLessThan(0.001)
  })

  it.each(PATHS)('%s fits a phone-width viewport without horizontal overflow', async (path) => {
    const page = await open(path, {
      viewport: { width: 390, height: 844 },
      environment: { viewport: 'narrow' },
    })
    const overflow = await page.evaluate(() => {
      const offenders: string[] = []
      for (const host of document.querySelectorAll<HTMLElement>('[data-scenario-case]')) {
        const product = host.dataset.scenarioProduct ?? ''
        // Deliberately fixed-width canvases a phone scrolls or scales.
        if (['gradient-picker', 'color-picker', 'scroll-area'].includes(product)) continue
        for (const root of host.querySelectorAll<HTMLElement>('[data-part="root"]')) {
          const rect = root.getBoundingClientRect()
          if (rect.right > window.innerWidth + 1) {
            offenders.push(`${product}/${host.dataset.scenarioCase}: ${Math.round(rect.right)}`)
          }
        }
      }
      return offenders
    })
    await page.close()
    expect(overflow).toEqual([])
  })

  it('draws the same state in the same tokens on both paths', async () => {
    const read = async (path: Path) => {
      const page = await open(path)
      const values = await page.evaluate(() => {
        const q = (product: string, caseId: string, selector: string) =>
          document.querySelector<HTMLElement>(
            `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
          )!
        const style = (element: HTMLElement) => getComputedStyle(element)
        const failed = q('clipboard', 'permission-denied', '[data-part="indicator"]')
        // The fill is on the cell (baseline) or its day button (registry).
        const selectedCell = q('date-picker', 'single', '[data-part="day-cell"][data-selected]')
        return {
          selectedDay: style(selectedCell.querySelector<HTMLElement>('button') ?? selectedCell)
            .color,
          progressFill: style(
            q(
              'file-upload',
              'uploading',
              '[data-upload-status="uploading"] [data-part="item-progress-range"]',
            ),
          ).backgroundColor,
          timerComplete: style(q('timer', 'complete', '[data-part="display"]')).color,
          failedVisible: failed.getBoundingClientRect().height > 4,
          failedColor: style(failed).color,
          overBorder: style(q('sortable', 'dragging', '[data-part="item"][data-over]'))
            .borderTopColor,
          cropBorder: style(q('image-cropper', 'free', '[data-part="crop-box"]')).borderTopColor,
          dropzoneDragging: style(q('file-upload', 'dragging', '[data-part="dropzone"]'))
            .borderTopColor,
        }
      })
      await page.close()
      return values
    }
    const baseline = await read('baseline')
    const registry = await read('registryTailwind')
    expect(baseline.failedVisible).toBe(true)
    expect(registry.failedVisible).toBe(true)
    expect(registry).toEqual(baseline)
  })
})
