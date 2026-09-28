// @vitest-environment node

// #265 finding 9 — real-Chromium proof that a consumer's BASELINE-path
// NavigationMenu and Menubar deliver the accessibility tree, keyboard
// traversal, submenu edge-flip, and focus-unwind behavior the machines
// themselves implement. The compositions live in the Tailwind-free Baseline
// consumer (`examples/baseline-css/src/test-fixtures/compositions/menus.ts`,
// moved there from the retired `examples/components-demo`): a `nav` landmark
// with list/link anatomy and a leaf item, and a three-menu Menubar with an
// engine-owned submenu. Every id below is one this test reads off the REAL
// rendered page (`nav-demo:trigger:file`, `menubar-demo:view:trigger`, …),
// and every part bag exercised is the one that composition actually spreads
// (`...nv.item(...).trigger`, `...mb.menuTrigger(id)`, …).
//
// The fixture is BUILT once through the example's own `vite.config.ts` and
// served static (`scripts/lib/prebuilt-fixture.mjs`); `page.evaluate` drives
// the DOM with raw `HTMLElement.focus()` / `KeyboardEvent`s. `@llui/*`
// resolves the ordinary way — through the workspace's `node_modules` symlinks
// and each package's BUILT `dist/` output (current: the packages build ahead
// of this suite in `verify`/CI).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../scripts/lib/prebuilt-fixture.mjs'
import { resolve } from 'node:path'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const repoRoot = resolve(import.meta.dirname, '../..')
const FIXTURE = 'src/test-fixtures/compositions.html'

