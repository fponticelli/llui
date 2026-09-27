// @vitest-environment node

/**
 * Live-mount replacement for the deleted `registry/test/menus-overlays-styles.test.ts`
 * (#265 finding #1/#2, part 3).
 *
 * The prior suite (~1449 lines) drove `page.setContent` with a hand-written
 * static-HTML projection of the menus-overlays family, fed by
 * `registry/test/menus-overlays.fixture.ts` / `menus-overlays-baseline.fixture.ts`
 * — a "deprecated legacy projection" per this issue's own review history
 * ("the purported shared scenarios are metadata only", "raw innerHTML
 * comparison is vacuous"). It could not fail on a real adapter regression: a
 * broken `contextMenuAdapter` or a broken `menu.ts` collision middleware
 * would leave the hand-written HTML (and therefore every assertion) intact.
 *
 * This file instead mounts the REAL `BASELINE_ADAPTERS`/`REGISTRY_ADAPTERS`
 * (menus-overlays-baseline-renderer.ts / menus-overlays-scenario-renderer.ts)
 * through a real Vite dev server for each example app — the same pattern as
 * `navigation-data-live-render.browser.test.ts` (#264 item C) and this file's
 * own `menus-overlays-parity.browser.test.ts` sibling (which stayed
 * static-HTML on purpose: it tests the STYLESHEET's cross-scope density
 * contract in isolation, not any one renderer's real per-product output) —
 * and asserts on real `getBoundingClientRect()`/`getComputedStyle()` output
 * in each path's OWN isolated page (no shared style universe between
 * baseline and registryTailwind).
 *
 * Scope: every declared real scenario CASE (menus-overlays-scenarios.ts)
 * already encodes the per-product field this suite exists to prove
 * (`edge-anchor`'s x=4,y=4 virtual point for context-menu collision,
 * `top-start` for popover placement, the six real `ToastType`
 * cases and six `placement-*` cases for toast, `opening`/`closing` for every
 * four-phase presence machine). This file's job is to MOUNT those cases live
 * and assert on their real rendered output — not to invent new scenario
 * data, which already exists and is unit-tested in
 * `menus-overlays-scenarios.test.ts`.
 *
 * Per-axis environment effects (theme, direction, forced colors, motion,
 * viewport) and the per-product placement probes are proven exhaustively over
 * every declaring case in `menus-overlays-product-effects.browser.test.ts`;
 * this file keeps the product-specific geometry and interaction scenarios.
 */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { paintedColors, bucketedKey, type RGB } from './pixel-probe.js'
import { contrast, srgb8ToLinear } from '../../../../scripts/lib/oklch.mjs'
import { useMenusOverlaysLiveHarness, type LivePath } from './menus-overlays-live-harness.js'

const TOAST_TYPES = ['info', 'success', 'warning', 'error', 'loading', 'custom'] as const
type ToastTypeName = (typeof TOAST_TYPES)[number]
type Hue = 'red' | 'amber' | 'green' | 'sky' | 'violet' | 'neutral'

/** The hue family of a painted colour: `neutral` when it has (near) no
 * chroma, else by HSL hue angle. Ranges are wide on purpose — they separate
 * the six toast families, not shades within one. */
function hueFamily({ r, g, b }: RGB): Hue {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 16) return 'neutral'
  const d = max - min
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const deg = h * 60
  if (deg >= 340 || deg <= 20) return 'red'
  if (deg >= 25 && deg <= 55) return 'amber'
  if (deg >= 110 && deg <= 170) return 'green'
  if (deg >= 180 && deg <= 215) return 'sky'
  if (deg >= 240 && deg <= 285) return 'violet'
  throw new Error(`hue ${deg.toFixed(0)} (rgb ${r},${g},${b}) is in no toast family`)
}

