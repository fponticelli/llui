// @vitest-environment node

/**
 * PRODUCT-EFFECT proofs for every menus-overlays case field and environment
 * axis that jsdom cannot observe (#265 G2), in real Chromium, on both
 * renderer paths.
 *
 * The renderer unit tests only prove an axis reached the mount HOST (`dir`,
 * `data-theme`, …). That is the adapter's own write, not what the product
 * does with it, and it stays green when the product ignores it. Each test
 * here instead measures what a user sees:
 *
 *  - `placement` → the resolved `data-side` and the real geometry of the
 *    content against its anchor (side AND alignment), for every floating
 *    product, at every probe in `FLOATING_PLACEMENT_PROBES`.
 *  - `theme` → the surface paints exactly what a PAGE-LEVEL theme paints, with
 *    AA text contrast on the painted pixels.
 *  - `direction` → the surface computes `rtl`, and lays out exactly as under a
 *    page-level `dir="rtl"`.
 *  - `forcedColors` → under real forced-colors emulation the surface paints
 *    system colours with AA contrast, and a floating surface keeps a visible
 *    `CanvasText` edge.
 *  - `motion` → under real `prefers-reduced-motion` every animation and
 *    transition on the surface collapses to near zero, and with full motion
 *    it does not (the control arm that makes the reduced arm discriminate).
 *  - `viewport` → the surface stays inside a narrow viewport.
 *
 * Every case set is DERIVED from `MENUS_OVERLAYS_DEFINITIONS`, and the
 * per-product surface table is checked against it at both ends, so a new case
 * or axis cannot slip past unmeasured.
 */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright'
import { LIVE_PATHS, useMenusOverlaysLiveHarness } from './menus-overlays-live-harness.js'
import {
  FLOATING_PLACEMENT_PROBES,
  MENUS_OVERLAYS_DEFINITIONS,
  type MenusOverlaysDefinitionScenarioId,
} from './menus-overlays-scenarios.js'
import { bucketedKey, paintedColors, type RGB } from './pixel-probe.js'
import { contrast, srgb8ToLinear } from '../../../../scripts/lib/oklch.mjs'

type Axis = 'theme' | 'direction' | 'forcedColors' | 'motion' | 'viewport'

interface CaseRef {
  readonly scenarioId: MenusOverlaysDefinitionScenarioId
  readonly caseId: string
}

const scenarioIds = Object.keys(MENUS_OVERLAYS_DEFINITIONS) as MenusOverlaysDefinitionScenarioId[]

/** Every case declaring `axis`, in definition order. */
const casesWithAxis = (axis: Axis): CaseRef[] =>
  scenarioIds.flatMap((scenarioId) =>
    MENUS_OVERLAYS_DEFINITIONS[scenarioId].cases
      .filter((scenarioCase) => (scenarioCase.environmentAxes as readonly string[]).includes(axis))
      .map((scenarioCase) => ({ scenarioId, caseId: scenarioCase.id })),
  )

/**
 * The element each product paints as its surface, and whether it FLOATS over
 * the page (a floating surface needs its own visible edge in forced colors,
 * since its fill becomes the same `Canvas` as the page beneath it). The same
 * selector must match on both paths — they share the machines' part bags.
 */
const SURFACE: Record<MenusOverlaysDefinitionScenarioId, { selector: string; floats: boolean }> = {
  'component:alert-dialog': {
    selector: '[data-scope="dialog"][data-part="content"]',
    floats: true,
  },
  'component:dialog': { selector: '[data-scope="dialog"][data-part="content"]', floats: true },
  'component:drawer': { selector: '[data-scope="drawer"][data-part="content"]', floats: true },
  'component:hover-card': {
    selector: '[data-scope="hover-card"][data-part="content"]',
    floats: true,
  },
  'component:popover': { selector: '[data-scope="popover"][data-part="content"]', floats: true },
  'component:tooltip': { selector: '[data-scope="tooltip"][data-part="content"]', floats: true },
  'component:menu': { selector: '[data-scope="menu"][data-part="content"]', floats: true },
  'component:context-menu': {
    selector: '[data-scope="context-menu"][data-part="content"]',
    floats: true,
  },
  'component:menubar': { selector: '[data-scope="menubar"][data-part="root"]', floats: false },
  'component:navigation-menu': {
    selector: '[data-scope="navigation-menu"][data-part="root"]',
    floats: false,
  },
  'component:select': { selector: '[data-scope="select"][data-part="content"]', floats: true },
  'component:combobox': {
    selector: '[data-scope="combobox"][data-part="content"]',
    floats: true,
  },
  'component:toast': { selector: '[data-scope="toast"][data-part="root"]', floats: true },
  'component:toolbar': { selector: '[data-scope="toolbar"][data-part="root"]', floats: false },
  'pattern:command-menu': {
    selector: '[data-scope="dialog"][data-part="content"]',
    floats: true,
  },
  'pattern:confirm-dialog': {
    selector: '[data-scope="dialog"][data-part="content"]',
    floats: true,
  },
  'pattern:searchable-select': {
    selector: '[data-scope="searchable-select"][data-part="content"]',
    floats: true,
  },
}

