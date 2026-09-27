// @vitest-environment node

// #265 finding 4 (baseline modal stacking) + #265 correction item 2: this
// used to be a `page.setContent` fixture over HAND-WRITTEN static HTML
// (`modal(...)` template strings) — it could not fail on a real regression
// in `dialog.ts`/`alert-dialog.ts`/`drawer.ts`/`overlay-engine.ts` because
// nothing here ever ran them. It now mounts the REAL Dialog, AlertDialog and
// Drawer machines (`init`/`update`/`connect`/`overlay`) through the SAME
// live-served baseline renderer `menus-overlays-live-render.browser.test.ts`
// uses (`menus-overlays-baseline-renderer.ts`'s `BASELINE_ADAPTERS`, mounted
// via a real Vite dev server + real Chromium), so a broken backdrop/content
// stacking order, a broken focus trap, or a broken outside-dismissal
// guard fails this suite for real.
//
// `dialogLikeAdapter`/`drawerAdapter` (menus-overlays-baseline-renderer.ts)
// render `backdrop` BEFORE `content` as siblings under the positioner — the
// equal-z-index-plus-DOM-order stacking contract `menus-overlays.css`
// documents. Before this issue, those adapters rendered no `backdrop` node
// at all.
//
// See CLAUDE.md's styling rules: verify interaction state and stacking by
// rendering, never by reading CSS; use `page.mouse`/`locator.click()` for
// pointer state, never `.evaluate(node => node.click())`; kill transitions
// before reading a computed style/paint that might be mid-flight in a
// hidden/backgrounded tab.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { paintedColors, bucketedKey } from './pixel-probe.js'
import { ProductContractSchema } from '@llui/cli'

const repoRoot = resolve(import.meta.dirname, '../../../..')

interface RawContract {
  productContract?: unknown
}
const registryJson = JSON.parse(
  readFileSync(resolve(repoRoot, 'registry/registry.json'), 'utf8'),
) as RawContract
const contract = ProductContractSchema.parse(registryJson.productContract)

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
]

interface MountRequest {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment?: Record<string, unknown>
  readonly hostId: string
}

declare global {
  interface Window {
    __mountMenusOverlaysBaselineCase?: (contract: unknown, request: MountRequest) => void
  }
}

/** One real machine per "modal surface" family, keyed by the scenario/case
 * this suite exercises, and the selectors this file reads. */
const SURFACES = {
  dialog: { scenarioId: 'component:dialog', caseId: 'modal', scope: 'dialog' },
  'alert-dialog': { scenarioId: 'component:alert-dialog', caseId: 'open', scope: 'dialog' },
  drawer: { scenarioId: 'component:drawer', caseId: 'right', scope: 'drawer' },
} as const

type SurfaceName = keyof typeof SURFACES

