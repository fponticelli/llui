// @vitest-environment node

/**
 * Real-Chromium proof of the Toast contract in a live, consumer-driven
 * composition on BOTH styling paths — the Baseline theme's
 * (`examples/baseline-css/src/test-fixtures/compositions/toast.ts`, in the
 * Tailwind-free Baseline consumer) and the Registry skins'
 * (`examples/registry-demo`, the copied-source sync fixture) — not only the
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
import type { Browser, Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../scripts/lib/prebuilt-fixture.mjs'
import { resolve } from 'node:path'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const repoRoot = resolve(import.meta.dirname, '../..')

interface Demo {
  readonly path: 'baseline' | 'registryTailwind'
  readonly dir: string
  /** The HTML entry, relative to `dir`. */
  readonly input: string
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
    dir: 'examples/baseline-css',
    input: 'src/test-fixtures/compositions.html',
    trigger: (type) => `#toast-trigger-${type}`,
    asyncTrigger: '#toast-trigger-async',
  },
  {
    path: 'registryTailwind',
    dir: 'examples/registry-demo',
    input: 'index.html',
    trigger: (type) => `[data-toast-demo-type="${type}"]`,
    asyncTrigger: '[data-toast-demo-type="async"]',
  },
]

// Built once and served static (`scripts/lib/prebuilt-fixture.mjs`) rather
// than by a Vite dev server: a dev server compiled the app on demand inside
// the first test to navigate, re-sent its whole unbundled module graph to
// every fresh page, and shared the example's dependency-optimizer cache with
// every concurrent suite serving the same example (see that module's header).
function buildExample(demo: Demo): Promise<PrebuiltFixture> {
  return prebuildFixture({ root: resolve(repoRoot, demo.dir), inputs: [demo.input] })
}

declare global {
  interface Window {
    /** Every `data-state` each toast row (by `data-id`) has taken, in order,
     * with `removed` appended when the row leaves the DOM. */
    __toastStates?: Record<string, string[]>
  }
}

/**
 * Record each toast row's lifecycle as it HAPPENS, from a MutationObserver:
 * reading `data-state` after the fact misses a `closing` phase that a
 * reduced-motion exit ends within the same frame.
 */
async function recordToastStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const states: Record<string, string[]> = {}
    window.__toastStates = states
    const ROOT = '[data-scope="toast"][data-part="root"]'
    const note = (el: Element, value: string): void => {
      const id = el.getAttribute('data-id')
      if (id === null) return
      const list = (states[id] ??= [])
      if (list[list.length - 1] !== value) list.push(value)
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const el = record.target as Element
          if (el.matches(ROOT)) note(el, el.getAttribute('data-state') ?? '')
          continue
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          for (const el of [node, ...node.querySelectorAll(ROOT)]) {
            if (el.matches(ROOT)) note(el, el.getAttribute('data-state') ?? '')
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue
          for (const el of [node, ...node.querySelectorAll(ROOT)]) {
            if (el.matches(ROOT)) note(el, 'removed')
          }
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
  })
}

const statesOf = (page: Page, id: string): Promise<string[] | undefined> =>
  page.evaluate((key) => window.__toastStates?.[key], id)

