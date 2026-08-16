// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import type { RecordedGlide } from './flip-offset-parent.browser-fixture.js'

interface Scenario {
  fractionalDepth?: number
  position?: 'relative' | 'sticky'
  reorder?: boolean
  scroll?: 'page' | 'inner'
}

interface ReadCost {
  rect: number
  offsetLeft: number
  offsetTop: number
  clientLeft: number
  clientTop: number
  offsetParent: number
  style: number
}

async function newFlipPage(browser: Browser, origin: string): Promise<Page> {
  const page = await browser.newPage()
  await page.goto(`${origin}packages/transitions/src/flip.ts`)
  await page.addScriptTag({
    type: 'module',
    url: `${origin}packages/transitions/test/flip-offset-parent.browser-fixture.ts`,
  })
  await page.waitForFunction(() => '__createFlipHarness' in window)
  return page
}

async function runScenario(browser: Browser, origin: string, scenario: Scenario) {
  const page = await newFlipPage(browser, origin)

  const glides = await page.evaluate(async (change): Promise<RecordedGlide[]> => {
    const { fractionalAncestors, glides, list, rows, scroller, transition, wrapper } =
      await window.__createFlipHarness({ fractionalDepth: change.fractionalDepth })

    if (change.position) wrapper.style.position = change.position
    for (const ancestor of fractionalAncestors) ancestor.style.position = 'relative'
    if (change.scroll === 'page') scrollTo(0, 200)
    if (change.scroll === 'inner') {
      scroller.style.height = '90px'
      scroller.style.overflow = 'auto'
      scroller.scrollTop = 150
    }
    if (change.reorder !== false) list.insertBefore(rows[1]!, rows[0]!)
    transition.onTransition!({ entering: [], leaving: [], parent: list })

    return glides
  }, scenario)
  await page.close()
  return glides
}

describe('flip() offset-parent changes in Chromium (#217)', () => {
  let browser: Browser
  let vite: ViteDevServer
  let origin: string

  beforeAll(async () => {
    vite = await createServer({
      appType: 'custom',
      configFile: false,
      root: new URL('../../..', import.meta.url).pathname,
      optimizeDeps: { noDiscovery: true },
      server: { host: '127.0.0.1', port: 0 },
    })
    await vite.listen()
    origin = vite.resolvedUrls!.local[0]!
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    await vite?.close()
  })

  it.each(['relative', 'sticky'] as const)(
    'animates only the list displacement when a wrapper changes static → %s',
    async (position) => {
      const glides = await runScenario(browser, origin, { position })

      expect(glides).toEqual([
        { id: 'b', from: 'translate(0px, 60px)' },
        { id: 'a', from: 'translate(0px, -60px)' },
      ])
    },
  )

  it.each(['page', 'inner'] as const)(
    'continues to exclude %s-scroller movement from the row delta',
    async (scroll) => {
      const glides = await runScenario(browser, origin, { scroll })

      expect(glides).toEqual([
        { id: 'b', from: 'translate(0px, 60px)' },
        { id: 'a', from: 'translate(0px, -60px)' },
      ])
    },
  )

  it('does not animate any row for an offset-coordinate change alone', async () => {
    const glides = await runScenario(browser, origin, { position: 'relative', reorder: false })
    expect(glides).toEqual([])
  })

  it('does not mistake accumulated offset rounding for movement', async () => {
    const glides = await runScenario(browser, origin, { fractionalDepth: 5, reorder: false })
    expect(glides).toEqual([])
  })

  it('rebases visible rows independently when a hidden sibling has no offset parent', async () => {
    const page = await newFlipPage(browser, origin)
    const glides = await page.evaluate(async (): Promise<RecordedGlide[]> => {
      const { glides, list, transition, wrapper } = await window.__createFlipHarness({
        hiddenFirst: true,
        marginTop: 100,
      })
      wrapper.style.position = 'relative'
      transition.onTransition!({ entering: [], leaving: [], parent: list })
      return glides
    })
    await page.close()

    expect(glides).toEqual([])
  })

  it('costs three row geometry reads plus one shared offset-chain walk and one layout', async () => {
    const page = await newFlipPage(browser, origin)

    await page.evaluate(async () => {
      const { list, rows, transition, wrapper } = await window.__createFlipHarness()

      const counts: ReadCost = {
        rect: 0,
        offsetLeft: 0,
        offsetTop: 0,
        clientLeft: 0,
        clientTop: 0,
        offsetParent: 0,
        style: 0,
      }
      const findGetter = (object: object, key: keyof ReadCost): (() => unknown) => {
        let prototype: object | null = object
        while (prototype) {
          const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get
          if (getter) return getter
          prototype = Object.getPrototypeOf(prototype) as object | null
        }
        throw new Error(`No native getter for ${key}`)
      }
      const instrument = (element: HTMLElement, key: keyof ReadCost): void => {
        const getter = findGetter(element, key)
        Object.defineProperty(element, key, {
          configurable: true,
          get() {
            counts[key]++
            return getter.call(this)
          },
        })
      }
      for (const row of rows) {
        for (const key of ['offsetLeft', 'offsetTop', 'offsetParent'] as const) instrument(row, key)
        const getRect = row.getBoundingClientRect.bind(row)
        row.getBoundingClientRect = () => {
          counts.rect++
          return getRect()
        }
      }
      for (const key of [
        'offsetLeft',
        'offsetTop',
        'clientLeft',
        'clientTop',
        'offsetParent',
      ] as const)
        instrument(wrapper, key)
      const nativeComputedStyle = getComputedStyle
      window.getComputedStyle = (...args) => {
        counts.style++
        return nativeComputedStyle(...args)
      }
      // Keep the layout metric scoped to flip's synchronous pass. Native WAAPI
      // schedules its own follow-up animation layout, which can land before the
      // CDP metric is sampled on a loaded test runner and is not a forced layout
      // caused by the pass's read/write ordering.
      Element.prototype.animate = () => {
        const animation = new Animation()
        Object.defineProperty(animation, 'finished', { value: new Promise<void>(() => {}) })
        animation.cancel = () => {}
        return animation
      }
      ;(
        window as typeof window & {
          __runMeasuredFlip: () => ReadCost
        }
      ).__runMeasuredFlip = () => {
        wrapper.style.position = 'relative'
        list.insertBefore(rows[1]!, rows[0]!)
        transition.onTransition!({ entering: [], leaving: [], parent: list })
        return counts
      }
    })

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const layoutCount = async (): Promise<number> => {
      const { metrics } = await cdp.send('Performance.getMetrics')
      return metrics.find(({ name }) => name === 'LayoutCount')!.value
    }
    const before = await layoutCount()
    const cost = await page.evaluate(() =>
      (
        window as typeof window & {
          __runMeasuredFlip: () => ReadCost
        }
      ).__runMeasuredFlip(),
    )
    const after = await layoutCount()
    await page.close()

    expect(cost).toEqual({
      rect: 4,
      offsetLeft: 5,
      offsetTop: 5,
      clientLeft: 1,
      clientTop: 1,
      offsetParent: 5,
      style: 2,
    })
    expect(after - before).toBe(1)
  })
})