interface SurfaceRead {
  /** The surface's own background alpha — 0 (it shows its container) or 1. */
  readonly ownAlpha: number
  /** The first non-transparent background at or above the surface. */
  readonly background: string
  readonly backgroundAlpha: number
  readonly ink: string
  readonly direction: string
  readonly borderColor: string
  readonly borderWidth: number
  readonly rect: { x: number; y: number; width: number; height: number }
}

async function readSurface(page: Page, selector: string): Promise<SurfaceRead> {
  const surface = page.locator(`#case ${selector}`).first()
  await surface.waitFor({ state: 'attached' })
  return surface.evaluate((node) => {
    const alphaOf = (color: string): number => {
      if (color === 'transparent') return 0
      const legacy = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(color)
      if (legacy) return Number(legacy[1])
      const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color)
      if (slash) return Number(slash[1]) / (slash[2] === '%' ? 100 : 1)
      return 1
    }
    const own = getComputedStyle(node)
    let background = 'rgb(255, 255, 255)'
    let backgroundAlpha = 1
    for (let el: Element | null = node; el !== null; el = el.parentElement) {
      const color = getComputedStyle(el).backgroundColor
      const alpha = alphaOf(color)
      if (alpha > 0) {
        background = color
        backgroundAlpha = alpha
        break
      }
    }
    const r = node.getBoundingClientRect()
    return {
      ownAlpha: alphaOf(own.backgroundColor),
      background,
      backgroundAlpha,
      ink: own.color,
      direction: own.direction,
      borderColor: own.borderTopColor,
      borderWidth: Math.max(
        Number.parseFloat(own.borderTopWidth),
        Number.parseFloat(own.borderRightWidth),
        Number.parseFloat(own.borderBottomWidth),
        Number.parseFloat(own.borderLeftWidth),
      ),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    }
  })
}

const triple = ({ r, g, b }: RGB): [number, number, number] => [r, g, b]
const ratio = (a: RGB, b: RGB): number =>
  contrast(srgb8ToLinear(triple(a)), srgb8ToLinear(triple(b)))

declare global {
  interface Window {
    __surfaceMotion?: number
  }
}

/**
 * A `beforeMount` that records the surface's longest animation/transition
 * duration (seconds) the moment it is inserted — in the mutation's own
 * microtask, before any frame can fire the `animationend` that unmounts a
 * `closing` surface. Reading after mount instead races that removal.
 */
const captureMotionAtInsert = (selector: string) => (page: Page) =>
  page.evaluate((surfaceSelector) => {
    const seconds = (list: string): number =>
      Math.max(
        0,
        ...list.split(',').map((raw) => {
          const value = raw.trim()
          return value.endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value)
        }),
      )
    const observer = new MutationObserver(() => {
      const surface = document.querySelector(`#case ${surfaceSelector}`)
      if (surface === null) return
      const style = getComputedStyle(surface)
      window.__surfaceMotion = Math.max(
        seconds(style.animationDuration),
        seconds(style.transitionDuration),
      )
      observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, selector)

const capturedMotion = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => window.__surfaceMotion)

/**
 * A still page for GEOMETRY: reduced motion, so no entry animation is still
 * scaling or sliding a box when it is measured, and no scrollbar, since under
 * a page-level `dir="rtl"` Chromium moves the viewport scrollbar to the LEFT,
 * shifting every box by its width for reasons unrelated to the product.
 */
const stillPage = async (page: Page): Promise<void> => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'hidden'
  })
}

