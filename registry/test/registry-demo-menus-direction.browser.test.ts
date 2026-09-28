// @vitest-environment node

// #265 finding 6 remainder — real-Chromium proof that the REGISTRY demo's
// actual mounted Menu/ContextMenu/Menubar (examples/registry-demo/src/
// sections/menus.ts) deliver consistent direction across keyboard handling
// AND floating submenu geometry, now that `menu-machine.ts` (shared by
// `menu.ts`/`context-menu.ts`, delegated to by `menubar.ts`) is migrated onto
// the shared `@llui/interactions` direction-sync seam. Mirrors
// `registry/test/baseline-demo-navigation-menubar.browser.test.ts`'s pattern
// for the OTHER demo (`examples/components-demo`), so both demos get a real
// mounted proof rather than one standing in for the other.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../scripts/lib/prebuilt-fixture.mjs'
import { resolve } from 'node:path'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const repoRoot = resolve(import.meta.dirname, '../..')

describe('registry demo Menu/ContextMenu/Menubar direction consistency in Chromium (#265 finding 6)', () => {
  let browser: Browser
  let build: PrebuiltFixture
  let url: string
  let page: Page

  beforeAll(async () => {
    // Built once and served static (`scripts/lib/prebuilt-fixture.mjs`) rather
    // than by a Vite dev server: a dev server compiled the app on demand inside
    // the first test to navigate, re-sent its whole unbundled module graph to
    // every fresh page, and shared the example's dependency-optimizer cache with
    // every concurrent suite serving the same example (see that module's header).
    // The build replaces the warm-up page this hook used to load (#265 LOW).
    ;[build, browser] = await Promise.all([
      prebuildFixture({
        root: resolve(repoRoot, 'examples/registry-demo'),
        inputs: ['index.html'],
      }),
      hermetic.launch({ headless: true }),
    ])
    url = build.url('/')
  }, 60_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await build?.close()
  })

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
    await page.goto(url)
    await page.locator('#demo-menubar').waitFor({ state: 'attached' })
    await page.addStyleTag({
      content:
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
  })

  it('Menubar: root-level roving focus moves between sibling triggers, and a runtime `<html dir>` flip (no reload) swaps which arrow key moves it', async () => {
    const before = await page.evaluate(() => {
      const fileTrigger = document.getElementById('demo-menubar:file:trigger') as HTMLElement
      const editTrigger = document.getElementById('demo-menubar:edit:trigger') as HTMLElement
      fileTrigger.focus()
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      return { focusedEdit: document.activeElement === editTrigger }
    })
    expect(before).toEqual({ focusedEdit: true })

    const after = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      await new Promise((r) => setTimeout(r, 0))
      const fileTrigger = document.getElementById('demo-menubar:file:trigger') as HTMLElement
      const editTrigger = document.getElementById('demo-menubar:edit:trigger') as HTMLElement
      // Under rtl, logical "next sibling" (File -> Edit) is physical ArrowLeft.
      fileTrigger.focus()
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const movedWithLeft = document.activeElement === editTrigger
      // The OLD (ltr) forward key must now be a no-op in the forward direction.
      editTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const movedBackWithRight = document.activeElement === fileTrigger
      document.documentElement.removeAttribute('dir')
      return { movedWithLeft, movedBackWithRight }
    })
    expect(after).toEqual({ movedWithLeft: true, movedBackWithRight: true })
  })

  it('Menubar: NESTED submenu ownership (File > Export) opens/closes with the correct arrow, matching root-level direction', async () => {
    const ltr = await page.evaluate(async () => {
      const fileTrigger = document.getElementById('demo-menubar:file:trigger') as HTMLElement
      fileTrigger.click()
      await new Promise((r) => setTimeout(r, 0))
      const exportTrigger = document.getElementById(
        'demo-menubar:file:sub:export:trigger',
      ) as HTMLElement
      exportTrigger.focus()
      exportTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const opened = exportTrigger.getAttribute('aria-expanded')
      exportTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const closed = exportTrigger.getAttribute('aria-expanded')
      return { opened, closed }
    })
    expect(ltr).toEqual({ opened: 'true', closed: 'false' })

    const rtl = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      await new Promise((r) => setTimeout(r, 0))
      const exportTrigger = document.getElementById(
        'demo-menubar:file:sub:export:trigger',
      ) as HTMLElement
      exportTrigger.focus()
      // Under rtl, physical ArrowLeft opens (logical forward).
      exportTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const opened = exportTrigger.getAttribute('aria-expanded')
      exportTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const closed = exportTrigger.getAttribute('aria-expanded')
      document.documentElement.removeAttribute('dir')
      return { opened, closed }
    })
    expect(rtl).toEqual({ opened: 'true', closed: 'false' })
  })

  it('Dropdown Menu submenu (Team) opens on the correct side at a real viewport edge under RTL', async () => {
    // Narrow enough that a submenu's preferred LEFT side (the rtl-correct
    // side, away from the reading-direction inline-start edge) still fits —
    // this proves the SIDE is chosen from direction, not merely permitted by
    // available space. The trigger sits near the left edge of the viewport,
    // so an ltr-preferred RIGHT side would also fit — the assertion is on
    // which side is CHOSEN.
    await page.setViewportSize({ width: 500, height: 900 })
    const result = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      await new Promise((r) => setTimeout(r, 0))
      const trigger = document.getElementById('demo-dropdown:trigger') as HTMLElement
      trigger.click()
      await new Promise((r) => setTimeout(r, 0))
      const teamTrigger = document.getElementById('demo-dropdown:sub:team:trigger') as HTMLElement
      teamTrigger.focus()
      // Under rtl, physical ArrowLeft opens the submenu (logical forward).
      teamTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 80))
      const subContent = document.getElementById('demo-dropdown:sub:team:content') as HTMLElement
      const rect = subContent.getBoundingClientRect()
      const result = {
        side: subContent.getAttribute('data-side'),
        withinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
      }
      document.documentElement.removeAttribute('dir')
      return result
    })

    expect(result.side).toBe('left')
    expect(result.withinViewport).toBe(true)
  })

  it('Context Menu: root open direction and delegated submenu (Share) agree under an EXPLICIT dir, independent of the page', async () => {
    // The context-menu region here has no explicit `dir` configured, so this
    // exercises the DOM-sourced path consistently across root keyboard
    // handling and the submenu's floating geometry — both must read the SAME
    // resolved direction (#265 finding 6), never two independently-resolved
    // ones that could disagree.
    await page.setViewportSize({ width: 1024, height: 900 })
    const result = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      await new Promise((r) => setTimeout(r, 0))
      const trigger = document.getElementById('demo-context:trigger') as HTMLElement
      // Open near the CENTER of the viewport, deliberately far from any edge,
      // so the chosen side reflects the direction PREFERENCE, not a flip
      // forced by insufficient room on either side.
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 500,
          clientY: 400,
        }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const shareTrigger = document.getElementById('demo-context:sub:share:trigger') as HTMLElement
      shareTrigger.focus()
      shareTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 40))
      const subContent = document.getElementById('demo-context:sub:share:content') as HTMLElement
      const result = {
        opened: shareTrigger.getAttribute('aria-expanded'),
        side: subContent.getAttribute('data-side'),
      }
      document.documentElement.removeAttribute('dir')
      return result
    })

    expect(result.opened).toBe('true')
    expect(result.side).toBe('left')
  })
})
