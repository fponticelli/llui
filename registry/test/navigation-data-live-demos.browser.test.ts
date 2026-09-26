// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../scripts/lib/vite-source-aliases.mjs'

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

async function openDemo(browser: Browser, demo: Demo): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
  await page.goto(demo.url)
  await page.locator(`#${demo.carouselId}`).waitFor({ state: 'attached' })
  return page
}

describe('actual navigation/data demos in Chromium', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  let demos: Demo[] = []

  beforeAll(async () => {
    const [baseline, registry] = await Promise.all([
      startExample('examples/components-demo'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registry.server]
    demos = [
      {
        path: 'baseline',
        url: baseline.url,
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
        url: registry.url,
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
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  it('keeps owned demo utilities logical instead of baking in LTR spacing or alignment', () => {
    const sources = [
      'examples/components-demo/src/sections/data.ts',
      'examples/registry-demo/src/sections/data.ts',
      'examples/registry-demo/src/sections/media.ts',
      'examples/registry-demo/src/sections/navigation.ts',
    ].map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
    const physicalUtility =
      /(?:^|\s)(?:text-(?:left|right)|[mp][lr]-|[mp][lr]x-|border-[lr](?:-|\b)|rounded-[lr](?:-|\b))/gm
    expect(sources.flatMap((source) => source.match(physicalUtility) ?? [])).toEqual([])
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
      await page.evaluate(async ({ triggerId, contentId }) => {
        const trigger = document.getElementById(triggerId) as HTMLButtonElement
        const content = document.getElementById(contentId) as HTMLElement
        trigger.click()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        trigger.click()
        if (content.dataset['state'] !== 'closing' || content.hidden) {
          throw new Error('Exit was not retained after interrupting enter')
        }
      }, disclosure)
      await page.waitForTimeout(40)
      expect(await page.locator(`[id="${disclosure.contentId}"]`).getAttribute('data-state')).toBe(
        'closing',
      )
      await page.waitForFunction(
        (contentId) => document.getElementById(contentId)?.dataset['state'] === 'closed',
        disclosure.contentId,
        { timeout: 1500 },
      )
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
