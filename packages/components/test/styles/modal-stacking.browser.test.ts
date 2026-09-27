// @vitest-environment node

// #265 finding 4: real Dialog / AlertDialog / Drawer modal stacking, mounted
// live through the shared menus-overlays harness (the REAL machines'
// `init`/`update`/`connect`/`overlay`, via `BASELINE_ADAPTERS` /
// `REGISTRY_ADAPTERS`), in real Chromium, on BOTH renderer paths.
//
// The adapters render `backdrop` BEFORE `content` as siblings under the
// positioner: equal z-index, DOM order decides paint order. While the surface
// is the active modal layer, `setAriaHiddenOutside` makes every sibling of
// `content` inert — the backdrop included — so HIT-TESTING passes straight
// through the backdrop whatever its paint order. Paint order is therefore
// proven on real composited PIXELS (`screenPixel`), and pointer interception
// by the event target a real press reaches.
//
// CLAUDE.md verification rules apply: verify by rendering, never by reading
// CSS; real pointer input (`page.mouse`, `locator.click()`), never
// `node.click()`; reduced motion so nothing is mid-transition when measured.

import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import {
  LIVE_PATHS,
  useMenusOverlaysLiveHarness,
  type LivePath,
} from './menus-overlays-live-harness.js'
import { bucketedKey, paintedColors, screenPixel } from './pixel-probe.js'
import { contrast, srgb8ToLinear } from '../../../../scripts/lib/oklch.mjs'

/** One real machine per modal surface family, and the scope it publishes. */
const SURFACES = {
  // `outsideDismisses`: an outside press closes a dialog or drawer; an alert
  // dialog demands an explicit answer and stays open.
  dialog: {
    scenarioId: 'component:dialog',
    caseId: 'modal',
    scope: 'dialog',
    outsideDismisses: true,
  },
  'alert-dialog': {
    scenarioId: 'component:alert-dialog',
    caseId: 'open',
    scope: 'dialog',
    outsideDismisses: false,
  },
  drawer: {
    scenarioId: 'component:drawer',
    caseId: 'right',
    scope: 'drawer',
    outsideDismisses: true,
  },
} as const

type SurfaceName = keyof typeof SURFACES

/** A top-left corner point: outside the (centered) dialog content and outside
 * the right-hand drawer panel, so it is backdrop on every surface. */
const OUTSIDE = { x: 3, y: 3 } as const

/** A small page control in the free bottom-left corner, above in-flow page
 * content (so it is genuinely reachable when no modal is open) and outside
 * every surface's content. */
const BEHIND = { x: 20, y: 748 } as const

declare global {
  interface Window {
    __behindClicks?: number
  }
}