describe('live Toast compositions in Chromium, both paths (#265 task item 1)', () => {
  let browser: Browser
  let builds: PrebuiltFixture[] = []
  const urls: Record<string, string> = {}

  beforeAll(async () => {
    const [built, launched] = await Promise.all([
      Promise.all(DEMOS.map((demo) => buildExample(demo))),
      hermetic.launch({ headless: true }),
    ])
    builds = built
    browser = launched
    DEMOS.forEach((demo, i) => (urls[demo.path] = built[i]!.url(demo.input)))
    // One build per path: the compile a dev server used to spread over the
    // first test of each is paid here, once, under the hook's budget.
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(builds.map((build) => build.close()))
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
        await recordToastStates(page)
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
        // This test is about each type's own parts, not exit motion (the
        // expiry tests below cover both motion modes). Reduced motion keeps
        // its six dismissals cheap: ~3 s of real exit animations timed out
        // at 30 s under a parallel `pnpm -r run test`.
        await page.emulateMedia({ reducedMotion: 'reduce' })
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

      // #265 G6: hover and focus are independent pause reasons. With ONE
      // `paused` flag, leaving with the pointer resumed a toast whose close
      // button still held keyboard focus (and vice versa).
      it('stays paused while EITHER hover or focus remains — mixed hover + focus, both release orders', async () => {
        const rowFor = async (): Promise<ReturnType<Page['locator']>> => {
          await page.locator(demo.trigger('success')).click()
          const row = page.locator(`${ROOT}[data-type="success"]`).last()
          await row.waitFor({ state: 'attached' })
          return row
        }
        const pausedAfter = async (row: ReturnType<Page['locator']>): Promise<void> => {
          await page.clock.fastForward(10_000)
          expect(await row.getAttribute('data-state')).toBe('open')
        }

        // Order 1: focus, hover, LEAVE pointer (focus still inside) -> paused;
        // then blur -> expires.
        const first = await rowFor()
        await first.locator('button').last().focus()
        await first.hover()
        await page.mouse.move(0, 0)
        await pausedAfter(first)
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.clock.fastForward(10_000)
        await first.waitFor({ state: 'detached', timeout: 5000 })

        // Order 2: hover, focus, BLUR (pointer still over it) -> paused; then
        // leave -> expires.
        const second = await rowFor()
        await second.hover()
        await second.locator('button').last().focus()
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await pausedAfter(second)
        await page.mouse.move(0, 0)
        await page.clock.fastForward(10_000)
        await second.waitFor({ state: 'detached', timeout: 5000 })
      })

      it('create -> tick-expiry -> closing -> animationend -> removal, in normal motion', async () => {
        await page.locator(demo.trigger('warning')).click()
        const root = page.locator(`${ROOT}[data-type="warning"]`).last()
        await root.waitFor({ state: 'attached' })
        const id = (await root.getAttribute('data-id'))!
        await page.clock.fastForward(10_000)
        await root.waitFor({ state: 'detached', timeout: 5000 })
        // Every phase really happened, in order: the row stayed mounted as
        // `closing` until its own exit animation ended.
        expect(await statesOf(page, id)).toEqual(['open', 'closing', 'removed'])
      })

      it('create -> tick-expiry -> closing -> animationend -> removal, under reduced motion (no wall-clock wait)', async () => {
        // This test is about each type's own parts, not exit motion (the
        // expiry tests below cover both motion modes). Reduced motion keeps
        // its six dismissals cheap: ~3 s of real exit animations timed out
        // at 30 s under a parallel `pnpm -r run test`.
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.locator(demo.trigger('warning')).click()
        const root = page.locator(`${ROOT}[data-type="warning"]`).last()
        await root.waitFor({ state: 'attached' })
        const id = (await root.getAttribute('data-id'))!
        await page.clock.fastForward(10_000)
        // Reduced motion collapses the exit animation to ~0.01ms, so the
        // real `animationend` still fires and removal is still real — just
        // fast. No sleep: the same clock advance that expires the
        // countdown is enough for the (near-instant) exit to complete too.
        // (The DISCRIMINATING proof that the duration itself actually
        // collapsed — not just "removed within some timeout", which a
        // normal-speed ~150ms exit would also pass — lives in
        // `menus-overlays-live-render.browser.test.ts`'s deterministic
        // `closing` scenario case, which mounts already-closing rather than
        // racing a live removal.)
        await root.waitFor({ state: 'detached', timeout: 5000 })
        expect(await statesOf(page, id)).toEqual(['open', 'closing', 'removed'])
      })

      it('a loading toast is sticky: no amount of elapsed time dismisses it', async () => {
        await page.locator(demo.trigger('loading')).click()
        const root = page.locator(`${ROOT}[data-type="loading"]`).last()
        await root.waitFor({ state: 'attached' })
        const id = (await root.getAttribute('data-id'))!
        await page.clock.fastForward(60_000)
        expect(await statesOf(page, id)).toEqual(['open'])
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

        // E5 — the patch RE-SEEDS the countdown from the new duration (3000ms,
        // both demos). A sticky toast's remainingMs sat at 0; without the
        // re-seed the first tick after the patch dismisses it. So: still
        // `open` just short of 3000ms after the patch, `closing` just after.
        // The patch fired at 1200ms and we stand at 2000ms, so +1800ms is
        // 2600ms after it, +1000ms more is 3600ms (the demo ticks every
        // 250ms, hence the margins).
        await page.clock.fastForward(1_800)
        expect(await statesOf(page, id!)).toEqual(['open'])
        await page.clock.fastForward(1_000)
        await patched.waitFor({ state: 'detached', timeout: 5000 })
        expect(await statesOf(page, id!)).toEqual(['open', 'closing', 'removed'])
      })
    })
  }
})
