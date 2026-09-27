// @vitest-environment node

// #265 A1 — before this fix, `overlay()`'s floating placement unconditionally
// passed `state.dir` (defaulting to `'ltr'` until the opt-in `directionSync`
// part is placed) to `attachFloating`. An RTL page that never mounts that
// part — the ordinary shape for a consumer who did not know it existed —
// therefore laid the menu out LTR regardless of the real page direction.
// Real Chromium is required here (not jsdom): `@floating-ui/dom`'s default
// platform resolves direction via `getComputedStyle(el).direction`, and that
// is only meaningful once the `[dir]` UA rule actually applies — jsdom does
// not implement it, so a jsdom probe of this fix would read 'ltr' either way
// and prove nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('#265 A1 — menu overlay floating direction in real Chromium layout', () => {
  let browser: Browser
  let server: ViteDevServer
  let baseUrl: string

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
    baseUrl = `http://127.0.0.1:${address.port}/menu-rtl-floating.fixture.html`

    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function openCase(dir: 'ltr' | 'rtl'): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } })
    await page.goto(`${baseUrl}?dir=${dir}`)
    await page.waitForFunction(() => window.__menuRtlFloatingReady === true)
    return page
  }

  it('mirrors floating placement under page dir="rtl" with NO directionSync part and NO explicit setDir', async () => {
    const ltrPage = await openCase('ltr')
    const rtlPage = await openCase('rtl')
    try {
      const geometry = (page: Page) =>
        page.evaluate(() => {
          const trigger = document.getElementById('menu:trigger')!.getBoundingClientRect()
          const content = document.getElementById('menu:content')!.getBoundingClientRect()
          return content.x - trigger.x
        })
      const [ltrOffset, rtlOffset] = await Promise.all([geometry(ltrPage), geometry(rtlPage)])
      // 'bottom-start' in LTR aligns the content's LEFT edge with the
      // trigger's left edge (offset 0 regardless of width); under RTL
      // "start" flips to the trigger's RIGHT edge, a real, large positive
      // offset given the trigger (100px) is much wider than the content
      // (42px). Before #265 A1, `dir` was unconditionally the state's
      // default 'ltr', so the RTL page's menu computed the SAME (0) offset
      // as LTR.
      expect(Math.abs(ltrOffset)).toBeLessThan(2)
      expect(rtlOffset).toBeGreaterThan(30)
    } finally {
      await ltrPage.close()
      await rtlPage.close()
    }
  })
})
