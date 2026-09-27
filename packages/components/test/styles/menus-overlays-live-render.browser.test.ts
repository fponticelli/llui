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
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { paintedColors, bucketedKey } from './pixel-probe.js'
import { contrast, srgb8ToLinear } from '../../../../scripts/lib/oklch.mjs'
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
  { find: '@/lib', replacement: resolve(repoRoot, 'registry/llui/lib') },
  { find: '@/ui', replacement: resolve(repoRoot, 'registry/llui/ui') },
]

async function startExample(directory: string): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: resolve(repoRoot, directory),
    logLevel: 'error',
    resolve: { alias: sourceAliases },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error(`Vite did not bind ${directory} to a TCP port`)
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

type Path = 'baseline' | 'registryTailwind'

interface MountRequest {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment?: Record<string, unknown>
  readonly hostId: string
}

declare global {
  interface Window {
    __mountMenusOverlaysBaselineCase?: (contract: unknown, request: MountRequest) => void
    __disposeMenusOverlaysBaselineCase?: (hostId: string) => void
    __mountMenusOverlaysRegistryCase?: (contract: unknown, request: MountRequest) => void
    __disposeMenusOverlaysRegistryCase?: (hostId: string) => void
  }
}

const MOUNT_FN: Record<
  Path,
  '__mountMenusOverlaysBaselineCase' | '__mountMenusOverlaysRegistryCase'
> = {
  baseline: '__mountMenusOverlaysBaselineCase',
  registryTailwind: '__mountMenusOverlaysRegistryCase',
}

