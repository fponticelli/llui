// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import type { Alias } from 'vite'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { prebuildFixture, type PrebuiltFixture } from '../../../../scripts/lib/prebuilt-fixture.mjs'
import { loadProductContract } from './navigation-data-contract-source'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

/**
 * Closes the #264 review gap explicitly: density/closing-phase claims must be
 * measured against the REAL scenario renderer's output, in real Chromium —
 * never hand-written HTML standing in for it (that was the pre-existing
 * `navigation-data.browser.test.ts` fixture's "compact scenario geometry"
 * test, which is a real regression guard for the STYLESHEET but was never
 * evidence for the RENDERER). This file mounts
 * `mountBaselineNavigationDataScenarios` / `mountRegistryNavigationDataScenarios`
 * through a prebuilt fixture per path (`examples/baseline-css` for the
 * Baseline theme, `examples/registry-demo` for the Registry skins) and measures real
 * `getBoundingClientRect()` geometry and real `data-state`/`aria-hidden`/
 * `inert` on the live DOM those renderers produce.
 */

const repoRoot = resolve(import.meta.dirname, '../../../..')
const contract = loadProductContract()

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
  // The registry-demo example app's OWN `@/` alias points at ITS copied
  // `src/components/ui` / `src/lib`, not the registry SOURCE this test loads
  // directly (`registry/test/navigation-data-scenario-renderer.ts` imports
  // `registry/llui/ui/*.ts`, whose files import `@/lib/utils` / `@/ui/*`
  // exactly as a real `llui add` consumer's copy would).
  { find: '@/lib', replacement: resolve(repoRoot, 'registry/llui/lib') },
  { find: '@/ui', replacement: resolve(repoRoot, 'registry/llui/ui') },
]

// Built once and served static (`scripts/lib/prebuilt-fixture.mjs`) rather
// than by a Vite dev server: a dev server compiled the app on demand inside
// the first test to navigate, re-sent its whole unbundled module graph to
// every fresh page, and shared the example's dependency-optimizer cache with
// every concurrent suite serving the same example (see that module's header).
const FIXTURE = 'src/test-fixtures/navigation-data-live-render.html'

function buildExample(directory: string): Promise<PrebuiltFixture> {
  return prebuildFixture({
    root: resolve(repoRoot, directory),
    inputs: [FIXTURE],
    alias: sourceAliases,
  })
}

interface Fixture {
  readonly path: 'baseline' | 'registryTailwind'
  readonly url: string
  readonly mountFn: '__mountNavigationDataBaseline' | '__mountNavigationDataRegistry'
}

declare global {
  interface Window {
    __mountNavigationDataBaseline?: (contract: unknown) => void
    __mountNavigationDataRegistry?: (contract: unknown) => void
  }
}