describe('real Dialog/AlertDialog/Drawer modal stacking, live in Chromium (#265 finding 4)', () => {
  const { openCase } = useMenusOverlaysLiveHarness()

  /**
   * Mount one surface over a page that has one ordinary, reachable control
   * (`#behind`) in a free corner, counting its real clicks.
   */
  async function openSurface(
    path: LivePath,
    name: SurfaceName,
    opts: { forcedColors?: boolean } = {},
  ): Promise<Page> {
    const { scenarioId, caseId, scope } = SURFACES[name]
    const page = await openCase(path, scenarioId, caseId, undefined, {
      beforeMount: async (p) => {
        await p.emulateMedia({
          reducedMotion: 'reduce',
          forcedColors: opts.forcedColors === true ? 'active' : 'none',
        })
        await p.evaluate(() => {
          const behind = document.createElement('button')
          behind.id = 'behind'
          behind.textContent = 'behind'
          Object.assign(behind.style, {
            position: 'fixed',
            left: '0',
            bottom: '0',
            width: '40px',
            height: '40px',
            zIndex: '1',
          })
          window.__behindClicks = 0
          behind.addEventListener('click', () => {
            window.__behindClicks = (window.__behindClicks ?? 0) + 1
          })
          document.body.append(behind)
        })
      },
    })
    // Until the content is hit-testable at its own centre, the compositor may
    // still lag the layout of a fresh mount (the drawer's transform).
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel)
      if (el === null) return false
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return hit !== null && hit.closest('[data-part="content"]') !== null
    }, `#case [data-scope="${scope}"][data-part="content"]`)
    return page
  }

  const part = (page: Page, name: SurfaceName, dataPart: string) =>
    page.locator(`#case [data-scope="${SURFACES[name].scope}"][data-part="${dataPart}"]`)

  describe.each(LIVE_PATHS)('%s renderer', (path) => {
    describe.each(['dialog', 'alert-dialog', 'drawer'] as const)('%s', (name) => {
      it('paints the content OVER the backdrop, and the backdrop over the page, in normal and forced colours', async () => {
        for (const forcedColors of [false, true]) {
          const label = `${path}/${name}/forcedColors=${forcedColors}`
          const page = await openSurface(path, name, { forcedColors })
          const content = part(page, name, 'content')
          // A point in the content's top padding, horizontally centred: inside
          // its fill, clear of text, rounded corners and the 1px border.
          const { x, y, fill } = await content.evaluate((node) => {
            const rect = node.getBoundingClientRect()
            return {
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + 4),
              fill: getComputedStyle(node).backgroundColor,
            }
          })
          const [ownFill] = await paintedColors(page, [fill])
          const seen = await screenPixel(page, x, y)
          // Exactly the content's own fill: nothing is composited over it.
          expect(bucketedKey(seen), `${label} content pixel`).toBe(bucketedKey(ownFill!))

          // Instrument check: the backdrop DOES paint — the page seen through
          // it differs from the same page with the modal layer hidden.
          const scrimmed = await screenPixel(page, OUTSIDE.x, OUTSIDE.y)
          await page.evaluate(() => {
            for (const el of document.querySelectorAll<HTMLElement>(
              '#case [data-part="positioner"]',
            )) {
              el.style.visibility = 'hidden'
            }
          })
          const bare = await screenPixel(page, OUTSIDE.x, OUTSIDE.y)
          expect(bucketedKey(scrimmed), `${label} backdrop paints`).not.toBe(bucketedKey(bare))
          await page.close()
        }
      })

      it('a real press on a page control behind the open modal never reaches it; once closed, it does', async () => {
        const page = await openSurface(path, name)
        const content = part(page, name, 'content')
        await page.mouse.click(BEHIND.x, BEHIND.y)
        expect(await page.evaluate(() => window.__behindClicks)).toBe(0)
        // The same press is an OUTSIDE press to the modal.
        if (SURFACES[name].outsideDismisses) {
          await content.waitFor({ state: 'hidden' })
        } else {
          expect(await content.isVisible()).toBe(true)
          await part(page, name, 'close-trigger').first().click()
          await content.waitFor({ state: 'hidden' })
        }

        // Control arm: the SAME press reaches the control once the modal is
        // gone, so the zero above is the modal's doing, not the fixture's.
        await page.mouse.click(BEHIND.x, BEHIND.y)
        expect(await page.evaluate(() => window.__behindClicks)).toBe(1)
      })

      it('a real press on the content does not dismiss the surface', async () => {
        const page = await openSurface(path, name)
        await part(page, name, 'title').click()
        expect(await part(page, name, 'content').isVisible()).toBe(true)
      })

      it('traps focus inside the content on mount', async () => {
        const page = await openSurface(path, name)
        const contentId = await part(page, name, 'content').getAttribute('id')
        const activeInsideContent = await page.evaluate(
          (id) => document.activeElement?.closest(`#${CSS.escape(id!)}`) !== null,
          contentId,
        )
        expect(activeInsideContent).toBe(true)
      })

      it('restores focus to the real trigger that opened it, on close', async () => {
        // The case seeds the surface ALREADY open, so its own prior focus is
        // <body>. Drive a real close -> click trigger -> open -> close cycle,
        // so the trigger (focused by its own native click) is what returns.
        // Closed with a real Escape: every surface honours it, and not every
        // skin renders a close button (the registry drawer has none).
        const page = await openSurface(path, name)
        const content = part(page, name, 'content')
        const trigger = part(page, name, 'trigger')
        await page.keyboard.press('Escape')
        await content.waitFor({ state: 'hidden' })
        await trigger.click()
        await content.waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await content.waitFor({ state: 'hidden' })
        const triggerId = await trigger.getAttribute('id')
        expect(await page.evaluate(() => document.activeElement?.id)).toBe(triggerId)
      })

      it('keeps AA text contrast on the content, in normal and forced colours', async () => {
        for (const forcedColors of [false, true]) {
          const page = await openSurface(path, name, { forcedColors })
          const title = part(page, name, 'title')
          const { ink, x, y } = await title.evaluate((node) => {
            const rect = node.getBoundingClientRect()
            return { ink: getComputedStyle(node).color, x: rect.x, y: rect.y }
          })
          // The title's backdrop is the content fill it sits on, as painted.
          const fill = await screenPixel(page, Math.max(0, Math.round(x) - 2), Math.round(y))
          const [paintedInk] = await paintedColors(page, [ink])
          const ratio = contrast(
            srgb8ToLinear([fill.r, fill.g, fill.b]),
            srgb8ToLinear([paintedInk!.r, paintedInk!.g, paintedInk!.b]),
          )
          expect(ratio, `${path}/${name}/forcedColors=${forcedColors}`).toBeGreaterThanOrEqual(4.5)
          await page.close()
        }
      })
    })
  })
})
