// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'browser')

describe('same-fragment history traversal in Chromium (#163)', () => {
  let browser: Browser
  let page: Page
  let server: ViteDevServer

  beforeAll(async () => {
    server = await createServer({
      root: fixtureRoot,
      logLevel: 'error',
      resolve: {
        alias: {
          '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
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

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}/same-fragment.fixture.html`)
    await page.waitForFunction(() => window.__sameFragmentReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('adopts a same-fragment landing and restores a later block from that position', async () => {
    const result = await page.evaluate(() => window.__runSameFragmentTraversal())

    expect(result.sameFragment).toEqual({
      events: ['popstate'],
      marker: 'entry-1',
      dispatches: ['login'],
    })
    expect(result.blockedRestore).toEqual({
      events: ['popstate', 'hashchange', 'popstate', 'hashchange'],
      marker: 'entry-1',
      hash: '#/login',
      dispatches: [],
    })
  })
})
