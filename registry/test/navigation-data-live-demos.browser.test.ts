// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import type { Alias } from 'vite'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../scripts/lib/vite-source-aliases.mjs'
import { prebuildFixture, type PrebuiltFixture } from '../../scripts/lib/prebuilt-fixture.mjs'
import {
  navigationDataDemoTokens,
  navigationDataOwnedSectionFiles,
} from '../../scripts/lib/navigation-data-demo-sections.mjs'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  compileNavigationDataCatalog,
  joinNavigationDataScenarios,
} from '../../packages/components/test/styles/navigation-data-scenarios'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const repoRoot = resolve(import.meta.dirname, '../..')

// DERIVED from each package's own `exports` map, never hand-copied (#264): a
// hand-written `@llui/components/(.+)` -> `src/components/$1.ts` catch-all
// assumed every subpath lived under `src/components/`, which broke silently
// the moment `@llui/components/icon` shipped from `src/icon.ts` instead — Vite
// resolved nothing and the six `registryTailwind` cases importing it (through
// the registry's icon components) timed out rather than erroring. See
// `scripts/lib/vite-source-aliases.mjs` for the derivation and its own tests.
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
]

interface Demo {
  readonly path: 'baseline' | 'registryTailwind'
  readonly url: string
  readonly carouselId: string
  readonly tabsId: string
  readonly paginationId: string
  readonly tableId: string
  readonly dataTableId: string
  readonly disclosures: readonly {
    readonly product: 'accordion' | 'collapsible'
    readonly triggerId: string
    readonly contentId: string
  }[]
}

// Each demo is a whole app, BUILT once and served static
// (`scripts/lib/prebuilt-fixture.mjs`) rather than served by a Vite dev server.
// #268 moved the dev server's cold on-demand compile out of the charts test
// into this file's `beforeAll`, and that test still timed out at 30 s under a
// parallel `turbo test`: every test opens a FRESH page, and on a dev server a
// fresh page of either demo re-fetched its whole unbundled module graph (218
// and 259 requests, ~1.6-2.0 s per page at ambient load ~20 on 4 CPUs), while
// sharing each example's dependency-optimizer cache with every concurrent
// suite serving the same example — whose re-optimizations rewrite it and can
// force-reload a page mid-test. A built page is one document and its bundles.
function buildExample(directory: string, input: string): Promise<PrebuiltFixture> {
  return prebuildFixture({
    root: resolve(repoRoot, directory),
    inputs: [input],
    alias: sourceAliases,
  })
}

// The Baseline path's live composition lives in the Tailwind-free Baseline
// consumer (`examples/baseline-css/src/test-fixtures/compositions/navigation-data.ts`,
// moved there from the retired `examples/components-demo`); the Registry
// path's is the copied-source sync fixture's own app.
const BASELINE_FIXTURE = 'src/test-fixtures/compositions.html'

async function openDemo(browser: Browser, demo: Demo): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
  await page.goto(demo.url)
  await page.locator(`#${demo.carouselId}`).waitFor({ state: 'attached' })
  return page
}

