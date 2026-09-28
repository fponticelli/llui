// @vitest-environment node

// #265 A4 — engine-owned per-level submenu overlays (`menu.subOverlay`),
// proved with REAL Chromium layout rather than a mocked
// `getBoundingClientRect`. The jsdom integration test
// (`menu-submenu-positioning.integration.test.ts`) already pins the flip/RTL
// logic against fabricated rects; this file proves the SAME behavior
// actually holds once a real browser lays the page out — `attachFloating`'s
// flip/shift math consumes real viewport and element metrics, and a mocked
// rect cannot by itself prove those wire up to a genuine layout. Covers the
// real-Chromium proofs for submenu geometry: LTR flip at the right edge, the
// RTL mirror at the left edge, alignment to the subTrigger's own top, and
// cross-axis correction keeping a level in view at the bottom edge (`shift`'s
// OWN isolated contribution — as opposed to `flip`'s cross-axis alignment
// switch, which alone already rescues this fixture's geometry, measured — is
// pinned deterministically in the jsdom integration test instead, with
// `flip: false` forcing shift to be the only possible corrector; see that
// test for why).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../../../scripts/lib/prebuilt-fixture.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('#265 finding 7 — submenu edge-flip in real Chromium layout', () => {
  let browser: Browser
  let page: Page
  let fixture: PrebuiltFixture
  let fixtureUrl: string

  beforeAll(async () => {
    fixture = await prebuildFixture({
      root: fixtureRoot,
      inputs: ['submenu-edge-flip.fixture.html'],
      alias: {
        '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
        '@llui/interactions': resolve(fixtureRoot, '../../../interactions/src/index.ts'),
      },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    fixtureUrl = fixture.url('submenu-edge-flip.fixture.html')

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
    await fixture?.close()
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

  it('mirrors the flip under RTL — a left-edge trigger flips to the right', async () => {
    await page.locator('[id="rtl:sub:sub:trigger"]').click()
    const geometry = await page.evaluate(() => {
      const trigger = document.querySelector('[id="rtl:sub:sub:trigger"]')!.getBoundingClientRect()
      const sub = document.querySelector('[id="rtl:sub:sub:content"]')!.getBoundingClientRect()
      return {
        side: document.querySelector('[id="rtl:sub:sub:content"]')!.getAttribute('data-side'),
        subRightOfTrigger: sub.left >= trigger.right - 1,
        subWithinViewport: sub.left >= 0 && sub.right <= 480,
      }
    })
    // Under rtl the un-flipped default is 'left'; a trigger with no room on
    // its left (this fixture's left edge) must flip to 'right' — the exact
    // mirror of the LTR right-edge case above.
    expect(geometry.side).toBe('right')
    expect(geometry.subRightOfTrigger).toBe(true)
    expect(geometry.subWithinViewport).toBe(true)
  })

  it('keeps a bottom-edge submenu within the viewport (cross-axis correction)', async () => {
    await page.locator('[id="bottom:sub:sub:trigger"]').click()
    const geometry = await page.evaluate(() => {
      const sub = document.querySelector('[id="bottom:sub:sub:content"]')!.getBoundingClientRect()
      return {
        side: document.querySelector('[id="bottom:sub:sub:content"]')!.getAttribute('data-side'),
        subWithinViewport: sub.top >= 0 && sub.bottom <= 320,
      }
    })
    // The preferred side is still 'right' (plenty of horizontal room) — only
    // the CROSS axis (vertical) needed correcting. `shift`'s own isolated
    // effect (as opposed to `flip`'s cross-axis alignment-switch, which alone
    // can already rescue a 5-item submenu here — measured) is pinned
    // separately and deterministically in
    // `menu-submenu-positioning.integration.test.ts`'s
    // "keeps a level in view via SHIFT when flip's cross-axis rescue cannot"
    // (jsdom, `flip: false` forces shift to be the only possible corrector).
    expect(geometry.side).toBe('right')
    expect(geometry.subWithinViewport).toBe(true)
  })
})