/** Resolve once the page has painted two more frames, so a position the
 * floating engine computed asynchronously has been written. */
const settled = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )

const pageTheme = (theme: 'light' | 'dark') => (page: Page) =>
  page.evaluate((value) => {
    document.documentElement.dataset.theme = value
  }, theme)

describe('menus-overlays product effects, live in Chromium (#265 G2)', () => {
  const { openCase } = useMenusOverlaysLiveHarness()

  it('names a surface for exactly the products that declare a surface axis', () => {
    const surfaced = new Set(
      (['theme', 'direction', 'forcedColors', 'motion', 'viewport'] as const).flatMap((axis) =>
        casesWithAxis(axis).map(({ scenarioId }) => scenarioId),
      ),
    )
    expect(Object.keys(SURFACE).sort()).toEqual([...surfaced].sort())
  })

  it('probes placement on exactly the products whose cases carry a placement', () => {
    // `component:toast` carries a `placement` too, but it places the fixed
    // REGION, not an anchored surface — proven by the live-render suite's
    // "places every real ToastType and every real toast placement, LTR and RTL".
    const floating = scenarioIds.filter(
      (scenarioId) =>
        scenarioId !== 'component:toast' &&
        MENUS_OVERLAYS_DEFINITIONS[scenarioId].cases.some(
          (scenarioCase) => 'placement' in (scenarioCase.input as object),
        ),
    )
    expect(floating.sort()).toEqual(
      ['component:hover-card', 'component:menu', 'component:popover', 'component:tooltip'].sort(),
    )
    for (const scenarioId of floating) {
      const probes = MENUS_OVERLAYS_DEFINITIONS[scenarioId].cases
        .map(({ id }) => id)
        .filter((id) => id.startsWith('placement-'))
      expect(probes, scenarioId).toEqual(
        FLOATING_PLACEMENT_PROBES.map((placement) => `placement-${placement}`),
      )
    }
  })

  describe.each(LIVE_PATHS)('%s renderer', (path) => {
    /**
     * The anchor sits in the middle of a padded page, so every side has room
     * and only the REQUESTED placement is in play (no flip, no shift).
     */
    const openRoomy = (scenarioId: string, caseId: string, direction: 'ltr' | 'rtl') =>
      openCase(
        path,
        scenarioId,
        caseId,
        caseId === 'placement-bottom-end' ? { direction } : undefined,
        {
          viewport: { width: 1400, height: 1000 },
          beforeMount: async (page) => {
            await stillPage(page)
            await page.evaluate(() => {
              document.body.style.padding = '420px 560px'
            })
          },
        },
      )

    it('resolves every placement probe of every floating product to its real side and alignment', async () => {
      const floating = [
        ['component:hover-card', 'hover-card'],
        ['component:popover', 'popover'],
        ['component:tooltip', 'tooltip'],
        ['component:menu', 'menu'],
      ] as const
      // Only `bottom-end` declares the direction axis, so only it has an RTL arm.
      const probes = FLOATING_PLACEMENT_PROBES.flatMap(
        (placement): { placement: string; direction: 'ltr' | 'rtl' }[] =>
          placement === 'bottom-end'
            ? [
                { placement, direction: 'ltr' },
                { placement, direction: 'rtl' },
              ]
            : [{ placement, direction: 'ltr' }],
      )
      for (const [scenarioId, scope] of floating) {
        for (const { placement, direction } of probes) {
          const label = `${path} ${scenarioId} ${placement} ${direction}`
          const page = await openRoomy(scenarioId, `placement-${placement}`, direction)
          const content = page.locator(`#case [data-scope="${scope}"][data-part="content"]`)
          const trigger = page.locator(`#case [data-scope="${scope}"][data-part="trigger"]`)
          await content.waitFor({ state: 'visible' })
          await settled(page)
          const [side, c, t] = await Promise.all([
            content.getAttribute('data-side'),
            content.boundingBox(),
            trigger.boundingBox(),
          ])
          if (c === null || t === null) throw new Error(`${label}: no geometry`)
          const [sideName, align = 'center'] = placement.split('-') as [string, string?]
          expect(side, label).toBe(sideName)
          // SIDE: the content sits entirely beyond the anchor's facing edge.
          if (sideName === 'top') expect(c.y + c.height, label).toBeLessThanOrEqual(t.y + 0.5)
          if (sideName === 'bottom') expect(c.y, label).toBeGreaterThanOrEqual(t.y + t.height - 0.5)
          if (sideName === 'left') expect(c.x + c.width, label).toBeLessThanOrEqual(t.x + 0.5)
          if (sideName === 'right') expect(c.x, label).toBeGreaterThanOrEqual(t.x + t.width - 0.5)
          // ALIGNMENT, on the cross axis. A top/bottom placement's
          // inline-axis start/end mirror under RTL; a left/right placement's
          // block-axis alignment never does.
          const horizontal = sideName === 'top' || sideName === 'bottom'
          const [cStart, cEnd, tStart, tEnd] = horizontal
            ? [c.x, c.x + c.width, t.x, t.x + t.width]
            : [c.y, c.y + c.height, t.y, t.y + t.height]
          // Discrimination guard: start, center and end must sit at least
          // 4px apart, or a wrong alignment could pass inside the tolerance.
          expect(
            Math.abs(cEnd - cStart - (tEnd - tStart)),
            `${label} probe spread`,
          ).toBeGreaterThanOrEqual(8)
          const mirrored = horizontal && direction === 'rtl'
          const edge =
            align === 'center' ? 'center' : mirrored === (align === 'start') ? 'end' : 'start'
          // 1.5px: the engine rounds the translate to whole px (<=0.5) and the
          // anchor itself may sit on a fractional px (<=0.5), plus AA slop.
          const offBy =
            edge === 'start'
              ? cStart - tStart
              : edge === 'end'
                ? cEnd - tEnd
                : (cStart + cEnd) / 2 - (tStart + tEnd) / 2
          expect(Math.abs(offBy), `${label} ${edge} alignment`).toBeLessThanOrEqual(1.5)
          await page.close()
        }
      }
    }, 60_000)

    for (const { scenarioId, caseId } of casesWithAxis('theme')) {
      it(`theme: ${scenarioId}/${caseId} paints as a page-level theme does, at AA contrast`, async () => {
        const { selector } = SURFACE[scenarioId]
        for (const theme of ['light', 'dark'] as const) {
          const label = `${path} ${scenarioId}/${caseId} ${theme}`
          const subtree = await openCase(path, scenarioId, caseId, { theme })
          const whole = await openCase(
            path,
            scenarioId,
            caseId,
            { theme },
            {
              beforeMount: pageTheme(theme),
            },
          )
          const [a, b] = await Promise.all([
            readSurface(subtree, selector),
            readSurface(whole, selector),
          ])
          expect([a.ownAlpha === 0 || a.ownAlpha === 1, a.backgroundAlpha], label).toEqual([
            true,
            1,
          ])
          const [bgA, inkA] = await paintedColors(subtree, [a.background, a.ink])
          const [bgB, inkB] = await paintedColors(whole, [b.background, b.ink])
          expect([bucketedKey(bgA!), bucketedKey(inkA!)], label).toEqual([
            bucketedKey(bgB!),
            bucketedKey(inkB!),
          ])
          expect(ratio(bgA!, inkA!), label).toBeGreaterThanOrEqual(4.5)
          await Promise.all([subtree.close(), whole.close()])
        }
      })
    }

    for (const { scenarioId, caseId } of casesWithAxis('direction')) {
      it(`direction: ${scenarioId}/${caseId} computes and lays out as a page-level dir does`, async () => {
        const { selector } = SURFACE[scenarioId]
        const ltr = await openCase(
          path,
          scenarioId,
          caseId,
          { direction: 'ltr' },
          {
            beforeMount: stillPage,
          },
        )
        const subtree = await openCase(
          path,
          scenarioId,
          caseId,
          { direction: 'rtl' },
          {
            beforeMount: stillPage,
          },
        )
        const whole = await openCase(
          path,
          scenarioId,
          caseId,
          { direction: 'rtl' },
          {
            beforeMount: async (page) => {
              await stillPage(page)
              await page.evaluate(() => {
                document.documentElement.dir = 'rtl'
              })
            },
          },
        )
        await Promise.all([ltr, subtree, whole].map(settled))
        const [l, a, b] = await Promise.all([
          readSurface(ltr, selector),
          readSurface(subtree, selector),
          readSurface(whole, selector),
        ])
        expect([l.direction, a.direction, b.direction]).toEqual(['ltr', 'rtl', 'rtl'])
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(
            Math.abs(a.rect[key] - b.rect[key]),
            `${path} ${scenarioId}/${caseId} ${key}`,
          ).toBeLessThanOrEqual(1)
        }
      })
    }

    for (const { scenarioId, caseId } of casesWithAxis('forcedColors')) {
      it(`forcedColors: ${scenarioId}/${caseId} paints system colours at AA, with a visible edge when floating`, async () => {
        const { selector, floats } = SURFACE[scenarioId]
        const label = `${path} ${scenarioId}/${caseId}`
        const page = await openCase(
          path,
          scenarioId,
          caseId,
          { forcedColors: 'active' },
          {
            beforeMount: (p) => p.emulateMedia({ forcedColors: 'active' }),
          },
        )
        const read = await readSurface(page, selector)
        const [canvas, canvasText, bg, ink, border] = await paintedColors(page, [
          'Canvas',
          'CanvasText',
          read.background,
          read.ink,
          read.borderColor,
        ])
        // Instrument self-check: forced colours are actually in force.
        expect(bucketedKey(canvas!), label).not.toBe(bucketedKey(canvasText!))
        expect(ratio(bg!, ink!), label).toBeGreaterThanOrEqual(4.5)
        if (floats) {
          // A floating surface's fill becomes the page's own `Canvas`, so it
          // needs an edge the page does not have: a border, or an inverted
          // fill (the tooltip), at non-text contrast against `Canvas`.
          const borderEdge = read.borderWidth > 0 ? ratio(border!, canvas!) : 0
          const fillEdge = ratio(bg!, canvas!)
          expect(Math.max(borderEdge, fillEdge), `${label} edge`).toBeGreaterThanOrEqual(3)
        }
      })
    }

    for (const { scenarioId, caseId } of casesWithAxis('motion')) {
      it(`motion: ${scenarioId}/${caseId} animates at full motion and collapses under reduced motion`, async () => {
        const { selector } = SURFACE[scenarioId]
        const label = `${path} ${scenarioId}/${caseId}`
        const full = await openCase(
          path,
          scenarioId,
          caseId,
          { motion: 'full' },
          {
            beforeMount: captureMotionAtInsert(selector),
          },
        )
        const reduced = await openCase(
          path,
          scenarioId,
          caseId,
          { motion: 'reduced' },
          {
            beforeMount: async (page) => {
              await page.emulateMedia({ reducedMotion: 'reduce' })
              await captureMotionAtInsert(selector)(page)
            },
          },
        )
        const [fullMotion, reducedMotion] = await Promise.all([
          capturedMotion(full),
          capturedMotion(reduced),
        ])
        expect(fullMotion, `${label} full`).toBeGreaterThanOrEqual(0.1)
        expect(reducedMotion, `${label} reduced`).toBeLessThanOrEqual(0.00001)
      })
    }

    for (const { scenarioId, caseId } of casesWithAxis('viewport')) {
      it(`viewport: ${scenarioId}/${caseId} stays inside a narrow viewport`, async () => {
        const viewport = { width: 320, height: 480 }
        const page = await openCase(
          path,
          scenarioId,
          caseId,
          { viewport: 'narrow' },
          {
            viewport,
            // The anchor sits well below the top, so a surface capped only by
            // the VIEWPORT (`100dvh - 2rem`) would run off the bottom: only a
            // cap at the space actually left below the anchor keeps it in.
            beforeMount: async (p) => {
              await stillPage(p)
              await p.evaluate(() => {
                document.body.style.paddingTop = '120px'
              })
            },
          },
        )
        const selector = SURFACE[scenarioId].selector
        await page.locator(`#case ${selector}`).first().waitFor({ state: 'visible' })
        await settled(page)
        const { rect } = await readSurface(page, selector)
        const label = `${path} ${scenarioId}/${caseId}`
        expect(rect.x, label).toBeGreaterThanOrEqual(0)
        expect(rect.y, label).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width, label).toBeLessThanOrEqual(viewport.width)
        expect(rect.y + rect.height, label).toBeLessThanOrEqual(viewport.height)
      })
    }
  })
})
