// @vitest-environment node

// #265 finding 7 — real per-open-level submenu positioning, proved with REAL
// Chromium layout rather than a mocked `getBoundingClientRect`. The jsdom
// integration test (`menu-submenu-positioning.integration.test.ts`) already
// pins the flip/RTL logic against fabricated rects; this file proves the
// SAME behavior actually holds once a real browser lays the page out —
// `attachFloating`'s flip/shift math consumes real viewport and element
// metrics, and a mocked rect cannot by itself prove those wire up to a
// genuine layout.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('#265 finding 7 — submenu edge-flip in real Chromium layout', () => {
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
    fixtureUrl = `http://127.0.0.1:${address.port}/submenu-edge-flip.fixture.html`

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 480, height: 320 } })
  })

  beforeEach(async () => {
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => window.__submenuEdgeFlipReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('opens the LEFT-anchored submenu to the right — there is room, so it is not flipped', async () => {
    await page.locator('[id="left:sub:sub:trigger"]').click()
    const geometry = await page.evaluate(() => {
      const trigger = document.querySelector('[id="left:sub:sub:trigger"]')!.getBoundingClientRect()
      const sub = document.querySelector('[id="left:sub:sub:content"]')!.getBoundingClientRect()
      return {
        side: document.querySelector('[id="left:sub:sub:content"]')!.getAttribute('data-side'),
        subLeftOfTrigger: sub.left < trigger.left,
        subWithinViewport: sub.left >= 0 && sub.right <= 480,
      }
    })
    expect(geometry.side).toBe('right')
    expect(geometry.subLeftOfTrigger).toBe(false)
    expect(geometry.subWithinViewport).toBe(true)
  })

  it('flips the RIGHT-anchored submenu to the left — the preferred side has no room', async () => {
    await page.locator('[id="right:sub:sub:trigger"]').click()
    const geometry = await page.evaluate(() => {
      const trigger = document
        .querySelector('[id="right:sub:sub:trigger"]')!
        .getBoundingClientRect()
      const sub = document.querySelector('[id="right:sub:sub:content"]')!.getBoundingClientRect()
      return {
        side: document.querySelector('[id="right:sub:sub:content"]')!.getAttribute('data-side'),
        subLeftOfTrigger: sub.right <= trigger.left + 1,
        subWithinViewport: sub.left >= 0 && sub.right <= 480,
      }
    })
    expect(geometry.side).toBe('left')
    expect(geometry.subLeftOfTrigger).toBe(true)
    expect(geometry.subWithinViewport).toBe(true)
  })

  it('anchors the submenu to its OWN subTrigger vertically, not a fixed corner', async () => {
    await page.locator('[id="left:sub:sub:trigger"]').click()
    const aligned = await page.evaluate(() => {
      const trigger = document.querySelector('[id="left:sub:sub:trigger"]')!.getBoundingClientRect()
      const sub = document.querySelector('[id="left:sub:sub:content"]')!.getBoundingClientRect()
      // 'start' alignment: the submenu's top should sit at (or very near) the
      // subTrigger's own top, not at document (0,0) — the historical
      // hardcoded-corner bug this finding replaces.
      return Math.abs(sub.top - trigger.top) < 4
    })
    expect(aligned).toBe(true)
  })
})