describe('real Dialog/AlertDialog/Drawer modal stacking, mounted live in Chromium (#265 finding 4, item 2)', () => {
  let browser: Browser
  let server: ViteDevServer
  let url: string
  const openPages: Page[] = []

  beforeAll(async () => {
    server = await createServer({
      root: resolve(repoRoot, 'examples/components-demo'),
      logLevel: 'error',
      resolve: { alias: sourceAliases },
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite did not bind a TCP port')
    }
    url = `http://127.0.0.1:${address.port}/src/test-fixtures/menus-overlays-live-render.html`
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterEach(async () => {
    for (const page of openPages.splice(0)) await page.close().catch(() => {})
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  /** Mounts ONE real modal surface into a fresh page, with an ordinary
   * (non-overlay) button already on the page BEHIND where the backdrop will
   * paint — the "something a click-through would otherwise reach" this
   * suite's click-through-prevention test needs. */
  async function openSurface(name: SurfaceName, opts?: { forcedColors?: boolean }): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    openPages.push(page)
    await page.goto(url)
    await page.waitForFunction(() => typeof window.__mountMenusOverlaysBaselineCase === 'function')
    // Kill CSS transitions before mounting rather than waiting on them
    // (CLAUDE.md verification discipline): the backdrop's opacity
    // transitions in over `--llui-duration-normal` regardless of the real
    // machine's own `skipAnimations` (a data-level concept, not a CSS media
    // query), and hit-testing/paint reads taken mid-transition are flaky by
    // construction.
    await page.emulateMedia({
      reducedMotion: 'reduce',
      forcedColors: opts?.forcedColors ? 'active' : 'none',
    })
    const { scenarioId, caseId } = SURFACES[name]
    await page.evaluate(
      ({ contract, scenarioId, caseId }) => {
        const behind = document.createElement('button')
        behind.id = 'behind-the-modal'
        behind.textContent = 'behind'
        behind.style.position = 'fixed'
        behind.style.inset = '0'
        behind.style.width = '100%'
        behind.style.height = '100%'
        // Negative z-index: a POSITIONED sibling (even with no z-index at
        // all) paints AFTER ordinary in-flow content regardless of DOM
        // order, so an unset z-index here would occlude the surface's own
        // trigger button once the modal is closed and stop being a click-
        // through-prevention fixture at all. -1 keeps it strictly below
        // both the ordinary trigger button and the modal's own (positive,
        // 100) z-index layer.
        behind.style.zIndex = '-1'
        document.body.prepend(behind)
        ;(window as unknown as { __behindClicks: number }).__behindClicks = 0
        behind.addEventListener('click', () => {
          ;(window as unknown as { __behindClicks: number }).__behindClicks++
        })
        const mount = window.__mountMenusOverlaysBaselineCase!
        mount(contract, { scenarioId, caseId, hostId: 'case' })
      },
      { contract, scenarioId, caseId },
    )
    // Wait until the content is ACTUALLY hit-testable at its own center
    // before any test reads it. A fresh mount's LAYOUT (`getBoundingClientRect`)
    // is correct immediately, but the drawer's slide-in transform is
    // compositor-driven — the PAINT/hit-test tree can lag a frame or more
    // behind layout even under `prefers-reduced-motion`, so a point over the
    // freshly-computed rect can transiently hit nothing (`elementFromPoint`
    // returns `null`) or the wrong node. Poll the REAL condition every test
    // here depends on, not a proxy for it (a real race, not a fixed sleep).
    const { scope } = SURFACES[name]
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

  describe.each(['dialog', 'alert-dialog', 'drawer'] as const)('%s', (name) => {
    const { scope } = SURFACES[name]

    it('hit-tests: a point over the content resolves to content (or a descendant), a point over the backdrop resolves to the backdrop', async () => {
      const page = await openSurface(name)
      const backdrop = page.locator(`#case [data-scope="${scope}"][data-part="backdrop"]`)
      // Compute the content's rect AND hit-test its own center in ONE
      // atomic `page.evaluate` — reading the rect via a separate Playwright
      // API call first (its own actionability wait) and hit-testing in a
      // second, later call left a real race for the drawer's slide-in
      // transform (still catching up a frame after "visible" resolves)
      // even under `prefers-reduced-motion`.
      const overContent = await page.evaluate((sel) => {
        const el = document.querySelector(sel)!
        const rect = el.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit === null ? null : hit.closest('[data-part="content"]') !== null
      }, `#case [data-scope="${scope}"][data-part="content"]`)
      expect(overContent).toBe(true)

      // The drawer's 'right' side leaves the left edge of the viewport as
      // backdrop for its whole height, so a top-left corner point is
      // guaranteed outside content for every surface here (dialog/
      // alert-dialog are centered with room on every side).
      const overOutside = await page.evaluate(() => {
        const el = document.elementFromPoint(3, 3)
        return el === null
          ? null
          : {
              isContent: el.closest('[data-part="content"]') !== null,
              isPositionerOrBackdrop:
                el.closest('[data-part="positioner"]') !== null ||
                el.closest('[data-part="backdrop"]') !== null,
            }
      })
      expect(overOutside).not.toBeNull()
      expect(overOutside!.isContent).toBe(false)
      // `backdrop` itself is intentionally `inert` for as long as this
      // surface is the active modal layer — `setAriaHiddenOutside` hides
      // every SIBLING of `content` while a modal is open (this file's own
      // header, `packages/interactions/src/aria-hidden.ts`), and it does
      // not special-case the surface's own backdrop as an exception. A
      // real click therefore passes THROUGH the inert backdrop to
      // `positioner` (still not inert, still occupying the SAME z-index
      // layer as the surface), which is what actually intercepts the
      // point on the surface's behalf — proven below by the click-through
      // test never reaching real page content underneath either way.
      expect(overOutside!.isPositionerOrBackdrop).toBe(true)
      expect(await backdrop.count()).toBeGreaterThan(0)
    })

    it('a real pointer click on the backdrop is intercepted — it never reaches the page content behind it', async () => {
      const page = await openSurface(name)
      // A corner is outside the (bounded) dialog/alert-dialog content, and
      // outside the drawer's own edge panel too (drawer 'right' leaves the
      // opposite edge as backdrop).
      await page.mouse.click(3, 3)
      const behindClicks = await page.evaluate(
        () => (window as unknown as { __behindClicks: number }).__behindClicks,
      )
      expect(behindClicks).toBe(0)
    })

    it('a real pointer click on the content does not dismiss the surface', async () => {
      const page = await openSurface(name)
      const content = page.locator(`#case [data-scope="${scope}"][data-part="content"]`)
      const title = page.locator(`#case [data-scope="${scope}"][data-part="title"]`)
      await title.click()
      expect(await content.isVisible()).toBe(true)
    })

    it('traps focus inside the content on mount', async () => {
      const page = await openSurface(name)
      const content = page.locator(`#case [data-scope="${scope}"][data-part="content"]`)
      const contentId = await content.getAttribute('id')
      const activeInsideContent = await page.evaluate(
        (id) => document.activeElement?.closest(`#${CSS.escape(id!)}`) !== null,
        contentId,
      )
      expect(activeInsideContent).toBe(true)
    })

    it('restores focus to the real trigger that opened it, on close', async () => {
      // The scenario case seeds the surface ALREADY open, so the focus
      // trap's own "restore to whatever was previously focused" captures
      // `document.body` (nothing was focused yet) — a real, but
      // uninteresting, restore target. This test instead drives a REAL
      // close -> click-trigger -> open -> close cycle with real pointer
      // clicks, so the trap's prior-focus capture is the trigger itself
      // (a native `<button>` click focuses it before the click handler
      // runs), exactly the production shape: a user clicks the trigger,
      // the surface opens, and closing it returns focus to that trigger.
      const page = await openSurface(name)
      const content = page.locator(`#case [data-scope="${scope}"][data-part="content"]`)
      const trigger = page.locator(`#case [data-scope="${scope}"][data-part="trigger"]`)
      const closeTrigger = page.locator(`#case [data-scope="${scope}"][data-part="close-trigger"]`)

      await closeTrigger.click()
      await content.waitFor({ state: 'hidden' })
      await trigger.click()
      await content.waitFor({ state: 'visible' })
      await closeTrigger.click()
      await content.waitFor({ state: 'hidden' })

      const triggerId = await trigger.getAttribute('id')
      const activeIsTrigger = await page.evaluate(
        (id) => document.activeElement?.id === id,
        triggerId,
      )
      expect(activeIsTrigger).toBe(true)
    })

    it('gives backdrop and content the SAME explicit z-index (never content: auto)', async () => {
      // The hit-test above cannot catch a REGRESSION here on its own:
      // `backdrop` is `inert` for as long as this surface is the active
      // modal layer (see the hit-test's own comment), so hit-testing
      // passes straight through it regardless of paint ORDER. This is the
      // z-index-equality half of #265 finding 4's actual regression — a
      // `content` at `auto` loses to ANY positive z-index on `backdrop`
      // regardless of DOM order, painting the scrim ABOVE the surface even
      // though hit-testing alone would look fine.
      const page = await openSurface(name)
      const [backdropZ, contentZ] = await Promise.all([
        page
          .locator(`#case [data-scope="${scope}"][data-part="backdrop"]`)
          .evaluate((n) => getComputedStyle(n).zIndex),
        page
          .locator(`#case [data-scope="${scope}"][data-part="content"]`)
          .evaluate((n) => getComputedStyle(n).zIndex),
      ])
      expect(contentZ).not.toBe('auto')
      expect(contentZ).toBe(backdropZ)
    })

    it('gives backdrop and content genuinely DIFFERENT painted colors, in normal AND forced-colors', async () => {
      for (const forcedColors of [false, true]) {
        const page = await openSurface(name, { forcedColors })
        const backdrop = page.locator(`#case [data-scope="${scope}"][data-part="backdrop"]`)
        const content = page.locator(`#case [data-scope="${scope}"][data-part="content"]`)
        const [backdropColor, contentColor] = await Promise.all([
          backdrop.evaluate((n) => getComputedStyle(n).backgroundColor),
          content.evaluate((n) => getComputedStyle(n).backgroundColor),
        ])
        const [paintedBackdrop, paintedContent] = await paintedColors(page, [
          backdropColor,
          contentColor,
        ])
        expect(
          bucketedKey(paintedBackdrop!),
          `${name}/forcedColors=${forcedColors} backdrop vs content`,
        ).not.toBe(bucketedKey(paintedContent!))
      }
    })
  })

  it('a later-opened Dialog stays the top layer for dismissal: Escape/outside-press close only it, not an earlier one', async () => {
    // Real append-order/z-index interaction between two independently
    // mounted host sections is covered structurally by
    // `menus-overlays-live-render.browser.test.ts`'s stacked-overlay suite
    // (#265 item 1e) — this pins the SAME real-machine dismissal-ownership
    // guarantee specifically for two Dialogs, the shape #265 finding 4
    // names, using a real pointer press.
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    openPages.push(page)
    await page.goto(url)
    await page.waitForFunction(() => typeof window.__mountMenusOverlaysBaselineCase === 'function')
    await page.evaluate(
      ({ contract }) => {
        const mount = window.__mountMenusOverlaysBaselineCase!
        mount(contract, { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'outer' })
        mount(contract, { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'inner' })
      },
      { contract },
    )
    const outerContent = page.locator('#outer [data-scope="dialog"][data-part="content"]')
    const innerContent = page.locator('#inner [data-scope="dialog"][data-part="content"]')
    expect(await outerContent.isVisible()).toBe(true)
    expect(await innerContent.isVisible()).toBe(true)
    await page.mouse.click(2, 2)
    await innerContent.waitFor({ state: 'hidden' })
    expect(await outerContent.isVisible()).toBe(true)
  })
})
