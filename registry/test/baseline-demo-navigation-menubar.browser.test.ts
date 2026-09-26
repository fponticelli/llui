// @vitest-environment node

// #265 finding 9 — real-Chromium proof that the BASELINE demo's actual
// mounted NavigationMenu and Menubar (examples/components-demo/src/sections/
// surfaces.ts) deliver the accessibility tree, keyboard traversal, submenu
// edge-flip, and focus-unwind behavior the machines themselves implement —
// not a synthetic fixture. Every id below is one this test read off the REAL
// rendered page (`nav-demo:trigger:file`, `menubar-demo:view:trigger`, …),
// and every part bag exercised is the one `surfaces.ts` actually spreads
// (`...nv.item(...).trigger`, `...mb.menuTrigger(id)`, …) — this file makes
// no assertions against a hand-built approximation of either component.
//
// Follows the pattern `registry/test/navigation-data-live-demos.browser.test.ts`
// (the #264 lane) established: a real Vite dev server rooted at the demo
// directory (so its own `vite.config.ts` — `@llui/vite-plugin` + Tailwind —
// applies exactly as it does for `pnpm dev`/`build`), a real Chromium page,
// and `page.evaluate` driving the DOM with raw `HTMLElement.focus()` /
// `KeyboardEvent`s. That file's own `sourceAliasesFromExports` helper
// (`scripts/lib/vite-source-aliases.mjs`) does not exist on this branch, so
// this file resolves `@llui/*` the ordinary way — through the workspace's
// `node_modules` symlinks and each package's BUILT `dist/` output (already
// current: `pnpm --filter @llui/components build` runs ahead of this suite
// in `verify`/CI) — rather than aliasing straight to `src/`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