describe('live navigation/data compositions in Chromium, both paths', () => {
  let browser: Browser
  let fixtures: PrebuiltFixture[] = []
  let demos: Demo[] = []

  beforeAll(async () => {
    const [baseline, registry, launched] = await Promise.all([
      buildExample('examples/baseline-css', BASELINE_FIXTURE),
      buildExample('examples/registry-demo', 'index.html'),
      hermetic.launch({ headless: true }),
    ])
    fixtures = [baseline, registry]
    browser = launched
    demos = [
      {
        path: 'baseline',
        url: baseline.url(BASELINE_FIXTURE),
        carouselId: 'car-demo',
        tabsId: 'tabs-demo',
        paginationId: 'pagination-demo',
        tableId: 'data-grid:root',
        dataTableId: 'dt-demo:root',
        disclosures: [
          {
            product: 'accordion',
            triggerId: 'acc-demo:trigger:why',
            contentId: 'acc-demo:content:why',
          },
          {
            product: 'collapsible',
            triggerId: 'coll-demo:trigger',
            contentId: 'coll-demo:content',
          },
        ],
      },
      {
        path: 'registryTailwind',
        url: registry.url('index.html'),
        carouselId: 'demo-carousel',
        tabsId: 'demo-tabs',
        paginationId: 'registry-pagination-demo',
        tableId: 'registry-table:root',
        dataTableId: 'registry-data-table:root',
        disclosures: [
          {
            product: 'accordion',
            triggerId: 'demo-faq:trigger:update',
            contentId: 'demo-faq:content:update',
          },
          {
            product: 'collapsible',
            triggerId: 'demo-collapsible:trigger',
            contentId: 'demo-collapsible:content',
          },
        ],
      },
    ]
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(fixtures.map((fixture) => fixture.close()))
  })

  // A per-FILE allowlist for genuinely VERBATIM-upstream shadcn recipe
  // strings a demo section copies inline (never a bare attribute/class name,
  // which would switch the whole file's check off — the same discipline
  // `registry-attrs.test.ts` documents). Every physical utility this guard
  // has ever found in an owned demo section was a defect to FIX, not a
  // pattern to allow (#264 item 8). Its one exception (#265: a NavigationMenu
  // indicator's `left-0` translate anchor, resolved against a re-measured
  // physical pixel offset) belonged to the retired Baseline showcase; the
  // Baseline path's live composition is now Tailwind-free and carries no
  // utility classes at all, so only the Registry path has sections to scan.
  // Empty, and still closed at both ends by the assertions below — an entry
  // that stops matching its file fails as obsolete.
  const PHYSICAL_UTILITY_ALLOWLIST: Readonly<
    Record<string, readonly { readonly match: string; readonly reason: string }[]>
  > = {}

  it('keeps every registry demo section that actually renders a navigation-data product logically laid out', () => {
    const contract = loadProductContract()
    const catalog = compileNavigationDataCatalog(contract)
    const joined = joinNavigationDataScenarios(catalog, contract)
    const tokens = navigationDataDemoTokens(joined)

    // DERIVED, never hand-picked (#264): every section file the registry
    // demo's own `app.ts` actually mounts, narrowed to the ones whose own import
    // specifiers name a navigation-data family machine or copied skin. A
    // hand-written 4-file list is exactly what let `charts.ts` — carrying
    // `text-left`/`pr-3`/`ml-auto`/`mr-1` — go unscanned.
    const files = [
      {
        appTsPath: resolve(repoRoot, 'examples/registry-demo/src/app.ts'),
        sectionsDir: resolve(repoRoot, 'examples/registry-demo/src/sections'),
      },
    ].flatMap((demo) => navigationDataOwnedSectionFiles(demo, tokens))
    // EXACT set, never a floor (#264 review item 6): `length > 0` cannot
    // detect OVER-collection — a token match too broad would silently pull
    // in every section file and still pass. Pinned to the current derived
    // membership; a token/section change that legitimately grows or shrinks
    // this set updates the list below, same as any other exact-set guard in
    // this repo.
    expect(files.map((file) => relative(repoRoot, file)).sort()).toEqual(
      [
        'examples/registry-demo/src/sections/advanced.ts',
        'examples/registry-demo/src/sections/charts.ts',
        'examples/registry-demo/src/sections/data.ts',
        'examples/registry-demo/src/sections/layout.ts',
        'examples/registry-demo/src/sections/media.ts',
        'examples/registry-demo/src/sections/navigation.ts',
        'examples/registry-demo/src/sections/overlays.ts',
        'examples/registry-demo/src/sections/patterns.ts',
        'examples/registry-demo/src/sections/presentational.ts',
        'examples/registry-demo/src/sections/shared.ts',
      ].sort(),
    )

    // Matches text-align, margin/padding (and their `x` shorthand), border
    // radius, border side, and — the addition #264 item 8 asks for — the
    // POSITIONAL utilities `left-*`/`right-*`/`inset-{l,r}-*`, each requiring
    // a value so a bare prefix (`overflow-left`, which does not exist, or a
    // class merely CONTAINING the substring) cannot match.
    // A Tailwind utility VALUE: a number/fraction (optionally negative),
    // `auto`/`full`/`px`, a bracketed arbitrary value, or a CSS-var
    // parenthesis — never a bare word, so prose like "left-to-right" (a
    // real comment in `charts.ts`) cannot match.
    const value = '(?:-?\\d[\\w./%]*|auto|full|px|\\[[^\\]]+\\]|\\([^)]+\\))'
    const leadingBoundary = '(?:^|[\\s"\'`])'
    // A Tailwind VARIANT prefix (`sm:`, `hover:`, `rtl:`, a stacked
    // `sm:hover:`, …) sits directly in front of the utility with no
    // whitespace, so `hover:pl-2` or `rtl:ml-2` never followed the
    // whitespace/quote `leadingBoundary` above and went entirely unscanned
    // (#264 review item 6) — the utility itself is identical, only preceded
    // by zero or more `word-chars:` segments. Captured as part of the match
    // so a found string names the exact variant combination, never just the
    // bare utility.
    const variantPrefix = '(?:[\\w-]+:)*'
    const physicalUtility = new RegExp(
      `${leadingBoundary}(${variantPrefix}(?:text-(?:left|right)\\b|[mp][lr]-${value}|[mp][lr]x-${value}|border-[lr](?:-${value}|\\b)|rounded-[lr](?:-${value}|\\b)|(?:left|right)-${value}|inset-[lr]-${value}))`,
      'gm',
    )

    for (const file of files) {
      const relPath = relative(repoRoot, file)
      const source = readFileSync(file, 'utf8')
      const found = [...source.matchAll(physicalUtility)].map((m) => m[1]!)
      const allowed = PHYSICAL_UTILITY_ALLOWLIST[relPath] ?? []
      const allowedMatches = new Set(allowed.map((entry) => entry.match))
      const unexpected = found.filter((match) => !allowedMatches.has(match))
      expect(unexpected, relPath).toEqual([])
      for (const entry of allowed) {
        expect(
          found.includes(entry.match),
          `${relPath}: allowlisted "${entry.match}" (${entry.reason}) no longer appears in this file — remove the stale entry`,
        ).toBe(true)
      }
    }
  })

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s resolves live RTL/LTR keyboard behavior for carousel, tabs, and pagination',
    async (path) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const page = await openDemo(browser, demo)
      const result = await page.evaluate(async ({ carouselId, tabsId, paginationId }) => {
        const press = (element: HTMLElement, key: string): void => {
          element.focus()
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          )
        }
        const selected = (rootId: string, selector: string): HTMLElement => {
          const element = document.querySelector<HTMLElement>(`#${rootId} ${selector}`)
          if (element === null) throw new Error(`Missing ${rootId} ${selector}`)
          return element
        }
        const directionPass = async (dir: 'ltr' | 'rtl', key: string) => {
          document.documentElement.dir = dir
          const carouselCurrent = selected(
            carouselId,
            '[data-part="indicator"][aria-selected="true"]',
          )
          const carouselBefore = Number(carouselCurrent.dataset['index'])
          press(carouselCurrent, key)
          const carouselAfter = Number(
            selected(carouselId, '[data-part="indicator"][aria-selected="true"]').dataset['index'],
          )

          const tabCurrent = selected(tabsId, '[data-part="trigger"][aria-selected="true"]')
          const tabBefore = tabCurrent.dataset['value']
          press(tabCurrent, key)
          const tabAfter = selected(tabsId, '[data-part="trigger"][aria-selected="true"]').dataset[
            'value'
          ]

          const pageCurrent = selected(paginationId, '[data-part="item"][aria-current="page"]')
          const pageBefore = Number(pageCurrent.dataset['value'])
          press(pageCurrent, key)
          const pageAfter = Number((document.activeElement as HTMLElement).dataset['value'])
          await Promise.resolve()
          return { carouselBefore, carouselAfter, tabBefore, tabAfter, pageBefore, pageAfter }
        }

        return {
          rtl: await directionPass('rtl', 'ArrowLeft'),
          ltr: await directionPass('ltr', 'ArrowRight'),
        }
      }, demo)
      await page.close()

      expect(result.rtl.carouselAfter).toBe(result.rtl.carouselBefore + 1)
      expect(result.rtl.tabAfter).not.toBe(result.rtl.tabBefore)
      expect(result.rtl.pageAfter).toBeGreaterThan(result.rtl.pageBefore)
      expect(result.ltr.carouselAfter).toBe(result.ltr.carouselBefore + 1)
      expect(result.ltr.tabAfter).not.toBe(result.ltr.tabBefore)
      expect(result.ltr.pageAfter).toBeGreaterThan(result.ltr.pageBefore)
    },
  )

  it.each([
    ['baseline', 'accordion'],
    ['baseline', 'collapsible'],
    ['registryTailwind', 'accordion'],
    ['registryTailwind', 'collapsible'],
  ] as const)(
    '%s %s interpolates a measured block-size at its real midpoint',
    async (path, product) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const disclosure = demo.disclosures.find((candidate) => candidate.product === product)!
      const page = await openDemo(browser, demo)
      const measured = await page.evaluate(async ({ triggerId, contentId }) => {
        const trigger = document.getElementById(triggerId) as HTMLButtonElement | null
        const content = document.getElementById(contentId) as HTMLElement | null
        if (trigger === null || content === null) throw new Error('Missing live disclosure parts')
        trigger.click()
        for (let frame = 0; frame < 10; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          if (
            content.style.getPropertyValue('--llui-disclosure-block-size') !== '' &&
            content.getAnimations().length > 0
          )
            break
        }
        const endpoint = Number.parseFloat(
          content.style.getPropertyValue('--llui-disclosure-block-size'),
        )
        const animation = content.getAnimations().find((candidate) => {
          const name = (candidate as CSSAnimation).animationName
          return name.endsWith('down')
        })
        if (animation === undefined) throw new Error('Disclosure enter animation never started')
        const duration = animation.effect?.getComputedTiming().duration
        if (typeof duration !== 'number') throw new Error('Disclosure duration is not numeric')
        animation.pause()
        animation.currentTime = duration / 2
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        return {
          endpoint,
          midpoint: Number.parseFloat(getComputedStyle(content).blockSize),
          outerMidpoint: content.getBoundingClientRect().height,
          naturalOuter: content.scrollHeight,
        }
      }, disclosure)
      await page.close()

      expect(measured.endpoint).toBeGreaterThan(0)
      expect(measured.midpoint).toBeGreaterThan(0)
      expect(measured.midpoint).toBeLessThan(measured.endpoint)
      expect(measured.outerMidpoint).toBeGreaterThan(0)
      expect(measured.outerMidpoint).toBeLessThan(measured.naturalOuter)
    },
  )

  it.each([
    ['baseline', 'accordion'],
    ['baseline', 'collapsible'],
    ['registryTailwind', 'accordion'],
    ['registryTailwind', 'collapsible'],
  ] as const)(
    '%s %s survives a rapid enter cancellation and completes its current exit',
    async (path, product) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const disclosure = demo.disclosures.find((candidate) => candidate.product === product)!
      const page = await openDemo(browser, demo)
      // The interrupted exit is driven through the Web Animations API, never
      // raced against a clock. A sleep in the test process read `data-state`
      // over a round trip that under load outlived the whole exit, and the
      // in-page `closedAfterMs >= 40` bound that replaced it still depended on
      // a timer landing before the animation did. Now, in the same task as the
      // interrupting click, the new exit's own CSS animation is PAUSED: the
      // item must stay `closing` across frames and a generous real wait (no
      // snap-shut or timer settle survives that), then, FINISHED, it must read
      // `closed` by the time that `animationend` reaches `window` — inside the
      // dispatch the exit completes on (see navigation-data-live-render's
      // closing test for the same technique on the rendered closing case).
      const exit = await page.evaluate(
        async ({ triggerId, contentId, pausedFrames, pausedWaitMs }) => {
          const trigger = document.getElementById(triggerId)
          const content = document.getElementById(contentId)
          if (!(trigger instanceof HTMLButtonElement) || content === null) {
            throw new Error('Missing live disclosure parts')
          }
          const nextFrame = (): Promise<void> =>
            new Promise((resolve) => requestAnimationFrame(() => resolve()))
          trigger.click()
          await nextFrame()
          trigger.click()
          if (content.dataset['state'] !== 'closing' || content.hidden) {
            throw new Error('Exit was not retained after interrupting enter')
          }
          const exitName = getComputedStyle(content).animationName
          const exits = content
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation && animation.animationName === exitName,
            )
          const current = exits[0]
          if (exits.length !== 1 || current === undefined) {
            throw new Error(`expected one "${exitName}" exit, found ${exits.length}`)
          }
          current.pause()
          const states = ['closing']
          new MutationObserver(() => {
            const state = content.dataset['state'] ?? '(none)'
            if (states.at(-1) !== state) states.push(state)
          }).observe(content, { attributes: true, attributeFilter: ['data-state'] })

          for (let frame = 0; frame < pausedFrames; frame += 1) await nextFrame()
          await new Promise<void>((resolve) => setTimeout(resolve, pausedWaitMs))
          const held = { states: [...states], playState: current.playState }

          const stateAtAnimationEnd = await new Promise<string | undefined>((resolve) => {
            const onEnd = (event: AnimationEvent): void => {
              if (event.target !== content || event.animationName !== exitName) return
              window.removeEventListener('animationend', onEnd)
              resolve(content.dataset['state'])
            }
            window.addEventListener('animationend', onEnd)
            current.finish()
          })
          return { held, stateAtAnimationEnd, states: [...states] }
        },
        { ...disclosure, pausedFrames: 10, pausedWaitMs: 1_000 },
      )
      expect(exit.held).toEqual({ states: ['closing'], playState: 'paused' })
      expect(exit.stateAtAnimationEnd).toBe('closed')
      expect(exit.states).toEqual(['closing', 'closed'])
      expect(
        await page.locator(`[id="${disclosure.contentId}"]`).getAttribute('hidden'),
      ).not.toBeNull()
      await page.close()
    },
  )

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s composes the live table and data-table machines through every public table part',
    async (path) => {
      const demo = demos.find((candidate) => candidate.path === path)!
      const page = await openDemo(browser, demo)
      const result = await page.evaluate(({ tableId, dataTableId }) => {
        const press = (element: HTMLElement, key: string): void => {
          element.focus()
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          )
        }
        const inspect = (rootId: string) => {
          const root = document.getElementById(rootId) as HTMLTableElement | null
          if (root === null) throw new Error(`Missing live table root ${rootId}`)
          const viewport = root.parentElement
          if (viewport?.matches('[data-scope="table"][data-part="viewport"]') !== true) {
            throw new Error(`${rootId} is not directly owned by the public table viewport`)
          }
          const headers = [...root.querySelectorAll<HTMLElement>('[data-part="column-header"]')]
          const rows = [...root.querySelectorAll<HTMLElement>('[data-part="row"]')]
          const cells = [...root.querySelectorAll<HTMLElement>('[data-part="cell"]')]
          const rowCheckboxes = [
            ...root.querySelectorAll<HTMLElement>('[data-part="row-checkbox"]'),
          ]
          const selectAll = root.querySelector<HTMLElement>('[data-part="select-all"]')
          if (
            headers.length === 0 ||
            rows.length === 0 ||
            cells.length !== rows.length * headers.length ||
            rowCheckboxes.length !== rows.length ||
            selectAll === null
          ) {
            throw new Error(`${rootId} does not consume every public table part`)
          }

          const firstCell = cells[0]!
          const selectAllBefore = selectAll.getAttribute('aria-checked')
          // The row-id order in DOM order, BEFORE sorting. `data-row` names
          // the id the machine tracks; comparing this set/order against the
          // post-sort snapshot below is what actually proves a sort moves the
          // ROWS themselves, not just the header's `aria-sort` — a machine
          // that only flips sort STATE without the consumer's resort
          // follow-up passes every OTHER assertion here unchanged.
          const rowIdsBefore = rows.map((row) => row.dataset['row'])
          press(firstCell, 'ArrowUp')
          const focusedHeader = document.activeElement as HTMLElement
          press(focusedHeader, 'ArrowRight')
          const rovedHeader = document.activeElement as HTMLElement
          headers[1]!.click()
          const rowsAfterSort = [...root.querySelectorAll<HTMLElement>('[data-part="row"]')]
          const rowIdsAfter = rowsAfterSort.map((row) => row.dataset['row'])
          // Every row's `aria-rowindex`/`data-row-index` must reflect its
          // CURRENT DOM position after the reorder above, not whatever it was
          // built with — a frozen (`.peek()`'d) index would leave these
          // stuck at their ORIGINAL position while the rows themselves moved.
          const reactiveIndexMatchesDomPosition = rowsAfterSort.every((row, domIndex) => {
            const cell = row.querySelector<HTMLElement>('[data-part="cell"]')
            return (
              row.getAttribute('aria-rowindex') === String(domIndex + 2) &&
              cell?.dataset['rowIndex'] === String(domIndex)
            )
          })
          const liveFirstRow = root.querySelector<HTMLElement>('[data-part="row"]')!
          liveFirstRow.click()

          const originalViewportStyle = viewport.getAttribute('style')
          const originalRootStyle = root.getAttribute('style')
          viewport.style.inlineSize = '240px'
          root.style.minInlineSize = '800px'
          const overflow = {
            overflowX: getComputedStyle(viewport).overflowX,
            local: viewport.scrollWidth > viewport.clientWidth,
            documentContained:
              document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          }
          if (originalViewportStyle === null) viewport.removeAttribute('style')
          else viewport.setAttribute('style', originalViewportStyle)
          if (originalRootStyle === null) root.removeAttribute('style')
          else root.setAttribute('style', originalRootStyle)

          document.documentElement.dir = 'rtl'
          const liveLogicalParts = [
            ...root.querySelectorAll<HTMLElement>('[data-part="column-header"]'),
            ...root.querySelectorAll<HTMLElement>('[data-part="cell"]'),
          ]
          const logicalStyles = liveLogicalParts.map((element) => getComputedStyle(element))
          const logicalRtl =
            logicalStyles.every(
              ({ direction, textAlign }) =>
                direction === 'rtl' && textAlign !== 'left' && textAlign !== 'right',
            ) && logicalStyles.some(({ textAlign }) => textAlign === 'start')

          // Exactly ONE viewport must own this table — never a second,
          // redundant scrollport nested around the machine's own one (the
          // split `Table`/`TableViewport` this registry used to ship as two
          // components forced every consumer to nest the machine's viewport
          // part INSIDE a second wrapper div).
          let viewportCount = 0
          for (
            let ancestor = root.parentElement;
            ancestor !== null;
            ancestor = ancestor.parentElement
          ) {
            if (ancestor.matches('[data-scope="table"][data-part="viewport"]')) viewportCount++
          }

          return {
            rootId,
            tag: root.tagName,
            viewportCount,
            headerCount: headers.length,
            rowCount: rows.length,
            cellCount: cells.length,
            firstCellRole: firstCell.getAttribute('role'),
            focusedHeader: focusedHeader.dataset['colIndex'],
            rovedHeader: rovedHeader.dataset['colIndex'],
            sorted: headers[1]!.getAttribute('aria-sort'),
            selected: liveFirstRow.getAttribute('aria-selected'),
            rowIdsBefore,
            rowIdsAfter,
            reactiveIndexMatchesDomPosition,
            selectAllBefore,
            selectAllAfter: selectAll.getAttribute('aria-checked'),
            overflow,
            logicalRtl,
            logicalAlignments: logicalStyles.map(({ direction, textAlign }) => ({
              direction,
              textAlign,
            })),
          }
        }
        return {
          table: inspect(tableId),
          dataTable: inspect(dataTableId),
          dataTableStatusParts: ['loading-overlay', 'empty-state', 'error-state'].every((part) =>
            document.querySelector(`[data-scope="data-table"][data-part="${part}"]`),
          ),
        }
      }, demo)
      await page.close()

      for (const candidate of [result.table, result.dataTable]) {
        expect(candidate.logicalRtl, JSON.stringify(candidate.logicalAlignments)).toBe(true)
        expect(candidate).toMatchObject({
          tag: 'TABLE',
          headerCount: 3,
          firstCellRole: 'gridcell',
          focusedHeader: '0',
          rovedHeader: '1',
          sorted: 'ascending',
          selected: 'true',
          selectAllBefore: 'false',
          selectAllAfter: 'mixed',
          overflow: { overflowX: 'auto', local: true, documentContained: true },
          reactiveIndexMatchesDomPosition: true,
          viewportCount: 1,
        })
        expect(candidate.rowCount).toBeGreaterThan(0)
        expect(candidate.cellCount).toBe(candidate.rowCount * candidate.headerCount)
        // The sort click above must ACTUALLY reorder the rows in the DOM, not
        // merely flip the header's `aria-sort` while every row stays exactly
        // where it started.
        expect(candidate.rowIdsAfter).not.toEqual(candidate.rowIdsBefore)
      }
      // The plain (unpaginated) table always shows every row, so a resort
      // must be the SAME set, reordered — unlike the paginated data-table
      // below, where a resort can legitimately change which rows are on the
      // CURRENT page.
      expect([...result.table.rowIdsAfter].sort()).toEqual([...result.table.rowIdsBefore].sort())
      expect(result.dataTableStatusParts).toBe(true)
    },
  )
})
