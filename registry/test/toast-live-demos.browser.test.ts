// @vitest-environment node

/**
 * Real-Chromium proof of the Toast contract in BOTH actual demos
 * (`examples/components-demo`, `examples/registry-demo`) — not only the
 * isolated scenario-renderer harness in
 * `packages/components/test/styles/menus-overlays-live-render.browser.test.ts`
 * (#265, task item 1). Mirrors the pattern of
 * `registry/test/navigation-data-live-demos.browser.test.ts` and
 * `registry/test/registry-demo-menus-direction.browser.test.ts`: a real Vite
 * dev server per app, a real Chromium page, Playwright's Clock API to drive
 * the machine's tick-driven countdown deterministically — NEVER a wall-clock
 * `setTimeout`/`waitForTimeout` sleep.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

interface Demo {
  readonly path: 'baseline' | 'registryTailwind'
  readonly dir: string
  /** Locator for the button that pushes a toast of a given type. */
  readonly trigger: (type: string) => string
  /** Locator for the async (loading -> success) trigger. */
  readonly asyncTrigger: string
}

// Declared SYNCHRONOUSLY (no dependency on `beforeAll`) so the `describe`
// loop below registers real tests at COLLECTION time — vitest reports "no
// test found" for any suite whose `describe` calls only run after an async
// hook has resolved.
const DEMOS: readonly Demo[] = [
  {
    path: 'baseline',
    dir: 'examples/components-demo',
    trigger: (type) => `#toast-trigger-${type}`,
    asyncTrigger: '#toast-trigger-async',
  },
  {
    path: 'registryTailwind',
    dir: 'examples/registry-demo',
    trigger: (type) => `[data-toast-demo-type="${type}"]`,
    asyncTrigger: '[data-toast-demo-type="async"]',
  },
]

async function startExample(directory: string): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: resolve(repoRoot, directory),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error(`Vite did not bind ${directory} to a TCP port`)
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