describe('menus-overlays scenario renderer, mounted live in Chromium (#265 finding #1/#2, part 3)', () => {
  const { newPage, mount, openCase } = useMenusOverlaysLiveHarness()

  describe.each(['baseline', 'registryTailwind'] as const)('%s renderer', (path) => {
    it('anchors ContextMenu at the real virtual pointer coordinates it was opened with', async () => {
      const page = await openCase(path, 'component:context-menu', 'open')
      const rect = await page
        .locator('#case [data-scope="context-menu"][data-part="content"]')
        .boundingBox()
      expect(rect).not.toBeNull()
      // Case input opens at (240, 160); the positioner anchors to that point
      // (not necessarily flush against it — padding/offset/middleware may
      // shift it a few pixels — but nowhere near the viewport's other edges).
      expect(rect!.x).toBeGreaterThan(180)
      expect(rect!.x).toBeLessThan(320)
      expect(rect!.y).toBeGreaterThan(100)
      expect(rect!.y).toBeLessThan(260)
    })

    it('flips/shifts ContextMenu content to stay inside the viewport at a real edge anchor', async () => {
      const page = await openCase(path, 'component:context-menu', 'edge-anchor', undefined, {
        viewport: { width: 320, height: 240 },
      })
      const rect = await page
        .locator('#case [data-scope="context-menu"][data-part="content"]')
        .boundingBox()
      expect(rect).not.toBeNull()
      // Opened at (4, 4) — a naive anchor would clip off the top/left edge.
      // Real floating-ui collision detection must keep the whole surface
      // inside the 320x240 viewport.
      expect(rect!.x).toBeGreaterThanOrEqual(0)
      expect(rect!.y).toBeGreaterThanOrEqual(0)
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(320)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(240)
    })

    it('FLIPS a top-preferred popover to the bottom when there is no room above the anchor', async () => {
      // The live-render host is the first element appended to `document.body`
      // (`openCase`), so a `'top'` preference has essentially no room above
      // it — real floating-ui `flip` middleware must resolve the SIDE to
      // `'bottom'` instead. Kills a `flip`-removed mutation of
      // `attachFloating` (packages/interactions/src/floating.ts): without it
      // the resolved side stays `'top'` and the content renders off-screen.
      const page = await openCase(path, 'component:popover', 'flip-required')
      const content = page.locator('#case [data-scope="popover"][data-part="content"]')
      const [side, rect] = await Promise.all([
        content.getAttribute('data-side'),
        content.boundingBox(),
      ])
      expect(side).toBe('bottom')
      expect(rect).not.toBeNull()
      expect(rect!.y).toBeGreaterThanOrEqual(0)
    })

    it('SHIFTS a bottom-end popover to stay in a narrow viewport, side unchanged (kills shift-removed)', async () => {
      // `'bottom-end'` aligns the content's END edge flush with the
      // trigger's — with a viewport this narrow, that would push the
      // content's start edge well past the LEFT edge of the viewport. There
      // is plenty of room BELOW the trigger, so `flip` must not fire (the
      // side must stay `'bottom'`); only `shift` can keep the whole surface
      // on-screen. Kills a `shift`-removed mutation of `attachFloating`
      // (packages/interactions/src/floating.ts ~:199): without it the
      // content overflows the viewport's left edge with the side unchanged.
      const page = await openCase(path, 'component:popover', 'shift-required', undefined, {
        viewport: { width: 150, height: 400 },
      })
      const content = page.locator('#case [data-scope="popover"][data-part="content"]')
      const [side, rect] = await Promise.all([
        content.getAttribute('data-side'),
        content.boundingBox(),
      ])
      expect(side).toBe('bottom')
      expect(rect).not.toBeNull()
      expect(rect!.x).toBeGreaterThanOrEqual(0)
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(150)
    })

    it('centers the popover arrow on the content facing edge, aligned to the real anchor', async () => {
      const page = await openCase(path, 'component:popover', 'open')
      const [contentRect, arrowRect, triggerRect] = await Promise.all([
        page.locator('#case [data-scope="popover"][data-part="content"]').boundingBox(),
        page.locator('#case [data-scope="popover"][data-part="arrow"]').boundingBox(),
        page.locator('#case [data-scope="popover"][data-part="trigger"]').boundingBox(),
      ])
      expect(contentRect).not.toBeNull()
      expect(arrowRect).not.toBeNull()
      expect(triggerRect).not.toBeNull()
      const arrowCenterX = arrowRect!.x + arrowRect!.width / 2
      // The arrow sits ON the content's facing (top, for a 'bottom'
      // placement) edge — its center must fall within the content's own
      // horizontal span, never outside it.
      expect(arrowCenterX).toBeGreaterThanOrEqual(contentRect!.x)
      expect(arrowCenterX).toBeLessThanOrEqual(contentRect!.x + contentRect!.width)
      // And it must be aligned to the real anchor (the trigger's own
      // center), not merely somewhere inside the content — a fixed
      // offset the adapter merely echoes would not track a moved anchor.
      const triggerCenterX = triggerRect!.x + triggerRect!.width / 2
      expect(Math.abs(arrowCenterX - triggerCenterX)).toBeLessThan(6)
    })

    it('positions a real nested submenu beside its subtrigger, both surfaces live at once', async () => {
      const page = await openCase(path, 'component:context-menu', 'submenu-open')
      const [rootRect, subTriggerRect, subContentRect] = await Promise.all([
        page.locator('#case [data-scope="context-menu"][data-part="content"]').boundingBox(),
        page.locator('#case [data-scope="context-menu"][data-part="subtrigger"]').boundingBox(),
        page.locator('#case [data-scope="context-menu"][data-part="subcontent"]').boundingBox(),
      ])
      expect(rootRect).not.toBeNull()
      expect(subTriggerRect).not.toBeNull()
      expect(subContentRect).not.toBeNull()
      // The submenu is a SIBLING floating layer positioned relative to its
      // subtrigger, not stacked on top of it — real geometry, not a fixed
      // offset the adapter merely echoes.
      expect(subContentRect!.x).not.toBeCloseTo(subTriggerRect!.x, 0)
      // The root content must still be present and unhidden while its own
      // submenu is open — a submenu is NESTED inside its owner, not a
      // sibling overlay the root's own dismissal machinery should tear down.
      const rootAriaHidden = await page
        .locator('#case [data-scope="context-menu"][data-part="content"]')
        .getAttribute('aria-hidden')
      expect(rootAriaHidden).not.toBe('true')
      expect(rootRect!.width).toBeGreaterThan(0)
    })

    it('mirrors floating end-alignment under RTL: LTR flush-right becomes RTL flush-left', async () => {
      // `top-end` (unlike `top-start`) gives a genuinely NON-ZERO LTR
      // offset: the content's END (right, in LTR) edge sits flush with the
      // trigger's own right edge, and the content is much wider than the
      // trigger, so its LEFT edge sits well left of the trigger's — a real
      // geometric fact a vacuous "some offset changed" check cannot prove
      // it disappears/reappears correctly. The live-render host mounts
      // flush against the page's own left edge (`openCase`), so a bare
      // 'end'-aligned case there collides with the left edge itself and
      // floating-ui's flip middleware falls back to a DIFFERENT alignment
      // ('start') regardless of requested direction — this test instead
      // pads the body symmetrically first so there is genuine room on
      // BOTH sides and only the requested alignment is ever in play.
      const openPadded = (dir: 'ltr' | 'rtl'): Promise<Page> =>
        openCase(
          path,
          'component:popover',
          'top-end',
          { direction: dir },
          {
            viewport: { width: 1600, height: 768 },
            beforeMount: (page) =>
              page.evaluate(() => {
                document.body.style.paddingLeft = '500px'
                document.body.style.paddingRight = '500px'
              }),
          },
        )
      const ltrPage = await openPadded('ltr')
      const rtlPage = await openPadded('rtl')
      const [ltrRect, rtlRect, ltrTrigger, rtlTrigger] = await Promise.all([
        ltrPage.locator('#case [data-scope="popover"][data-part="content"]').boundingBox(),
        rtlPage.locator('#case [data-scope="popover"][data-part="content"]').boundingBox(),
        ltrPage.locator('#case [data-scope="popover"][data-part="trigger"]').boundingBox(),
        rtlPage.locator('#case [data-scope="popover"][data-part="trigger"]').boundingBox(),
      ])
      expect(ltrRect).not.toBeNull()
      expect(rtlRect).not.toBeNull()
      // LTR: content's RIGHT edge flush with the trigger's right edge, and
      // genuinely offset from the trigger's LEFT edge (proves this case
      // isn't accidentally zero-offset the way `top-start` is).
      const ltrRightDiff = Math.abs(
        ltrRect!.x + ltrRect!.width - (ltrTrigger!.x + ltrTrigger!.width),
      )
      expect(ltrRightDiff).toBeLessThan(10)
      expect(Math.abs(ltrRect!.x - ltrTrigger!.x)).toBeGreaterThan(20)
      // RTL: 'end' flips to the trigger's INLINE-START edge, which under
      // `dir="rtl"` is the trigger's physical LEFT edge — the exact mirror,
      // not merely "some other value".
      const rtlLeftDiff = Math.abs(rtlRect!.x - rtlTrigger!.x)
      expect(rtlLeftDiff).toBeLessThan(10)
    })

    it('contains a dialog inside a narrow viewport', async () => {
      const page = await openCase(path, 'component:dialog', 'modal', undefined, {
        viewport: { width: 320, height: 480 },
      })
      const rect = await page
        .locator('#case [data-scope="dialog"][data-part="content"]')
        .boundingBox()
      expect(rect).not.toBeNull()
      expect(rect!.width).toBeLessThanOrEqual(320)
    })

    it('paints the highlighted menu item using real system colors under forced-colors', async () => {
      const page = await openCase(path, 'component:menu', 'open', { forcedColors: 'active' })
      // `data-forced-colors` alone only reaches case SELECTION — the actual
      // system-color repaint requires the browser's real forced-colors mode.
      await page.emulateMedia({ forcedColors: 'active' })
      // Self-check the pixel path against known canaries before trusting any
      // verdict about this page's own colors (CLAUDE.md verification
      // discipline: a broken instrument reads as a finding).
      const [black, white] = await paintedColors(page, ['#000000', '#ffffff'])
      expect(bucketedKey(black!)).toBe('0,0,0')
      expect(bucketedKey(white!)).toBe('256,256,256')

      // The `open` case seeds `highlighted: 'copy'`, so the item MUST exist —
      // a missing one is a failure, never a skip (#265 G2).
      const highlighted = await page
        .locator('#case [data-scope="menu"][data-highlighted]')
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, color: style.color }
        })
      const [systemBg, systemFg, ownBg, ownFg] = await paintedColors(page, [
        'Highlight',
        'HighlightText',
        highlighted.background,
        highlighted.color,
      ])
      expect(bucketedKey(ownBg!)).toBe(bucketedKey(systemBg!))
      expect(bucketedKey(ownFg!)).toBe(bucketedKey(systemFg!))
    })

    it('drives a real four-phase presence lifecycle for a modal dialog', async () => {
      // Read each page's `data-state` IMMEDIATELY after its own mount — with
      // `motion: 'full'` a real CSS animation is running (the registry skin's
      // `data-[state=opening]:animate-in`), and it genuinely completes and
      // fires a real `animationend` a couple hundred ms later, which the
      // real presence machine listens for and uses to advance status. A
      // batched read (mount all three, then read all three) lets the first
      // page's animation finish for real by the time it's read, which is a
      // race against the SAME lifecycle this test exists to prove — not the
      // absence of a four-phase machine.
      const stateOf = async (page: Page) =>
        page.locator('#case [data-scope="dialog"][data-part="content"]').getAttribute('data-state')
      const openingPage = await openCase(path, 'component:dialog', 'opening', { motion: 'full' })
      expect(await stateOf(openingPage)).toBe('opening')
      const openPage = await openCase(path, 'component:dialog', 'modal', { motion: 'full' })
      expect(await stateOf(openPage)).toBe('open')
      const closingPage = await openCase(path, 'component:dialog', 'closing', { motion: 'full' })
      expect(await stateOf(closingPage)).toBe('closing')
    })

    it('every ToastType clears AA text contrast (>=4.5:1) and non-text contrast (>=3:1) in light, dark, and forced colors', async () => {
      const types = TOAST_TYPES
      const modes = ['light', 'dark', 'forced'] as const
      const toTriple = (c: { r: number; g: number; b: number }): [number, number, number] => [
        c.r,
        c.g,
        c.b,
      ]
      const ratio = (a: [number, number, number], b: [number, number, number]): number =>
        contrast(srgb8ToLinear(a), srgb8ToLinear(b))

      for (const toastType of types) {
        for (const mode of modes) {
          const page =
            mode === 'forced'
              ? await openCase(path, 'component:toast', toastType, { forcedColors: 'active' })
              : await openCase(path, 'component:toast', toastType, { theme: mode })
          if (mode === 'forced') await page.emulateMedia({ forcedColors: 'active' })

          const root = page.locator('#case [data-scope="toast"][data-part="root"]')
          const read = await root.evaluate((node) => {
            const rootStyle = getComputedStyle(node)
            const titleEl = node.querySelector('[data-part="title"]') ?? node
            const textStyle = getComputedStyle(titleEl)
            // The type glyph — baseline's `[data-part='type-icon']` or
            // registry's per-type Lucide `<svg>` — is the NON-TEXT visual
            // cue (#265 task item 2). Its contrast is measured against the
            // toast's own surface, the same adjacency a border or icon is
            // actually read against on a real page (a toast floats over
            // arbitrary page content, so "the surrounding page" has no
            // fixed color to measure against; its own fill does).
            const candidates = Array.from(
              node.querySelectorAll('[data-part="type-icon"], svg[class*="/toast:"]'),
            )
            const icon = candidates.find((el) => getComputedStyle(el).display !== 'none') ?? titleEl
            const iconStyle = getComputedStyle(icon)
            return {
              surface: rootStyle.backgroundColor,
              ink: textStyle.color,
              iconColor: iconStyle.color,
            }
          })
          const [surface, ink, iconColor] = await paintedColors(page, [
            read.surface,
            read.ink,
            read.iconColor,
          ])
          const textRatio = ratio(toTriple(surface!), toTriple(ink!))
          const nonTextRatio = ratio(toTriple(surface!), toTriple(iconColor!))
          expect(textRatio, `${path}/${toastType}/${mode} text contrast`).toBeGreaterThanOrEqual(
            4.5,
          )
          expect(
            nonTextRatio,
            `${path}/${toastType}/${mode} non-text (glyph) contrast`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it('paints each ToastType with its own exact signature: tint hue, glyph, and forced-colors edge', async () => {
      // EXACT per type, never "all distinct": swapping two types' tints,
      // glyphs or edges keeps a distinct set the same size (#265 finding 12,
      // mutants V1-V3). Both skins share the semantics; `loading` is the
      // neutral one, told apart by its own glyph and dotted edge.
      const HUE: Record<ToastTypeName, Hue> = {
        info: 'sky',
        success: 'green',
        warning: 'amber',
        error: 'red',
        loading: 'neutral',
        custom: 'violet',
      }
      const GLYPH: Record<LivePath, Record<ToastTypeName, string>> = {
        baseline: {
          info: 'info',
          success: 'success',
          warning: 'warning',
          error: 'error',
          loading: 'loading',
          custom: 'custom',
        },
        registryTailwind: {
          info: 'lucide:info',
          success: 'lucide:circle-check',
          warning: 'lucide:triangle-alert',
          error: 'lucide:circle-alert',
          loading: 'lucide:loader-circle',
          custom: 'lucide:sparkles',
        },
      }
      const FORCED_EDGE: Record<ToastTypeName, string> = {
        info: 'solid 4px',
        success: 'double 4px',
        warning: 'dashed 4px',
        error: 'solid 4px',
        loading: 'dotted 4px',
        custom: 'solid 8px',
      }
      for (const toastType of TOAST_TYPES) {
        const label = `${path}/${toastType}`
        for (const theme of ['light', 'dark'] as const) {
          const page = await openCase(path, 'component:toast', toastType, { theme })
          const root = page.locator('#case [data-scope="toast"][data-part="root"]')
          const border = await root.evaluate((node) => getComputedStyle(node).borderTopColor)
          const [painted] = await paintedColors(page, [border])
          expect(hueFamily(painted!), `${label}/${theme} tint`).toBe(HUE[toastType])
          // Exactly one glyph shows, and it is THIS type's glyph.
          const visible = await root.evaluate((node) =>
            Array.from(node.querySelectorAll('[data-part="type-icon"], svg[data-glyph]'))
              .filter((el) => getComputedStyle(el).display !== 'none')
              .filter((el) => !el.closest('[data-part="close-trigger"]'))
              .map((el) => el.getAttribute('data-icon') ?? el.getAttribute('data-glyph')),
          )
          expect(visible, `${label}/${theme} glyph`).toEqual([GLYPH[path][toastType]])
          await page.close()
        }
        const page = await openCase(path, 'component:toast', toastType, { forcedColors: 'active' })
        await page.emulateMedia({ forcedColors: 'active' })
        const root = page.locator('#case [data-scope="toast"][data-part="root"]')
        const edge = await root.evaluate((node) => {
          const style = getComputedStyle(node)
          return { edge: `${style.borderLeftStyle} ${style.borderLeftWidth}`, ink: style.color }
        })
        expect(edge.edge, `${label} forced edge`).toBe(FORCED_EDGE[toastType])
        const [ink, linkText, canvasText] = await paintedColors(page, [
          edge.ink,
          'LinkText',
          'CanvasText',
        ])
        // An error reads as a LINK-coloured, underlined toast; every other
        // type keeps plain CanvasText.
        expect(bucketedKey(ink!), `${label} forced ink`).toBe(
          bucketedKey(toastType === 'error' ? linkText! : canvasText!),
        )
        await page.close()
      }
    })

    it('places every real toast placement, LTR and RTL', async () => {
      const placements = [
        'top',
        'top-start',
        'top-end',
        'bottom',
        'bottom-start',
        'bottom-end',
      ] as const
      for (const direction of ['ltr', 'rtl'] as const) {
        for (const placement of placements) {
          // Only the start/end placements declare the `direction` axis as
          // supported (menus-overlays-scenarios.ts); centered top/bottom
          // cases are direction-invariant and reject an override.
          const page = await openCase(
            path,
            'component:toast',
            `placement-${placement}`,
            placement.includes('-') ? { direction } : undefined,
          )
          const region = page.locator('#case [data-scope="toast"][data-part="region"]')
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
    })
  })

  it('keeps a stacked ContextMenu owned by its own layer, not dismissed by the modal Dialog beneath it', async () => {
    // Two independently-mounted products live on the SAME page — the
    // structural shape the review's "stacked/nested overlays" finding names
    // (z-order, dismissal ownership, focus). Both are mounted through the
    // baseline renderer's per-case mount, into two different host ids.
    const page = await newPage('baseline')
    await mount(page, 'baseline', {
      scenarioId: 'component:dialog',
      caseId: 'modal',
      hostId: 'dialog-host',
    })
    await mount(page, 'baseline', {
      scenarioId: 'component:context-menu',
      caseId: 'open',
      hostId: 'menu-host',
    })
    const dialogContent = page.locator('#dialog-host [data-scope="dialog"][data-part="content"]')
    expect(await dialogContent.isVisible()).toBe(true)
    const menuItem = page
      .locator('#menu-host [data-scope="context-menu"][data-part="item"]')
      .first()
    await menuItem.evaluate((node) => (node as HTMLElement).click())
    // Clicking inside the (unrelated, unowned) context-menu must not be
    // read by the dialog's own outside-interaction dismissal as an outside
    // click — the dialog stays mounted and its content stays visible.
    expect(await dialogContent.isVisible()).toBe(true)
  })

  /**
   * Real multi-layer stacking: two independently-mounted products on ONE
   * page, driven with REAL Playwright pointer/keyboard events (`page.mouse`,
   * `page.keyboard`, `locator.click()` — never `.evaluate(node => node.click())`,
   * a synthetic DOM dispatch that bypasses the real hit-testing/focus
   * machinery this is meant to prove). Covers #265's "stacked/nested
   * overlays" finding (finding 2): Escape and outside presses dismissing
   * only the TOP layer (menu over dialog, submenu inside menu, dialog over
   * dialog), and for nested modal dialogs z-order via `elementFromPoint`,
   * the focus trap and real Tab cycling on the top one, `inert` on the one
   * beneath, and focus returning to it when the top one closes. Focus
   * restore to a TRIGGER is proven per surface in `modal-stacking.browser.test.ts`.
   */
  describe.each(['baseline', 'registryTailwind'] as const)(
    '%s renderer, stacked overlays',
    (path) => {
      async function openTwo(
        first: { scenarioId: string; caseId: string; hostId: string },
        second: { scenarioId: string; caseId: string; hostId: string },
      ): Promise<Page> {
        const page = await newPage(path)
        await mount(page, path, first)
        await mount(page, path, second)
        return page
      }

      it('Menu opened after a modal Dialog: Escape and an outside pointer press each dismiss ONLY the top-layer Menu', async () => {
        // The modal Dialog's z-index (`--llui-z-dialog`) is explicitly HIGHER
        // than the Menu's (`--llui-z-popover`) regardless of mount order — a
        // Dialog is always visually dominant over a non-modal popup by design
        // (`semantic-tokens.css`). "Top layer" for dismissal ownership is
        // about the DISMISSAL STACK (most-recently-opened wins), not paint
        // order, and is what this proves: the Menu (opened second) is the
        // layer that owns both Escape and outside-press, and dismissing it
        // never reaches the Dialog beneath.
        const page = await openTwo(
          { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'dialog-host' },
          { scenarioId: 'component:menu', caseId: 'open', hostId: 'menu-host' },
        )
        const dialogContent = page.locator(
          '#dialog-host [data-scope="dialog"][data-part="content"]',
        )
        const menuContent = page.locator('#menu-host [data-scope="menu"][data-part="content"]')
        expect(await dialogContent.isVisible()).toBe(true)
        expect(await menuContent.isVisible()).toBe(true)

        await page.keyboard.press('Escape')
        await menuContent.waitFor({ state: 'hidden' })
        expect(await dialogContent.isVisible()).toBe(true)

        // Re-open the Menu and prove the SAME top-layer-only ownership for a
        // real outside POINTER press (`page.mouse`, never a synthetic
        // `.evaluate(node => node.click())`), at a point outside both the
        // menu's own content and the dialog's content.
        await mount(page, path, {
          scenarioId: 'component:menu',
          caseId: 'open',
          hostId: 'menu-host-2',
        })
        const menuContent2 = page.locator('#menu-host-2 [data-scope="menu"][data-part="content"]')
        expect(await menuContent2.isVisible()).toBe(true)
        await page.mouse.click(2, 2)
        await menuContent2.waitFor({ state: 'hidden' })
        expect(await dialogContent.isVisible()).toBe(true)
      })

      it('a Menu with an open submenu: Escape closes only the (nested, owned) submenu, the root menu stays open', async () => {
        // Real ownership nesting, unlike the two independent products above:
        // the submenu is OWNED by its subtrigger inside the SAME product
        // (menu.ts's own "unwind one level" Escape handling), and this is
        // what #265's "nested overlays" finding means by dismissal ownership.
        const page = await openCase(path, 'component:menu', 'submenu-open')
        const rootContent = page.locator('#case [data-scope="menu"][data-part="content"]')
        const subContent = page.locator('#case [data-scope="menu"][data-part="subcontent"]')
        expect(await rootContent.isVisible()).toBe(true)
        expect(await subContent.isVisible()).toBe(true)

        await page.keyboard.press('Escape')
        await subContent.waitFor({ state: 'hidden' })
        // The ROOT menu content is still mounted and visible — only the
        // nested submenu layer was dismissed.
        expect(await rootContent.isVisible()).toBe(true)
      })

      it('nested modal Dialogs: the TOP one paints and hit-tests on top, owns focus and Tab, inerts the one beneath, and Escape unwinds only it', async () => {
        // The REAL nested shape: the inner dialog is opened from inside the
        // outer one, with its own machine and ids. (Two mounts of one case
        // would duplicate every id, so each overlay would resolve the FIRST
        // dialog's content — a fixture artifact, not a product state.)
        const page = await openCase(path, 'component:dialog', 'nested', undefined, {
          beforeMount: (p) => p.emulateMedia({ reducedMotion: 'reduce' }),
        })
        const outerId = path === 'baseline' ? 'd' : 'rd'
        const innerId = `${outerId}-nested`
        const outer = page.locator(`[id="${outerId}:content"]`)
        const inner = page.locator(`[id="${innerId}:content"]`)
        await Promise.all([
          outer.waitFor({ state: 'visible' }),
          inner.waitFor({ state: 'visible' }),
        ])

        // Which dialog (innermost first) an element belongs to.
        const dialogOf = (probe: 'active' | 'centre') =>
          page.evaluate(
            ({ probe, innerSel, outerSel }) => {
              const el =
                probe === 'active'
                  ? document.activeElement
                  : document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
              if (el?.closest(innerSel)) return 'inner'
              if (el?.closest(outerSel)) return 'outer'
              return null
            },
            {
              probe,
              innerSel: `[id="${innerId}:content"]`,
              outerSel: `[id="${outerId}:content"]`,
            },
          )
        const inertOf = (dialogId: string) =>
          page.evaluate(
            (id) => document.getElementById(`${id}:content`)?.closest('[inert]') != null,
            dialogId,
          )

        // Z-ORDER: both are centred, so they overlap at the centre; the point
        // resolves to the TOP (inner) dialog.
        expect(await dialogOf('centre')).toBe('inner')
        // The layer beneath is inert while the top modal is open.
        expect([await inertOf(outerId), await inertOf(innerId)]).toEqual([true, false])
        // FOCUS: the top dialog owns it, and real Tab presses cycle inside it.
        expect(await dialogOf('active')).toBe('inner')
        for (let press = 0; press < 4; press++) {
          await page.keyboard.press('Tab')
          expect(await dialogOf('active'), `after Tab ${press + 1}`).toBe('inner')
        }

        // ESCAPE unwinds only the top layer; the one beneath comes back to
        // life (no longer inert) and gets focus back.
        await page.keyboard.press('Escape')
        await inner.waitFor({ state: 'hidden' })
        expect(await outer.isVisible()).toBe(true)
        expect(await inertOf(outerId)).toBe(false)
        expect(await dialogOf('active')).toBe('outer')

        // And an outside press now dismisses the remaining (outer) one.
        await page.mouse.click(2, 2)
        await outer.waitFor({ state: 'hidden' })
      })
    },
  )
})