describe('menus-overlays scenario renderer, mounted live in Chromium (#265 finding #1/#2, part 3)', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  let urls: Record<Path, string> = { baseline: '', registryTailwind: '' }
  const openPages: Page[] = []

  beforeAll(async () => {
    const [baseline, registryTailwind] = await Promise.all([
      startExample('examples/components-demo'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registryTailwind.server]
    urls = {
      baseline: `${baseline.url}src/test-fixtures/menus-overlays-live-render.html`,
      registryTailwind: `${registryTailwind.url}src/test-fixtures/menus-overlays-live-render.html`,
    }
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterEach(async () => {
    for (const page of openPages.splice(0)) await page.close().catch(() => {})
  })

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  /** Every scenario mounts in its OWN isolated page — never a shared style
   * universe between two cases, and never between the two renderer paths. */
  async function openCase(
    path: Path,
    scenarioId: string,
    caseId: string,
    environment?: Record<string, unknown>,
    viewport?: { width: number; height: number },
  ): Promise<Page> {
    const page = await browser.newPage({ viewport: viewport ?? { width: 1024, height: 768 } })
    openPages.push(page)
    await page.goto(urls[path])
    const fn = MOUNT_FN[path]
    await page.waitForFunction((name) => typeof window[name as keyof Window] === 'function', fn)
    await page.evaluate(
      ({ fn, contract, request }) => {
        const mount = window[fn as keyof Window] as (c: unknown, r: MountRequest) => void
        mount(contract, request)
      },
      { fn, contract, request: { scenarioId, caseId, environment, hostId: 'case' } },
    )
    return page
  }

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
        width: 320,
        height: 240,
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
        width: 150,
        height: 400,
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
      const openPadded = async (dir: 'ltr' | 'rtl'): Promise<Page> => {
        const page = await browser.newPage({ viewport: { width: 1600, height: 768 } })
        openPages.push(page)
        await page.goto(urls[path])
        const fn = MOUNT_FN[path]
        await page.waitForFunction((name) => typeof window[name as keyof Window] === 'function', fn)
        await page.evaluate(
          ({ fn, contract, dir }) => {
            document.body.style.paddingLeft = '500px'
            document.body.style.paddingRight = '500px'
            const mount = window[fn as keyof Window] as (c: unknown, r: MountRequest) => void
            mount(contract, {
              scenarioId: 'component:popover',
              caseId: 'top-end',
              environment: { direction: dir },
              hostId: 'case',
            })
          },
          { fn, contract, dir },
        )
        return page
      }
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
        width: 320,
        height: 480,
      })
      const rect = await page
        .locator('#case [data-scope="dialog"][data-part="content"]')
        .boundingBox()
      expect(rect).not.toBeNull()
      expect(rect!.width).toBeLessThanOrEqual(320)
    })

    it('gives the dialog surface a different real background/border under dark vs light', async () => {
      const lightPage = await openCase(path, 'component:dialog', 'modal', { theme: 'light' })
      const darkPage = await openCase(path, 'component:dialog', 'modal', { theme: 'dark' })
      const visual = async (page: Page) =>
        page.locator('#case [data-scope="dialog"][data-part="content"]').evaluate((node) => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, border: style.borderColor }
        })
      const [light, dark] = await Promise.all([visual(lightPage), visual(darkPage)])
      expect(dark.background).not.toBe(light.background)
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

      const highlighted = await page
        .locator('#case [data-scope="menu"][data-highlighted]')
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node)
          return { background: style.backgroundColor, color: style.color }
        })
        .catch(() => null)
      // Not every case necessarily seeds a highlighted item on every path;
      // when it does, its painted colors must resolve to the system
      // Highlight/HighlightText pair, never an inert light-mode literal.
      if (highlighted !== null) {
        const [systemBg, systemFg, ownBg, ownFg] = await paintedColors(page, [
          'Highlight',
          'HighlightText',
          highlighted.background,
          highlighted.color,
        ])
        expect(bucketedKey(ownBg!)).toBe(bucketedKey(systemBg!))
        expect(bucketedKey(ownFg!)).toBe(bucketedKey(systemFg!))
      }
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

    it('reduces a real opening transition to (near) zero duration under prefers-reduced-motion', async () => {
      const page = await openCase(path, 'component:popover', 'opening', { motion: 'reduced' })
      const duration = await page
        .locator('#case [data-scope="popover"][data-part="content"]')
        .evaluate((node) => getComputedStyle(node).transitionDuration)
      // Kill the transition rather than waiting on it (verification
      // discipline: a hidden/backgrounded tab freezes a mid-flight
      // transition and would misreport a live one as reduced).
      expect(['0s', '']).toContain(duration.split(',')[0]!.trim())
    })

    it('reduces a real toast exit animation to (near) zero duration under prefers-reduced-motion', async () => {
      // Mounts ALREADY `closing` (the scenario's own `closing: true` input)
      // rather than racing a live dismiss — deterministic, and the real
      // discriminating proof that the DURATION itself collapsed, which a
      // "removed within some timeout" race (see
      // `registry/test/toast-live-demos.browser.test.ts`'s own reduced-
      // motion test) cannot tell apart from a merely-fast normal exit.
      const page = await openCase(path, 'component:toast', 'closing', { motion: 'reduced' })
      // `data-motion` alone only reaches case SELECTION — the actual
      // reduced-duration repaint requires the browser's real
      // `prefers-reduced-motion: reduce` media query (mirrors the
      // forced-colors case a few tests up).
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const duration = await page
        .locator('#case [data-scope="toast"][data-part="root"]')
        .evaluate((node) => getComputedStyle(node).animationDuration)
      // Kill the animation rather than waiting on it (verification
      // discipline: a hidden/backgrounded tab freezes a mid-flight
      // animation and would misreport a live one as reduced). Chromium
      // renders 0.01ms as '1e-05s'; accept any near-zero spelling.
      expect(['0s', '1e-05s', '']).toContain(duration.split(',')[0]!.trim())
    })

    it('every ToastType clears AA text contrast (>=4.5:1) and non-text contrast (>=3:1) in light, dark, and forced colors', async () => {
      const types = ['info', 'success', 'warning', 'error', 'loading', 'custom'] as const
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

    it('places every real ToastType and every real toast placement, LTR and RTL', async () => {
      const types = ['info', 'success', 'warning', 'error', 'loading', 'custom'] as const
      // Types carrying their own real color cue — real painted BORDER
      // colors, never a CSS-string comparison. Border, not background, is
      // the cue both skins actually use: the baseline recipe mixes a
      // per-type hue into `border-color` (menus-overlays.css), and the
      // registry recipe differentiates by `data-[type=…]:border-*`
      // (border/icon color) while leaving `background` uniformly
      // `bg-popover` — so a background-only check is a false positive
      // against the registry skin, not a real per-type visual regression.
      // `loading` has NO color cue in either skin by design (a neutral,
      // in-progress toast should not read as an alert color) — it instead
      // gets its own NON-COLOR glyph, asserted below for every type
      // (loading included), which is what closes #265's finding that it
      // used to be distinguished only by `cursor: progress`.
      const coloredTypes = ['info', 'success', 'warning', 'error', 'custom'] as const
      const paintedBorders: string[] = []
      for (const toastType of types) {
        const page = await openCase(path, 'component:toast', toastType)
        const root = page.locator('#case [data-scope="toast"][data-part="root"]')
        expect(await root.getAttribute('data-type')).toBe(toastType)
        if ((coloredTypes as readonly string[]).includes(toastType)) {
          const border = await root.evaluate((node) => getComputedStyle(node).borderColor)
          const [painted] = await paintedColors(page, [border])
          paintedBorders.push(bucketedKey(painted!))
        }
        // Every type — including `loading` — shows exactly one visible
        // glyph: the baseline's `[data-part='type-icon'][data-icon=…]` or
        // the registry's per-type Lucide `<svg>`, both gated purely by
        // `data-type` (never resolved once in JS), so an `update` patching
        // a mounted toast's `type` swaps the visible glyph with no rebuild.
        const visibleIcons = await root.evaluate((node) => {
          // Baseline: `[data-part='type-icon']`. Registry: the per-type
          // Lucide `<svg>` set, each carrying its own `group-data-[type=…]/
          // toast:` gate class — deliberately excludes the always-visible
          // `ToastClose` `<svg>`, which carries no such class.
          const candidates = node.querySelectorAll('[data-part="type-icon"], svg[class*="/toast:"]')
          let count = 0
          for (const el of candidates) {
            if (getComputedStyle(el).display !== 'none') count++
          }
          return count
        })
        expect(visibleIcons, `${path}/${toastType} visible icon count`).toBe(1)
      }
      // Every real ToastType with its own colour cue must paint a genuinely
      // distinct border — never collapse to one shared visual.
      expect(new Set(paintedBorders).size).toBe(coloredTypes.length)

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
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    openPages.push(page)
    await page.goto(urls.baseline)
    await page.waitForFunction(() => typeof window.__mountMenusOverlaysBaselineCase === 'function')
    await page.evaluate(
      ({ contract }) => {
        const mount = window.__mountMenusOverlaysBaselineCase!
        mount(contract, { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'dialog-host' })
        mount(contract, {
          scenarioId: 'component:context-menu',
          caseId: 'open',
          hostId: 'menu-host',
        })
      },
      { contract },
    )
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
   * overlays" finding: z-order via `elementFromPoint`, Escape/outside
   * dismissing only the TOP layer, focus trap on the top modal, focus
   * restore to its own trigger on close, and `aria-hidden`/`inert` on the
   * layer(s) beneath a modal.
   */
  describe.each(['baseline', 'registryTailwind'] as const)(
    '%s renderer, stacked overlays',
    (path) => {
      async function openTwo(
        first: { scenarioId: string; caseId: string; hostId: string },
        second: { scenarioId: string; caseId: string; hostId: string },
      ): Promise<Page> {
        const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
        openPages.push(page)
        await page.goto(urls[path])
        const fn = MOUNT_FN[path]
        await page.waitForFunction((name) => typeof window[name as keyof Window] === 'function', fn)
        await page.evaluate(
          ({ fn, contract, first, second }) => {
            const mount = window[fn as keyof Window] as (c: unknown, r: MountRequest) => void
            mount(contract, first)
            mount(contract, second)
          },
          { fn, contract, first, second },
        )
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
        await page.evaluate(
          ({ fn, contract }) => {
            const mount = window[fn as keyof Window] as (c: unknown, r: MountRequest) => void
            mount(contract, { scenarioId: 'component:menu', caseId: 'open', hostId: 'menu-host-2' })
          },
          { fn: MOUNT_FN[path], contract },
        )
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

      it('nested Dialogs (both modal): focus stays trapped in a dialog, and Escape/outside-press dismiss only the top (later-mounted) one', async () => {
        const page = await openTwo(
          { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'outer' },
          { scenarioId: 'component:dialog', caseId: 'modal', hostId: 'inner' },
        )
        const outerContent = page.locator('#outer [data-scope="dialog"][data-part="content"]')
        const innerContent = page.locator('#inner [data-scope="dialog"][data-part="content"]')
        expect(await outerContent.isVisible()).toBe(true)
        expect(await innerContent.isVisible()).toBe(true)

        // Focus trap: SOME dialog's content owns focus on mount (never the
        // page body/background) — each modal dialog activates its own trap
        // on mount, in mount order.
        const activeInsideADialog = await page.evaluate(
          () =>
            document.activeElement?.closest('[data-scope="dialog"][data-part="content"]') !==
              null && document.activeElement?.tagName !== 'BODY',
        )
        expect(activeInsideADialog).toBe(true)

        // A real outside pointer press dismisses only the top (later-mounted,
        // inner) layer — the outer modal Dialog stays open and mounted.
        await page.mouse.click(2, 2)
        await innerContent.waitFor({ state: 'hidden' })
        expect(await outerContent.isVisible()).toBe(true)
      })
    },
  )
})
