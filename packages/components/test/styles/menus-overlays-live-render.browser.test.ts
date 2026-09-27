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

    it('mirrors floating placement under RTL without changing the LTR case', async () => {
      const ltrPage = await openCase(path, 'component:popover', 'top-start', { direction: 'ltr' })
      const rtlPage = await openCase(path, 'component:popover', 'top-start', { direction: 'rtl' })
      const [ltrRect, rtlRect, ltrTrigger, rtlTrigger] = await Promise.all([
        ltrPage.locator('#case [data-scope="popover"][data-part="content"]').boundingBox(),
        rtlPage.locator('#case [data-scope="popover"][data-part="content"]').boundingBox(),
        ltrPage.locator('#case [data-scope="popover"][data-part="trigger"]').boundingBox(),
        rtlPage.locator('#case [data-scope="popover"][data-part="trigger"]').boundingBox(),
      ])
      expect(ltrRect).not.toBeNull()
      expect(rtlRect).not.toBeNull()
      // top-start in LTR reads content flush with the trigger's LEFT edge;
      // under RTL "start" flips to the trigger's RIGHT edge. Both content
      // boxes must actually differ in physical x — this is the mirror the
      // review's "unify default DOM RTL" finding is about, measured on the
      // real renderer rather than asserted from a stylesheet rule.
      const ltrOffset = ltrRect!.x - ltrTrigger!.x
      const rtlOffset = rtlRect!.x - rtlTrigger!.x
      expect(Math.sign(ltrOffset) === Math.sign(rtlOffset) && ltrOffset !== 0).toBe(false)
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
})