describe('Baseline NavigationMenu + Menubar in Chromium (#265 finding 9)', () => {
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
    ;[build, browser] = await Promise.all([
      prebuildFixture({ root: resolve(repoRoot, 'examples/baseline-css'), inputs: [FIXTURE] }),
      hermetic.launch({ headless: true }),
    ])
    url = build.url(FIXTURE)
  }, 60_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await build?.close()
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
      // `subtrigger` is still rendered INLINE inside `viewContent` (a real
      // subTrigger + `menubar.subOverlay`'s wrapper divs, #265 A4); the
      // engine-owned overlay itself portals its `subcontent` to `body`
      // exactly like the root content does, so it is looked up globally.
      const subTrigger = viewContent.querySelector('[data-part="subtrigger"]') as HTMLElement
      subTrigger.focus()
      subTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const subOpen = {
        subExpanded: subTrigger.getAttribute('aria-expanded'),
        subContentPresent: document.querySelector('[data-part="subcontent"]') !== null,
      }
      // Escape #1: unwinds the submenu ONLY — the View menu stays open.
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      await new Promise((r) => setTimeout(r, 0))
      const afterFirstEscape = {
        viewExpanded: viewTrigger.getAttribute('aria-expanded'),
        subContentPresent: document.querySelector('[data-part="subcontent"]') !== null,
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

  it('Menubar submenu flips side at a real viewport edge — proved against a real application layout, not a minimal fixture', async () => {
    // #265 A4's other proof (`menu-submenu-edge-flip.browser.test.ts`)
    // exercises `menu.subOverlay` against a minimal hand-built fixture. This
    // measures the SAME behavior through a real application Menubar
    // composition (`menubar.overlay` -> `menubar.subOverlay`, wired via
    // `renderMenubarItems` in `compositions/menus.ts`) at a viewport narrow enough that
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
      const subContent = document.querySelector('[data-part="subcontent"]') as HTMLElement
      const rect = subContent.getBoundingClientRect()
      return {
        side: subContent.getAttribute('data-side'),
        withinViewport: rect.left >= 0 && rect.right <= window.innerWidth,
      }
    })

    expect(result.side).toBe('left')
    expect(result.withinViewport).toBe(true)
  })

  // #265 finding 6, un-skipped: NavigationMenu is migrated onto the shared
  // `@llui/interactions` direction-sync seam (`../utils/direction.js`) —
  // `connect()` now places a `directionSync` Mountable
  // (`directionSyncMount(opts.id, dir => send({type:'syncDomDir', dir}))`)
  // that observes the mounted root's own live ancestor `dir` and dispatches
  // `syncDomDir`, exactly like `tabs`/`carousel`/`pagination`. This proves the
  // BASELINE composition — not just the reducer in isolation — actually
  // responds to a RUNTIME direction change with no reload: flipping
  // `<html dir>` after mount must re-derive `eventDirection` and swap which
  // arrow key opens a branch.
  it('NavigationMenu: a runtime `<html dir>` flip (no reload) swaps which arrow key opens a branch', async () => {
    const before = await page.evaluate(() => {
      const fileTrigger = document.getElementById('nav-demo:trigger:file') as HTMLElement
      const fileContent = document.getElementById('nav-demo:content:file') as HTMLElement
      fileTrigger.focus()
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const opened = {
        expanded: fileTrigger.getAttribute('aria-expanded'),
        hidden: fileContent.hidden,
      }
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      return { opened, closed: { expanded: fileTrigger.getAttribute('aria-expanded') } }
    })
    expect(before.opened).toEqual({ expanded: 'true', hidden: false })
    expect(before.closed).toEqual({ expanded: 'false' })

    const after = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      // `directionSyncMount`'s MutationObserver fires on the SAME microtask
      // queue as the attribute mutation, but is not guaranteed synchronous
      // with the assignment above — yield one tick before asserting.
      await new Promise((r) => setTimeout(r, 0))
      const fileTrigger = document.getElementById('nav-demo:trigger:file') as HTMLElement
      const fileContent = document.getElementById('nav-demo:content:file') as HTMLElement
      // Under rtl, logical ArrowRight (open) is physical ArrowLeft.
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const openedWithLeft = {
        expanded: fileTrigger.getAttribute('aria-expanded'),
        hidden: fileContent.hidden,
      }
      // The OLD (ltr) opening key must now be a no-op in the open direction —
      // it is physical ArrowRight, which under rtl means "close".
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      const afterRight = { expanded: fileTrigger.getAttribute('aria-expanded') }
      document.documentElement.removeAttribute('dir')
      return { openedWithLeft, afterRight }
    })
    expect(after.openedWithLeft).toEqual({ expanded: 'true', hidden: false })
    expect(after.afterRight).toEqual({ expanded: 'false' })
  })

  // #265 finding 6 remainder, un-skipped: `menu-machine.ts` (shared by
  // `menu.ts`/`context-menu.ts`, delegated to by `menubar.ts`) is migrated
  // onto the shared `@llui/interactions` direction-sync seam. `menubar.ts`'s
  // own `connect()` now places a `directionSync` Mountable
  // (`directionSyncMount(opts.id, dir => send({type:'syncDomDir', dir}))`)
  // observing the bar ROOT (`#menubar-demo`), and every `setDir`/`syncDomDir`
  // is propagated down into each embedded per-menu `MenuState` so a delegated
  // menu's keyboard handling and floating geometry never disagree with the
  // bar that owns it. This proves the BASELINE path's real mounted Menubar
  // composition (not the reducer in isolation) responds to a RUNTIME
  // direction change with no reload: flipping `<html dir>` after mount swaps
  // which arrow key moves the roving-tabindex focus BETWEEN sibling
  // top-level triggers (root-level ownership), exactly as NavigationMenu's
  // own runtime-flip test above proves for its branch-open key.
  it('Menubar: a runtime `<html dir>` flip (no reload) swaps which arrow key moves focus between sibling triggers', async () => {
    const before = await page.evaluate(() => {
      const fileTrigger = document.getElementById('menubar-demo:file:trigger') as HTMLElement
      const editTrigger = document.getElementById('menubar-demo:edit:trigger') as HTMLElement
      fileTrigger.focus()
      fileTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      return { focusedEdit: document.activeElement === editTrigger }
    })
    expect(before).toEqual({ focusedEdit: true })

    const after = await page.evaluate(async () => {
      document.documentElement.dir = 'rtl'
      // `directionSyncMount`'s MutationObserver fires on the SAME microtask
      // queue as the attribute mutation, but is not guaranteed synchronous
      // with the assignment above — yield one tick before asserting.
      await new Promise((r) => setTimeout(r, 0))
      const editTrigger = document.getElementById('menubar-demo:edit:trigger') as HTMLElement
      editTrigger.focus()
      // Under rtl, logical "next sibling" (File -> Edit going forward) is the
      // PHYSICAL ArrowLeft key.
      editTrigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      )
      const movedWithLeft = { onView: document.activeElement?.id === 'menubar-demo:view:trigger' }
      // The OLD (ltr) forward key must now move BACKWARD instead.
      document.getElementById('menubar-demo:view:trigger')!.focus()
      document
        .getElementById('menubar-demo:view:trigger')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        )
      const movedBackWithRight = { onEdit: document.activeElement === editTrigger }
      document.documentElement.removeAttribute('dir')
      return { movedWithLeft, movedBackWithRight }
    })
    expect(after.movedWithLeft).toEqual({ onView: true })
    expect(after.movedBackWithRight).toEqual({ onEdit: true })
  })
})