describe('navigation/data scenario renderer, mounted live in Chromium (#264 item C)', () => {
  let browser: Browser
  let builds: PrebuiltFixture[] = []
  let fixtures: Fixture[] = []

  beforeAll(async () => {
    const [baseline, registryTailwind, launched] = await Promise.all([
      buildExample('examples/baseline-css'),
      buildExample('examples/registry-demo'),
      hermetic.launch({ headless: true }),
    ])
    builds = [baseline, registryTailwind]
    browser = launched
    fixtures = [
      {
        path: 'baseline',
        url: baseline.url(FIXTURE),
        mountFn: '__mountNavigationDataBaseline',
      },
      {
        path: 'registryTailwind',
        url: registryTailwind.url(FIXTURE),
        mountFn: '__mountNavigationDataRegistry',
      },
    ]
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(builds.map((build) => build.close()))
  })

  /** A page on the fixture, its mount function loaded but NOT yet called. */
  async function openUnmounted(fixture: Fixture): Promise<Page> {
    const page = await browser.newPage()
    await page.goto(fixture.url)
    await page.waitForFunction((fn) => typeof window[fn] === 'function', fixture.mountFn)
    return page
  }

  async function openMounted(fixture: Fixture): Promise<Page> {
    const page = await openUnmounted(fixture)
    await page.evaluate(
      ({ fn, contract }) => {
        const mount = window[fn]
        if (mount === undefined) throw new Error(`Missing window.${fn}`)
        mount(contract)
      },
      { fn: fixture.mountFn, contract },
    )
    await page
      .locator('[data-scenario-id="component:avatar"][data-scenario-case="compact"]')
      .waitFor({ state: 'attached' })
    return page
  }

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s renders a genuinely denser, still-usable compact avatar/table/data-table against the real renderer output',
    async (path) => {
      const fixture = fixtures.find((candidate) => candidate.path === path)!
      const page = await openMounted(fixture)
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (element === null) throw new Error(`Missing element for ${selector}`)
          return element.getBoundingClientRect()
        }
        const avatarComfortable = rect(
          '[data-scenario-id="component:avatar"][data-scenario-case="loaded"] [data-scope="avatar"][data-part="root"]',
        )
        const avatarCompact = rect(
          '[data-scenario-id="component:avatar"][data-scenario-case="compact"] [data-scope="avatar"][data-part="root"]',
        )
        const tableComfortableHeader = rect(
          '[data-scenario-id="component:table"][data-scenario-case="default"] [data-part="column-header"]',
        )
        const tableCompactHeader = rect(
          '[data-scenario-id="component:table"][data-scenario-case="compact"] [data-part="column-header"]',
        )
        // pattern:data-table wraps the SAME table machine, and its `default`
        // case is keyed `populated` (a phase, not a density) — the compact
        // case keeps the same rows so only density varies.
        const dataTableComfortableHeader = rect(
          '[data-scenario-id="pattern:data-table"][data-scenario-case="populated"] [data-part="column-header"]',
        )
        const dataTableCompactHeader = rect(
          '[data-scenario-id="pattern:data-table"][data-scenario-case="compact"] [data-part="column-header"]',
        )
        return {
          avatarComfortable,
          avatarCompact,
          tableComfortableHeader,
          tableCompactHeader,
          dataTableComfortableHeader,
          dataTableCompactHeader,
        }
      })
      await page.close()

      expect(geometry.avatarCompact.width).toBeLessThan(geometry.avatarComfortable.width)
      expect(geometry.avatarCompact.height).toBeLessThan(geometry.avatarComfortable.height)
      expect(geometry.avatarCompact.height).toBeGreaterThanOrEqual(16)
      expect(geometry.tableCompactHeader.height).toBeLessThan(
        geometry.tableComfortableHeader.height,
      )
      expect(geometry.tableCompactHeader.height).toBeGreaterThanOrEqual(16)
      expect(geometry.dataTableCompactHeader.height).toBeLessThan(
        geometry.dataTableComfortableHeader.height,
      )
      expect(geometry.dataTableCompactHeader.height).toBeGreaterThanOrEqual(16)
    },
  )

  it('registryTailwind renders a genuinely denser, still-usable compact item/sidebar against the real renderer output (baseline has no registry-only presentational atoms to compare)', async () => {
    const fixture = fixtures.find((candidate) => candidate.path === 'registryTailwind')!
    const page = await openMounted(fixture)
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (element === null) throw new Error(`Missing element for ${selector}`)
        return element.getBoundingClientRect()
      }
      // `registry:item`'s adapter mounts a bare `Item(...)` as the scenario
      // case root's only child — no machine, no `data-part`, so the direct
      // child is the one stable handle onto its recipe's padding.
      const itemComfortable = rect(
        '[data-scenario-id="registry:item"][data-scenario-case="default"] > *',
      )
      const itemCompact = rect(
        '[data-scenario-id="registry:item"][data-scenario-case="compact"] > *',
      )
      // `registry:sidebar`'s adapter renders exactly one <button> (the
      // SidebarMenuButton) anywhere in its subtree.
      const sidebarComfortable = rect(
        '[data-scenario-id="registry:sidebar"][data-scenario-case="expanded"] button',
      )
      const sidebarCompact = rect(
        '[data-scenario-id="registry:sidebar"][data-scenario-case="compact"] button',
      )
      const sidebarRoomy = rect(
        '[data-scenario-id="registry:sidebar"][data-scenario-case="roomy"] button',
      )
      return { itemComfortable, itemCompact, sidebarComfortable, sidebarCompact, sidebarRoomy }
    })
    await page.close()

    expect(geometry.itemCompact.height).toBeLessThan(geometry.itemComfortable.height)
    expect(geometry.itemCompact.height).toBeGreaterThanOrEqual(16)
    // Sidebar's `size="sm"`/`size="default"`/`size="lg"` are fixed-height
    // Tailwind classes (`h-7`/`h-8`/`h-12`), not padding around variable
    // content, so their pixel heights are exact at the default 16px root
    // font size. `lg` is sidebar's genuinely tested THIRD real skin level
    // (#264 review item 6) — every other density-applicable product in this
    // family stops at two.
    expect(geometry.sidebarCompact.height).toBeCloseTo(28, 0)
    expect(geometry.sidebarComfortable.height).toBeCloseTo(32, 0)
    expect(geometry.sidebarRoomy.height).toBeCloseTo(48, 0)
  })

  // The closing case is a LIVE exit: both skins run a 0.2 s `accordion-up`
  // animation on `[data-state="closing"]` that collapses `block-size` to 0, and
  // the exit watcher (`exitCompletion`) settles the item to `closed` on its
  // `animationend`. So "visibly retained" is a property of the START of the
  // exit, and reading it in a later Playwright round trip after the mount is a
  // race against the page's animation clock: under load (19-26) the read
  // landed at the end of the animation (`accordion: expected 0 to be greater
  // than 0`, 1 of 7 runs), and a later read would miss `closing` altogether.
  // Both reads now happen IN-PAGE: the retention snapshot in the same task as
  // the mount — no frame can pass in between, so the animation is at its
  // first keyframe by construction — and the exit's end is recorded by a
  // MutationObserver on the page's own clock, then awaited.
  it.each(['baseline', 'registryTailwind'] as const)(
    '%s retains the accordion/collapsible closing case visibly, driven by the real reducer',
    async (path) => {
      const fixture = fixtures.find((candidate) => candidate.path === path)!
      const page = await openUnmounted(fixture)
      const closing = await page.evaluate(
        async ({ fn, contract }) => {
          const ids = ['component:accordion', 'component:collapsible'] as const
          const startedAt = performance.now()
          const mount = window[fn]
          if (mount === undefined) throw new Error(`Missing window.${fn}`)
          mount(contract)
          const probes = ids.map((scenarioId) => {
            const root = document.querySelector<HTMLElement>(
              `[data-scenario-id="${scenarioId}"][data-scenario-case="closing"]`,
            )
            if (root === null) throw new Error(`Missing closing case for ${scenarioId}`)
            const content = root.querySelector<HTMLElement>('[data-state="closing"]')
            if (content === null) {
              throw new Error(`Missing [data-state="closing"] for ${scenarioId} right after mount`)
            }
            // Synchronous with the mount: the exit animation has not advanced.
            const style = getComputedStyle(content)
            const retained = {
              display: style.display,
              ariaHidden: content.getAttribute('aria-hidden'),
              inert: content.hasAttribute('inert'),
              height: content.getBoundingClientRect().height,
              exitAnimationMs: Number.parseFloat(style.animationDuration) * 1000,
            }
            // Armed in the same task, so no transition out of `closing` is missed.
            const exited = new Promise<{ afterMs: number; state: string | null }>((resolve) => {
              const observer = new MutationObserver(() => {
                const state = content.getAttribute('data-state')
                if (state === 'closing') return
                observer.disconnect()
                resolve({ afterMs: performance.now() - startedAt, state })
              })
              observer.observe(content, { attributes: true, attributeFilter: ['data-state'] })
            })
            return { scenarioId, retained, exited }
          })
          return Promise.all(
            probes.map(async ({ scenarioId, retained, exited }) => ({
              scenarioId,
              retained,
              exit: await exited,
            })),
          )
        },
        { fn: fixture.mountFn, contract },
      )
      await page.close()

      expect(closing.map((entry) => entry.scenarioId)).toEqual([
        'component:accordion',
        'component:collapsible',
      ])
      for (const { scenarioId, retained, exit } of closing) {
        expect(retained.display, scenarioId).not.toBe('none')
        expect(retained.ariaHidden, scenarioId).toBe('true')
        expect(retained.inert, scenarioId).toBe(true)
        expect(retained.height, scenarioId).toBeGreaterThan(0)
        // A real exit animation is what the retention is for…
        expect(retained.exitAnimationMs, scenarioId).toBeGreaterThan(0)
        // …and the content stays retained for all of it, then settles closed
        // (animationend cannot fire before start + duration on the page clock).
        expect(exit.state, scenarioId).toBe('closed')
        expect(exit.afterMs, scenarioId).toBeGreaterThanOrEqual(retained.exitAnimationMs)
      }
    },
  )

  it.each(['baseline', 'registryTailwind'] as const)(
    "%s gallery table sorts the REAL rows and keeps every row's index/checkbox reactive",
    async (path) => {
      const fixture = fixtures.find((candidate) => candidate.path === path)!
      const page = await openMounted(fixture)
      const result = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>(
          '[data-scenario-id="component:table"][data-scenario-case="default"] [data-scope="table"][data-part="root"]',
        )
        if (root === null) throw new Error('Missing component:table default case root')
        const nameHeader = root.querySelector<HTMLElement>(
          '[data-part="column-header"][data-sortable]',
        )
        if (nameHeader === null) throw new Error('Missing sortable column header')
        const rowIdsBefore = [...root.querySelectorAll<HTMLElement>('[data-part="row"]')].map(
          (row) => row.dataset['row'],
        )
        // Two clicks: ascending (already the seeded order, so a DOM diff
        // alone would not prove anything moved) then descending — the
        // second click is what actually reorders alpha/beta.
        nameHeader.click()
        nameHeader.click()
        const rowsAfter = [...root.querySelectorAll<HTMLElement>('[data-part="row"]')]
        const rowIdsAfter = rowsAfter.map((row) => row.dataset['row'])
        const reactiveIndexMatchesDomPosition = rowsAfter.every((row, domIndex) => {
          const cell = row.querySelector<HTMLElement>('[data-part="cell"]')
          return (
            row.getAttribute('aria-rowindex') === String(domIndex + 2) &&
            cell?.getAttribute('aria-colindex') === '1'
          )
        })
        const selectAllBefore = root
          .querySelector('[data-part="select-all"]')
          ?.getAttribute('aria-checked')
        const firstRow = rowsAfter[0]
        if (firstRow === undefined) throw new Error('No rows after sort')
        firstRow.click()
        const selectAllAfter = root
          .querySelector('[data-part="select-all"]')
          ?.getAttribute('aria-checked')
        return {
          sortAttr: nameHeader.getAttribute('aria-sort'),
          rowIdsBefore,
          rowIdsAfter,
          reactiveIndexMatchesDomPosition,
          selectAllBefore,
          selectAllAfter,
          firstRowChecked: firstRow.getAttribute('aria-selected'),
        }
      })
      await page.close()

      expect(result.rowIdsBefore).toEqual(['alpha', 'beta'])
      expect(result.rowIdsAfter).toEqual(['beta', 'alpha'])
      expect(result.sortAttr).toBe('descending')
      expect(result.reactiveIndexMatchesDomPosition).toBe(true)
      expect(result.selectAllBefore).toBe('false')
      expect(result.selectAllAfter).toBe('mixed')
      expect(result.firstRowChecked).toBe('true')
    },
  )
})