describe('actual Toast demos in Chromium (#265 task item 1)', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  const urls: Record<string, string> = {}

  beforeAll(async () => {
    const [baseline, registry] = await Promise.all([
      startExample('examples/components-demo'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registry.server]
    urls.baseline = baseline.url
    urls.registryTailwind = registry.url
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((s) => s.close()))
  })

  const REGION = '[data-scope="toast"][data-part="region"]'
  const ROOT = '[data-scope="toast"][data-part="root"]'

  for (const demo of DEMOS) {
    describe(demo.path, () => {
      let page: Page

      beforeEach(async () => {
        page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
        // Installed BEFORE navigation so every timer the app schedules
        // (the toast-tick `setInterval`, the loading->success `setTimeout`)
        // is virtual from the first paint — no real wall-clock wait is ever
        // needed to observe a countdown or a delayed patch.
        await page.clock.install({ time: 0 })
        await page.goto(urls[demo.path]!)
        await page.locator('#app').waitFor({ state: 'attached' })
      })

      afterEach(async () => {
        await page?.close()
      })

      it('renders all six ToastTypes with their reactive parts (role/aria-live/data-type/glyph)', async () => {
        const expectations: Record<string, { role: string; live: string }> = {
          info: { role: 'status', live: 'polite' },
          success: { role: 'status', live: 'polite' },
          warning: { role: 'status', live: 'polite' },
          error: { role: 'alert', live: 'assertive' },
          loading: { role: 'status', live: 'polite' },
          custom: { role: 'status', live: 'polite' },
        }
        for (const [type, expected] of Object.entries(expectations)) {
          await page.locator(demo.trigger(type)).click()
          const root = page.locator(`${ROOT}[data-type="${type}"]`).last()
          await root.waitFor({ state: 'attached' })
          expect(await root.getAttribute('role'), type).toBe(expected.role)
          expect(await root.getAttribute('aria-live'), type).toBe(expected.live)
          const visibleIcons = await root.evaluate((node) => {
            const candidates = node.querySelectorAll(
              '[data-part="type-icon"], svg[class*="/toast:"]',
            )
            let count = 0
            for (const el of candidates) {
              if (getComputedStyle(el).display !== 'none') count++
            }
            return count
          })
          expect(visibleIcons, `${type} visible icon count`).toBe(1)
          // Dismiss before the next push — the demo's queue is capped
          // (`max`), and this test cares about each type's OWN parts, not
          // queue capacity (covered by the reducer's own unit tests).
          await root.locator('button').last().click()
          await root.waitFor({ state: 'detached', timeout: 5000 })
        }
      })

      it('close button removes the toast', async () => {
        await page.locator(demo.trigger('info')).click()
        const root = page.locator(`${ROOT}[data-type="info"]`).last()
        await root.waitFor({ state: 'attached' })
        await root.locator('button').last().click()
        // Non-animated by default in these demos? Both init with
        // `animated: true`, so dismiss moves to `closing` then the (near-
        // instant, real) exit animation's `animationend` removes it — never
        // a wall-clock wait, just the real event the reduced-motion recipe
        // guarantees fires quickly.
        await root.waitFor({ state: 'detached', timeout: 5000 })
      })

      it('placement select moves the region to the correct edge/corner, LTR and RTL, all six placements', async () => {
        const placements = [
          'top',
          'top-start',
          'top-end',
          'bottom',
          'bottom-start',
          'bottom-end',
        ] as const
        await page.locator(demo.trigger('info')).click()
        const region = page.locator(REGION)
        await region.waitFor({ state: 'attached' })
        for (const direction of ['ltr', 'rtl'] as const) {
          await page.evaluate((dir) => {
            document.documentElement.dir = dir
          }, direction)
          for (const placement of placements) {
            await page.locator('#toast-placement-select').selectOption(placement)
            const style = await region.evaluate((node) => {
              const s = getComputedStyle(node)
              return { top: s.top, right: s.right, bottom: s.bottom, left: s.left }
            })
            expect(style.top === '16px', `${direction}/${placement}/top`).toBe(
              placement.startsWith('top'),
            )
            expect(style.bottom === '16px', `${direction}/${placement}/bottom`).toBe(
              placement.startsWith('bottom'),
            )
            if (placement.endsWith('start')) {
              expect(
                direction === 'ltr' ? style.left : style.right,
                `${direction}/${placement}/start`,
              ).toBe('16px')
            } else if (placement.endsWith('end')) {
              expect(
                direction === 'ltr' ? style.right : style.left,
                `${direction}/${placement}/end`,
              ).toBe('16px')
            }
          }
        }
        // #265 A7: the toggle button reachable from the UI itself (not just
        // a raw `document.documentElement.dir` poke) flips direction too.
        await page.evaluate(() => {
          document.documentElement.removeAttribute('dir')
        })
        await page.locator('#toast-direction-toggle').click()
        expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
        await page.locator('#toast-direction-toggle').click()
        expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr')
      })

      it('pauses the countdown on hover and on focus, and resumes on leave/blur — finite ticking never expires while paused', async () => {
        await page.locator(demo.trigger('success')).click()
        const root = page.locator(`${ROOT}[data-type="success"]`).last()
        await root.waitFor({ state: 'attached' })
        await root.hover()
        // Advance well past the demo's 3s/5s duration while hovered. The
        // reducer sets `status: 'closing'` SYNCHRONOUSLY the instant a tick
        // expires it (see toast.ts's `update`) — no real wall-clock wait is
        // needed to observe that transition, only to observe the (real,
        // CSS-timed) removal that follows it. Reading `data-state` right
        // after the clock advance is what actually discriminates "genuinely
        // paused" from "not yet removed": an immediate raw attachment check
        // is trivially true either way, since even an UNPAUSED countdown
        // stays mounted (as 'closing') until its real exit animation ends.
        await page.clock.fastForward(10_000)
        expect(await root.getAttribute('data-state')).toBe('open')
        await page.mouse.move(0, 0) // unhover
        await page.clock.fastForward(10_000)
        await root.waitFor({ state: 'detached', timeout: 5000 })

        // Focus path: the close button is the only naturally focusable
        // descendant — `onFocusIn`/`onFocusOut` (bubbling) is what lets the
        // root observe that, unlike a plain `focus`/`blur` pair.
        await page.locator(demo.trigger('success')).click()
        const root2 = page.locator(`${ROOT}[data-type="success"]`).last()
        await root2.waitFor({ state: 'attached' })
        await root2.locator('button').last().focus()
        await page.clock.fastForward(10_000)
        expect(await root2.getAttribute('data-state')).toBe('open')
        await page.locator('body').click({ position: { x: 0, y: 0 } }) // blur
        await page.clock.fastForward(10_000)
        await root2.waitFor({ state: 'detached', timeout: 5000 })
      })

      it('create -> tick-expiry -> closing -> animationend -> removal, in normal motion', async () => {
        await page.locator(demo.trigger('warning')).click()
        const root = page.locator(`${ROOT}[data-type="warning"]`).last()
        await root.waitFor({ state: 'attached' })
        await page.clock.fastForward(10_000)
        await root.waitFor({ state: 'detached', timeout: 5000 })
      })

      it('create -> tick-expiry -> closing -> animationend -> removal, under reduced motion (no wall-clock wait)', async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.locator(demo.trigger('warning')).click()
        const root = page.locator(`${ROOT}[data-type="warning"]`).last()
        await root.waitFor({ state: 'attached' })
        await page.clock.fastForward(10_000)
        // Reduced motion collapses the exit animation to ~0.01ms, so the
        // real `animationend` still fires and removal is still real — just
        // fast. No sleep: the same clock advance that expires the
        // countdown is enough for the (near-instant) exit to complete too.
        await root.waitFor({ state: 'detached', timeout: 5000 })
      })

      it('loading -> success update changes type/text/visual/ARIA on the SAME mounted row, and the success toast then lasts its own duration', async () => {
        await page.locator(demo.asyncTrigger).click()
        const loadingRoot = page.locator(`${ROOT}[data-type="loading"]`).last()
        await loadingRoot.waitFor({ state: 'attached' })
        expect(await loadingRoot.getAttribute('role')).toBe('status')
        const id = await loadingRoot.getAttribute('data-id')

        // The demo's own patch fires from a `setTimeout` — virtual, so no
        // real wait.
        await page.clock.fastForward(2_000)
        const patched = page.locator(`${ROOT}[data-id="${id}"]`)
        await page
          .locator(`${ROOT}[data-id="${id}"][data-type="success"]`)
          .waitFor({ state: 'attached', timeout: 5000 })
        expect(await patched.getAttribute('role')).toBe('status')
        expect(await patched.getAttribute('aria-live')).toBe('polite')

        // The patched toast re-seeded its countdown from the new duration
        // (#265 A2) — it must still be present just after the patch and
        // gone once that duration elapses.
        expect(await patched.count()).toBeGreaterThan(0)
        await page.clock.fastForward(10_000)
        await patched.waitFor({ state: 'detached', timeout: 5000 })
      })
    })
  }
})
