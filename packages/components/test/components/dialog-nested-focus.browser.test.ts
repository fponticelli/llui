// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('#209 — nested dialog focus restoration in Chromium', () => {
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
    fixtureUrl = `http://127.0.0.1:${address.port}/nested-dialog.fixture.html`

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  beforeEach(async () => {
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => window.__dialogReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('releases inner isolation before restoring into the outer dialog, then restores the outer trigger', async () => {
    const nested = await page.evaluate(() => {
      const focusAndClick = (id: string): void => {
        const element = document.getElementById(id) as HTMLElement
        element.focus()
        element.click()
      }

      // Raw in-page focus is intentional: Playwright's page.focus() can
      // re-assert focus after the action and mask the restore path (#209).
      focusAndClick('outer:trigger')
      focusAndClick('inner:trigger')
      // Keep only focus events caused by closing the inner dialog. This makes
      // the order assertion below prove the restore itself happened after the
      // outer layer became focusable, rather than matching the focus used to
      // open the inner dialog.
      window.__focusTrace = []
      ;(document.getElementById('inner:close') as HTMLElement).click()

      return {
        activeId: (document.activeElement as HTMLElement).id,
        activeIsBody: document.activeElement === document.body,
        outerStillOpen: document.getElementById('outer:content') !== null,
        restoreMoment: window.__focusTrace.find((entry) => entry.id === 'inner:trigger'),
      }
    })

    expect(nested).toEqual({
      activeId: 'inner:trigger',
      activeIsBody: false,
      outerStillOpen: true,
      restoreMoment: { id: 'inner:trigger', outerInert: false },
    })

    const outer = await page.evaluate(() => {
      ;(document.getElementById('outer:close') as HTMLElement).click()
      return {
        activeId: (document.activeElement as HTMLElement).id,
        activeIsBody: document.activeElement === document.body,
        outerStillOpen: document.getElementById('outer:content') !== null,
      }
    })

    expect(outer).toEqual({
      activeId: 'outer:trigger',
      activeIsBody: false,
      outerStillOpen: false,
    })
  })

  it('keeps single-dialog trigger restoration unchanged', async () => {
    const single = await page.evaluate(() => {
      const trigger = document.getElementById('outer:trigger') as HTMLElement
      trigger.focus()
      trigger.click()
      ;(document.getElementById('outer:close') as HTMLElement).click()
      return {
        activeId: (document.activeElement as HTMLElement).id,
        activeIsBody: document.activeElement === document.body,
        outerStillOpen: document.getElementById('outer:content') !== null,
      }
    })

    expect(single).toEqual({
      activeId: 'outer:trigger',
      activeIsBody: false,
      outerStillOpen: false,
    })
  })
})