describe('baseline demo NavigationMenu + Menubar in Chromium (#265 finding 9)', () => {
  let browser: Browser
  let server: ViteDevServer
  let url: string
  let page: Page

  beforeAll(async () => {
    server = await createServer({
      root: resolve(repoRoot, 'examples/components-demo'),
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port')
    url = `http://127.0.0.1:${address.port}/`
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
    await page.goto(url)
    await page.locator('#nav-demo').waitFor({ state: 'attached' })
    // Kill every transition/animation so a keyboard-driven state change is
    // observable in the SAME evaluate() call rather than racing a CSS
    // transition's finish event (the hidden-tab/partial-transition trap this
    // repo's styling rules warn about — irrelevant here since the tab is
    // visible, but the animation itself would still make timing racy).
    await page.addStyleTag({
      content:
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
  })

  it('NavigationMenu renders a real nav landmark, list/link anatomy, and disclosure wiring', async () => {
    const tree = await page.evaluate(() => {
      const nav = document.getElementById('nav-demo')!
      const fileTrigger = document.getElementById('nav-demo:trigger:file')!
      const helpTrigger = document.getElementById('nav-demo:trigger:help')!
      const fileContent = document.getElementById('nav-demo:content:file')!
      const fileLinks = [...fileContent.querySelectorAll('a')]
      return {
        navTag: nav.tagName,
        ariaLabel: nav.getAttribute('aria-label'),
        listCount: nav.querySelectorAll('ul').length,
        fileTrigger: {
          tag: fileTrigger.tagName,
          ariaExpanded: fileTrigger.getAttribute('aria-expanded'),
          ariaControls: fileTrigger.getAttribute('aria-controls'),
        },
        // A leaf item (no children) publishes neither — it is a plain link
        // trigger, not a disclosure button.
        helpTrigger: {
          ariaExpanded: helpTrigger.getAttribute('aria-expanded'),
          ariaControls: helpTrigger.getAttribute('aria-controls'),
        },
        fileContentIsList: fileContent.querySelector('ul > li > a') !== null,
        fileLinkHrefs: fileLinks.map((a) => a.getAttribute('href')),
        fileLinkTexts: fileLinks.map((a) => a.textContent),
        indicatorPresent:
          nav.querySelector('[data-scope="navigation-menu"][data-part="indicator"]') !== null,
      }
    })

    expect(tree.navTag).toBe('NAV')
    expect(tree.ariaLabel).toBeTruthy()
    expect(tree.listCount).toBeGreaterThan(0)
    expect(tree.fileTrigger.tag).toBe('BUTTON')
    expect(tree.fileTrigger.ariaExpanded).toBe('false')
    expect(tree.fileTrigger.ariaControls).toBe('nav-demo:content:file')
    expect(tree.helpTrigger.ariaExpanded).toBeNull()
    expect(tree.helpTrigger.ariaControls).toBeNull()
    expect(tree.fileContentIsList).toBe(true)
    expect(tree.fileLinkHrefs.length).toBeGreaterThan(0)
    expect(tree.fileLinkHrefs.every((href) => href !== null)).toBe(true)
    expect(tree.fileLinkTexts).toContain('New File')
    expect(tree.indicatorPresent).toBe(true)
  })

  it('NavigationMenu: ArrowRight opens a branch and moves the indicator, ArrowLeft closes it', async () => {
    const result = await page.evaluate(() => {
      const fileTrigger = document.getElementById('nav-demo:trigger:file') as HTMLElement
      const fileContent = document.getElementById('nav-demo:content:file') as HTMLElement
      const indicator = document.querySelector(
        '[data-scope="navigation-menu"][data-part="indicator"]',
      ) as HTMLElement
      fileTrigger.focus()
      const before = {
        expanded: fileTrigger.getAttribute('aria-expanded'),
        hidden: fileContent.hidden,
      }
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const afterOpen = {
        expanded: fileTrigger.getAttribute('aria-expanded'),
        hidden: fileContent.hidden,
        indicatorState: indicator.getAttribute('data-state'),
      }
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const afterClose = {
        expanded: fileTrigger.getAttribute('aria-expanded'),
        hidden: fileContent.hidden,
        indicatorState: indicator.getAttribute('data-state'),
      }
      return { before, afterOpen, afterClose }
    })

    expect(result.before).toEqual({ expanded: 'false', hidden: true })
    expect(result.afterOpen).toEqual({ expanded: 'true', hidden: false, indicatorState: 'visible' })
    expect(result.afterClose).toEqual({ expanded: 'false', hidden: true, indicatorState: 'hidden' })
  })

  it('Menubar renders a real menubar/menuitem tree with one roving tab stop', async () => {
    const tree = await page.evaluate(() => {
      const root = document.querySelector('[data-scope="menubar"][data-part="root"]')!
      const triggers = [
        ...document.querySelectorAll<HTMLElement>('[data-scope="menubar"][data-part="trigger"]'),
      ]
      return {
        role: root.getAttribute('role'),
        ariaLabel: root.getAttribute('aria-label'),
        triggers: triggers.map((t) => ({
          role: t.getAttribute('role'),
          ariaHaspopup: t.getAttribute('aria-haspopup'),
          tabindex: t.getAttribute('tabindex'),
        })),
      }
    })

    expect(tree.role).toBe('menubar')
    expect(tree.ariaLabel).toBeTruthy()
    expect(tree.triggers.length).toBeGreaterThanOrEqual(3)
    expect(tree.triggers.every((t) => t.role === 'menuitem' && t.ariaHaspopup === 'menu')).toBe(
      true,
    )
    // Roving tabindex: EXACTLY one trigger is in the Tab sequence at a time.
    expect(tree.triggers.filter((t) => t.tabindex === '0')).toHaveLength(1)
    expect(tree.triggers.filter((t) => t.tabindex === '-1')).toHaveLength(tree.triggers.length - 1)
  })

  it('Menubar: opening a menu moves focus into it, and ArrowRight in open mode crosses to the next menu', async () => {
    const result = await page.evaluate(async () => {
      const fileTrigger = document.getElementById('menubar-demo:file:trigger') as HTMLElement
      fileTrigger.click()
      await new Promise((r) => setTimeout(r, 0))
      const fileContent = document.getElementById('menubar-demo:file:content')
      const opened = {
        fileExpanded: fileTrigger.getAttribute('aria-expanded'),
        focusInFileContent: fileContent?.contains(document.activeElement) ?? false,
      }
      // APG cross-menu ArrowRight: focus is inside File's content, so the
      // arrow must reach the BAR (via `contentKeyDown`'s defaultPrevented
      // fallthrough), close File, and open+focus Edit.
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const editTrigger = document.getElementById('menubar-demo:edit:trigger')!
      const editContent = document.getElementById('menubar-demo:edit:content')
      return {
        opened,
        afterArrowRight: {
          fileExpanded: fileTrigger.getAttribute('aria-expanded'),
          editExpanded: editTrigger.getAttribute('aria-expanded'),
          focusInEditContent: editContent?.contains(document.activeElement) ?? false,
        },
      }
    })

    expect(result.opened).toEqual({ fileExpanded: 'true', focusInFileContent: true })
    expect(result.afterArrowRight).toEqual({
      fileExpanded: 'false',
      editExpanded: 'true',
      focusInEditContent: true,
    })
  })

  it('Menubar: Escape unwinds one level at a time — submenu first, then the menu, restoring focus to the trigger', async () => {
    const result = await page.evaluate(async () => {
      const viewTrigger = document.getElementById('menubar-demo:view:trigger') as HTMLElement
      viewTrigger.click()
      await new Promise((r) => setTimeout(r, 0))
      const viewContent = document.getElementById('menubar-demo:view:content')!
      const subTrigger = viewContent.querySelector('[data-part="subtrigger"]') as HTMLElement
      subTrigger.focus()
      subTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const subOpen = {
        subExpanded: subTrigger.getAttribute('aria-expanded'),
        subContentPresent: viewContent.querySelector('[data-part="subcontent"]') !== null,
      }
      // Escape #1: unwinds the submenu ONLY — the View menu stays open.
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const afterFirstEscape = {
        viewExpanded: viewTrigger.getAttribute('aria-expanded'),
        subContentPresent: viewContent.querySelector('[data-part="subcontent"]') !== null,
        focusOnSubTrigger: document.activeElement === subTrigger,
      }
      // Escape #2: closes the View menu itself and returns REAL DOM focus to
      // its top-level trigger.
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const afterSecondEscape = {
        viewExpanded: viewTrigger.getAttribute('aria-expanded'),
        focusOnViewTrigger: document.activeElement === viewTrigger,
      }
      return { subOpen, afterFirstEscape, afterSecondEscape }
    })

    expect(result.subOpen).toEqual({ subExpanded: 'true', subContentPresent: true })
    expect(result.afterFirstEscape).toEqual({
      viewExpanded: 'true',
      subContentPresent: false,
      focusOnSubTrigger: true,
    })
    expect(result.afterSecondEscape).toEqual({ viewExpanded: 'false', focusOnViewTrigger: true })
  })

  it('Menubar submenu flips side at a real viewport edge — proved against the actual demo layout, not a synthetic fixture', async () => {
    // #265 finding 7's other proof (`menu-submenu-edge-flip.browser.test.ts`)
    // exercises `watchSubmenuPositioning` against a minimal hand-built
    // fixture. This measures the SAME behavior through the demo's actual
    // Menubar composition (`renderMenuOverlay` -> `watchSubmenuPositioning`,
    // wired via `onMount` in `surfaces.ts`) at a viewport narrow enough that
    // the View menu's real DOM position leaves no room on the right —
    // measured directly: at this width the submenu's preferred-side box
    // would overflow past `window.innerWidth`, so a real flip is required,
    // not merely permitted.
    await page.setViewportSize({ width: 380, height: 900 })
    const result = await page.evaluate(async () => {
      const viewTrigger = document.getElementById('menubar-demo:view:trigger') as HTMLElement
      viewTrigger.click()
      await new Promise((r) => setTimeout(r, 0))
      const viewContent = document.getElementById('menubar-demo:view:content')!
      const subTrigger = viewContent.querySelector('[data-part="subtrigger"]') as HTMLElement
      subTrigger.focus()
      subTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 80))
      const subContent = viewContent.querySelector('[data-part="subcontent"]') as HTMLElement
      const rect = subContent.getBoundingClientRect()
      return {
        side: subContent.getAttribute('data-side'),
        withinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
      }
    })

    expect(result.side).toBe('left')
    expect(result.withinViewport).toBe(true)
  })

  // RTL: both machines already flip ArrowLeft/ArrowRight meaning under
  // `dir: 'rtl'` (`navigation-menu.test.ts`'s `setDir`/`init({ dir: 'rtl' })`
  // cases and `menubar.integration.test.ts`'s `{ dir: 'rtl', nextKey:
  // 'ArrowLeft', … }` table already pin that CONTRACT at the component level
  // — this is not an untested behavior). What is NOT proven here is the
  // BASELINE DEMO composition responding to a LIVE direction change: neither
  // `navigationMenu.init()` nor `menubar.init({ … })` in
  // `examples/components-demo/src/sections/surfaces.ts` takes a `dir` option
  // today, and the demo has no toggle wired that dispatches `setDir` (or
  // flips `document.documentElement.dir`) at runtime. Wiring one now would
  // mean inventing a demo-local, ad hoc direction-sync mechanism — exactly
  // the thing issue #264's shared SSR-safe `directionSync` seam exists to be
  // adopted here as ONE seam instead of a second one. Per this issue's own
  // scope note ("do NOT create a competing resolver… phase 2 will adopt that
  // seam after #264 merges"), this case is `.skip`'d rather than faked, and
  // should be un-skipped as part of wiring `directionSync` into both demos.
  it.skip('demo-level RTL key-mapping — depends on the #264 directionSync seam, not yet present on this branch', () => {
    expect(true).toBe(true)
  })
})
