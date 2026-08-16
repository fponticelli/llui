// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('#215 — context-menu ownership in Chromium', () => {
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
    fixtureUrl = `http://127.0.0.1:${address.port}/context-menu-ownership.fixture.html`
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  beforeEach(async () => {
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => window.__contextMenuReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('isolates an outside-owned menu from a later modal, including focus traversal', async () => {
    await page.locator('#outside-region').click({ button: 'right', position: { x: 31, y: 27 } })
    await page.locator('#cm\\:content').waitFor({ state: 'visible' })

    await page.evaluate(() => window.__openDialog())
    const isolation = await page.evaluate(() => {
      const menu = document.getElementById('cm:content')!
      const positioner = menu.closest('[data-part="positioner"]')!
      return {
        menuOpen: menu !== null,
        ariaHidden: positioner.getAttribute('aria-hidden'),
        inert: positioner.hasAttribute('inert'),
        dialogFocused: (document.activeElement as HTMLElement).id,
      }
    })
    expect(isolation).toEqual({
      menuOpen: true,
      ariaHidden: 'true',
      inert: true,
      dialogFocused: 'dlg-action',
    })

    await page.keyboard.press('Shift+Tab')
    const active = await page.evaluate(() => ({
      id: (document.activeElement as HTMLElement).id,
      inMenu: document.getElementById('cm:content')?.contains(document.activeElement) ?? false,
    }))
    expect(active).toEqual({ id: 'inside-region', inMenu: false })
  })

  it('uses the actual opener across multiple regions and keeps an inside-owned menu usable', async () => {
    await page.evaluate(() => window.__openDialog())
    await page.locator('#inside-region').click({ button: 'right', position: { x: 19, y: 21 } })

    const nested = await page.evaluate(() => {
      const menu = document.getElementById('cm:content')!
      const positioner = menu.closest('[data-part="positioner"]')!
      return {
        ariaHidden: positioner.getAttribute('aria-hidden'),
        inert: positioner.hasAttribute('inert'),
        activeId: (document.activeElement as HTMLElement).id,
      }
    })
    expect(nested).toEqual({
      ariaHidden: null,
      inert: false,
      activeId: 'cm:content',
    })

    // Non-vacuous trap membership: focus starts on the context-menu content.
    // With ownership, Tab may continue to its real tabbable control; without
    // ownership the modal trap reads focus as outside and redirects to its own
    // first action.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).toBe('cm-extra')

    await page.locator('#cm\\:item\\:a').click()
    expect(await page.evaluate(() => window.__selectedContextItem)).toBe('a')

    // Reuse the same component instance from the other region. The next modal
    // must classify it by this latest real opener, not by a static trigger id.
    await page.evaluate(() => window.__closeDialog())
    await page.locator('#outside-region').click({ button: 'right' })
    await page.evaluate(() => window.__openDialog())
    expect(
      await page.evaluate(() =>
        document
          .getElementById('cm:content')!
          .closest('[data-part="positioner"]')!
          .getAttribute('aria-hidden'),
      ),
    ).toBe('true')
  })

  it('preserves pointer placement, dismiss-then-reopen, focus behavior, and serializable state', async () => {
    const region = page.locator('#outside-region')
    const box = await region.boundingBox()
    if (!box) throw new Error('outside region has no box')

    await region.click({ button: 'right', position: { x: 17, y: 23 } })
    let style = await page.locator('[data-part="positioner"]').getAttribute('style')
    expect(style).toContain(`top:${box.y + 23}px`)
    expect(style).toContain(`left:${box.x + 17}px`)

    // Pointerdown dismisses the open menu; the following contextmenu event
    // reopens it at the new pointer location.
    await region.click({ button: 'right', position: { x: 71, y: 61 } })
    await page.locator('#cm\\:content').waitFor({ state: 'visible' })
    style = await page.locator('[data-part="positioner"]').getAttribute('style')
    expect(style).toContain(`top:${box.y + 61}px`)
    expect(style).toContain(`left:${box.x + 71}px`)
    expect(await page.evaluate(() => window.__contextMenuWasOpenAtEvent)).toEqual([false, false])

    expect(await page.evaluate(() => window.__serializedState())).not.toContain('owner')
    await page.evaluate(() => window.__closeContextMenu())
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).not.toBe(
      'outside-region',
    )
  })
})
