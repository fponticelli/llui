// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MotionProduct, motionProducts } from '../browser/overlay-motion.fixture.js'

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

describe('overlay presence motion in Chromium', () => {
  let browser: Browser
  let page: Page
  let server: ViteDevServer
  let fixtureUrl: string

  beforeAll(async () => {
    server = await createServer({
      root: fixtureRoot,
      logLevel: 'error',
      resolve: {
        alias: {
          '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
          '@llui/interactions': resolve(fixtureRoot, '../../../interactions/src/index.ts'),
        },
      },
      server: { host: '127.0.0.1', port: 0 },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port')
    fixtureUrl = `http://127.0.0.1:${address.port}/overlay-motion.fixture.html`
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  beforeEach(async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(fixtureUrl)
    await page.addStyleTag({ content: baselineCss })
    await page.waitForFunction(() => window.__motionReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
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
})
