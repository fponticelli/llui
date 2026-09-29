// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../../../scripts/lib/prebuilt-fixture.mjs'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  MotionProduct,
  motionProducts,
  transitionProducts,
} from '../browser/overlay-motion.fixture.js'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')
const stylesRoot = resolve(import.meta.dirname, '../../src/styles')
const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'menus-overlays.css',
  'motion.css',
]
  .map((file) => readFileSync(resolve(stylesRoot, file), 'utf8'))
  .join('\n')
const expectedProducts = [
  'dialog',
  'alert-dialog',
  'drawer',
  'menu',
  'context-menu',
  'popover',
  'hover-card',
  'tooltip',
] as const satisfies typeof motionProducts
const expectedTransitionProducts = [
  'select',
  'combobox',
  'menubar',
] as const satisfies typeof transitionProducts

const seconds = (value: string): number => {
  const first = value.split(',')[0]?.trim() ?? '0s'
  return first.endsWith('ms') ? Number.parseFloat(first) / 1_000 : Number.parseFloat(first)
}

describe('overlay presence motion in Chromium', () => {
  let browser: Browser
  let page: Page
  let fixture: PrebuiltFixture
  let fixtureUrl: string

  beforeAll(async () => {
    // Built ONCE, served static (`scripts/lib/prebuilt-fixture.mjs`). Every
    // test reloads the page, and on a Vite dev server each reload re-fetched
    // the fixture's whole unbundled module graph — and shared the package's
    // dependency-optimizer cache with every other `test/browser` suite running
    // in a concurrent worker, whose re-optimizations could force-reload this
    // page mid-wait. That is how `__motionReady` timed out at 30 s inside a
    // parallel `turbo test` while the file took ~11 s alone.
    ;[fixture, browser] = await Promise.all([
      prebuildFixture({
        root: fixtureRoot,
        inputs: ['overlay-motion.fixture.html'],
        alias: {
          '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
          '@llui/interactions': resolve(fixtureRoot, '../../../interactions/src/index.ts'),
        },
        define: {
          __LLUI_AGENT__: 'true',
          __LLUI_TRANSITIONS__: 'true',
        },
      }),
      hermetic.launch({ headless: true }),
    ])
    fixtureUrl = fixture.url('overlay-motion.fixture.html')
    page = await browser.newPage()
  })

  beforeEach(async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const errors: string[] = []
    const onError = (error: Error): void => void errors.push(error.message)
    page.on('pageerror', onError)
    await page.goto(fixtureUrl)
    page.off('pageerror', onError)
    await page.addStyleTag({ content: baselineCss })
    // The bundled fixture sets `__motionReady` synchronously in its one module
    // script, which runs before `load`: after `goto` it is ready or broken, so
    // assert it and name the page's own error instead of waiting 30 s.
    if (!(await page.evaluate(() => window.__motionReady === true))) {
      throw new Error(
        `overlay-motion fixture never became ready: ${errors.join('; ') || 'no page error'}`,
      )
    }
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await fixture?.close()
  })

  const waitForStatus = async (status: 'open' | 'closed'): Promise<void> => {
    await page.waitForFunction(
      (expected) => {
        const snapshot = window.__motionSnapshot()
        return (
          snapshot.status === expected &&
          snapshot.contentState === (expected === 'open' ? 'open' : null)
        )
      },
      status,
      { timeout: 2_000 },
    )
  }

  const waitForSide = async (side: 'top' | 'right' | 'bottom' | 'left'): Promise<void> => {
    await page.waitForFunction((expected) => window.__motionSnapshot().side === expected, side, {
      timeout: 2_000,
    })
  }

  const center = (start: number, end: number): number => (start + end) / 2

  const expectArrowContact = async (side: 'top' | 'right' | 'bottom' | 'left'): Promise<void> => {
    const snapshot = await page.evaluate(() => window.__motionSnapshot())
    expect(snapshot.side).toBe(side)
    expect(snapshot.arrow?.position).toBe('absolute')
    const arrow = snapshot.arrow!
    const content = snapshot.contentRect!
    const trigger = snapshot.triggerRect!
    if (side === 'top' || side === 'bottom') {
      expect(
        Math.abs(center(arrow.rect.left, arrow.rect.right) - center(trigger.left, trigger.right)),
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          center(arrow.rect.top, arrow.rect.bottom) -
            (side === 'bottom' ? content.top : content.bottom),
        ),
      ).toBeLessThanOrEqual(1)
      expect(Number.parseFloat(side === 'bottom' ? arrow.top : arrow.bottom)).toBeLessThan(0)
      expect(side === 'bottom' ? arrow.bottom : arrow.top).toBe('')
    } else {
      expect(
        Math.abs(center(arrow.rect.top, arrow.rect.bottom) - center(trigger.top, trigger.bottom)),
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          center(arrow.rect.left, arrow.rect.right) -
            (side === 'right' ? content.left : content.right),
        ),
      ).toBeLessThanOrEqual(1)
      expect(Number.parseFloat(side === 'right' ? arrow.left : arrow.right)).toBeLessThan(0)
      expect(side === 'right' ? arrow.right : arrow.left).toBe('')
    }
  }

  const exerciseAnimatedLifecycle = async (
    product: MotionProduct,
    exactTrace = true,
  ): Promise<void> => {
    const initial = await page.evaluate((selected) => window.__mountMotion(selected, true), product)
    expect(initial).toMatchObject({ product, status: 'closed', mounted: false })

    const opening = await page.evaluate(() => {
      window.__resetMotionTrace()
      return window.__openMotion()
    })
    expect(opening).toMatchObject({ status: 'opening', mounted: true, contentState: 'opening' })
    expect(opening.animationName).not.toBe('none')
    await waitForStatus('open')

    const closing = await page.evaluate(() => window.__closeMotion())
    expect(closing).toMatchObject({ status: 'closing', mounted: true, contentState: 'closing' })
    expect(closing.animationName).not.toBe('none')
    await waitForStatus('closed')

    const trace = await page.evaluate(() => window.__motionTrace)
    const productTrace = trace.filter((entry) => entry.product === product)
    if (exactTrace) {
      expect(productTrace).toEqual([
        expect.objectContaining({ event: 'animationstart', state: 'opening' }),
        expect.objectContaining({ event: 'animationend', state: 'opening' }),
        expect.objectContaining({ event: 'animationstart', state: 'closing' }),
        expect.objectContaining({ event: 'animationend', state: 'closing' }),
      ])
    } else {
      // At 0.01ms Chromium may batch a phase's start/end delivery across the
      // reactive `opening` → `open` attribute update. The status assertions
      // above prove both phases settled; this pins that real CSS events still
      // occurred without over-specifying their capture-time attribute value.
      expect(productTrace.some(({ event }) => event === 'animationstart')).toBe(true)
      expect(productTrace.some(({ event }) => event === 'animationend')).toBe(true)
    }
  }

  it('keeps the browser fixture keyed to the exact affected product set', async () => {
    expect(await page.evaluate(() => window.__motionProducts)).toEqual(expectedProducts)
  })

  it('uses real CSS animation events to settle animated opening and unmount animated closing', async () => {
    for (const product of expectedProducts) await exerciseAnimatedLifecycle(product)
  })

  it('retains anchored geometry through menu, context-menu, and popover exit animations', async () => {
    for (const product of ['menu', 'context-menu', 'popover'] as const) {
      await page.evaluate((selected) => window.__mountMotion(selected, true), product)
      await page.evaluate(() => window.__openMotion())
      await waitForStatus('open')
      const opened = await page.evaluate(() => window.__motionSnapshot())

      expect(opened.positioner).not.toBeNull()
      if (product === 'context-menu') {
        expect(opened.positioner).toMatchObject({ top: '32px', left: '24px' })
      } else {
        expect(opened.positioner?.transform).not.toBe('')
        expect(opened.placement).not.toBeNull()
        expect(opened.side).not.toBeNull()
      }

      const closing = await page.evaluate(() => window.__closeMotion())
      expect(closing).toMatchObject({ status: 'closing', mounted: true })
      expect(closing.positioner).toEqual(opened.positioner)
      expect(closing.placement).toBe(opened.placement)
      expect(closing.side).toBe(opened.side)
      await waitForStatus('closed')
    }
  })

  it('reuses retained menu placement when an exit is interrupted by reopening', async () => {
    await page.evaluate(() => window.__mountMotion('menu', true))
    await page.evaluate(() => window.__openMotion())
    await waitForStatus('open')
    const opened = await page.evaluate(() => window.__motionSnapshot())

    const closing = await page.evaluate(() => window.__closeMotion())
    expect(closing.positioner).toEqual(opened.positioner)
    expect(closing.placement).toBe(opened.placement)
    expect(closing.side).toBe(opened.side)

    const reopening = await page.evaluate(() => window.__openMotion())
    expect(reopening).toMatchObject({ status: 'opening', mounted: true })
    expect(reopening.positioner).toEqual(opened.positioner)
    expect(reopening.placement).toBe(opened.placement)
    expect(reopening.side).toBe(opened.side)
    await waitForStatus('open')

    await page.evaluate(() => window.__closeMotion())
    await waitForStatus('closed')
  })

  it('keeps a mounted baseline arrow centered and edge-anchored across physical flips', async () => {
    await page.setViewportSize({ width: 800, height: 600 })

    await page.evaluate(() => window.__mountMotion('popover', true, 'bottom'))
    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 80,
        right: 380,
        bottom: 100,
        left: 300,
        width: 80,
        height: 20,
      }),
    )
    await page.evaluate(() => window.__openMotion())
    await waitForStatus('open')
    await waitForSide('bottom')
    await expectArrowContact('bottom')

    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 570,
        right: 380,
        bottom: 590,
        left: 300,
        width: 80,
        height: 20,
      }),
    )
    await waitForSide('top')
    await expectArrowContact('top')
    await page.evaluate(() => window.__closeMotion())
    await waitForStatus('closed')

    await page.evaluate(() => window.__mountMotion('popover', true, 'right'))
    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 280,
        right: 120,
        bottom: 320,
        left: 100,
        width: 20,
        height: 40,
      }),
    )
    await page.evaluate(() => window.__openMotion())
    await waitForStatus('open')
    await waitForSide('right')
    await expectArrowContact('right')

    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 280,
        right: 795,
        bottom: 320,
        left: 775,
        width: 20,
        height: 40,
      }),
    )
    await waitForSide('left')
    await expectArrowContact('left')
    await page.evaluate(() => window.__closeMotion())
    await waitForStatus('closed')
  })

  it('keeps default no-animation opening and closing synchronous', async () => {
    for (const product of expectedProducts) {
      const initial = await page.evaluate(
        (selected) => window.__mountMotion(selected, false),
        product,
      )
      expect(initial).toMatchObject({ status: 'closed', mounted: false })
      const opened = await page.evaluate(() => window.__openMotion())
      expect(opened).toMatchObject({ status: 'open', mounted: true, contentState: 'open' })
      const closed = await page.evaluate(() => window.__closeMotion())
      expect(closed).toMatchObject({ status: 'closed', mounted: false, contentState: null })
    }
  })

  it('cannot hang in opening or closing under reduced motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const product of expectedProducts) await exerciseAnimatedLifecycle(product, false)
  })

  it('retains and removes an animated toast through a real closing end event', async () => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion })
      await page.goto(fixtureUrl)
      await page.addStyleTag({ content: baselineCss })
      await page.waitForFunction(() => window.__motionReady === true)
      expect(
        await page.evaluate(() => window.__mountToastMotion(true, 'bottom-end')),
      ).toMatchObject({
        count: 0,
        mounted: false,
        placement: 'bottom-end',
      })
      expect(await page.evaluate(() => window.__createToastMotion('info'))).toMatchObject({
        count: 1,
        mounted: true,
        status: 'open',
        type: 'info',
        role: 'status',
        ariaLive: 'polite',
      })
      const closing = await page.evaluate(() => {
        window.__resetMotionTrace()
        return window.__dismissToastMotion()
      })
      expect(closing).toMatchObject({ count: 1, mounted: true, status: 'closing' })
      expect(closing.animationName, reducedMotion).not.toBe('none')
      expect(seconds(closing.animationDuration!), reducedMotion).toBeGreaterThan(0)
      if (reducedMotion === 'reduce') {
        expect(seconds(closing.animationDuration!), reducedMotion).toBeLessThanOrEqual(0.001)
      }
      await page.waitForFunction(
        () => {
          const snapshot = window.__toastMotionSnapshot()
          return snapshot.count === 0 && !snapshot.mounted && snapshot.status === null
        },
        undefined,
        { timeout: 2_000 },
      )
      const trace = await page.evaluate(() =>
        window.__motionTrace.filter(({ product }) => product === 'toast'),
      )
      expect(
        trace.some(({ event }) => event === 'animationstart'),
        reducedMotion,
      ).toBe(true)
      expect(
        trace.some(({ event }) => event === 'animationend'),
        reducedMotion,
      ).toBe(true)
    }
  })

  it('keeps synchronous selection surfaces immediate and defers them only for an explicit transition', async () => {
    expect(await page.evaluate(() => window.__transitionProducts)).toEqual(
      expectedTransitionProducts,
    )
    for (const product of expectedTransitionProducts) {
      expect(
        await page.evaluate((selected) => window.__mountTransitionMotion(selected, false), product),
      ).toMatchObject({ product, open: false, mounted: false })
      expect(await page.evaluate(() => window.__openTransitionMotion())).toMatchObject({
        product,
        open: true,
        mounted: true,
        contentState: 'open',
      })
      expect(await page.evaluate(() => window.__closeTransitionMotion())).toMatchObject({
        product,
        open: false,
        mounted: false,
        contentState: null,
      })

      await page.evaluate((selected) => window.__mountTransitionMotion(selected, true), product)
      await page.evaluate(() => {
        window.__resetMotionTrace()
        window.__openTransitionMotion()
      })
      expect(await page.evaluate(() => window.__transitionMotionSnapshot())).toMatchObject({
        product,
        open: true,
        mounted: true,
        contentState: 'open',
      })

      await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        window.__resetMotionTrace()
        window.__closeTransitionMotion()
      })
      const retained = await page.evaluate(() => window.__transitionMotionSnapshot())
      expect(retained).toMatchObject({
        product,
        open: false,
        mounted: true,
        // The structural transition freezes the departing arm before the raw
        // boolean machine removes it; the real mounted node therefore retains
        // its last live `open` props while the positioner fades out.
        contentState: 'open',
      })
      expect(seconds(retained.transitionDuration!), `${product}/leave`).toBeGreaterThan(0)
      await page.waitForFunction(
        () => {
          const snapshot = window.__transitionMotionSnapshot()
          return !snapshot.open && !snapshot.mounted
        },
        undefined,
        { timeout: 2_000 },
      )
      const trace = await page.evaluate(() => window.__motionTrace)
      expect(
        trace.some(
          ({ event, product: traced }) => event === 'transitionstart' && traced === product,
        ),
        `${product}/start`,
      ).toBe(true)
      expect(
        trace.some(({ event, product: traced }) => event === 'transitionend' && traced === product),
        `${product}/end`,
      ).toBe(true)
    }
  })
})
