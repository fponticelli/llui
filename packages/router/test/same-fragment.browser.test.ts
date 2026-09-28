// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../../scripts/lib/prebuilt-fixture.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'browser')

/**
 * The two deliveries the HTML spec permits for a blocked traversal and its
 * restore: each step fires `popstate` while it is applied and QUEUES its
 * `hashchange`, and the restore is applied by a task on a different source, so
 * the event loop may run it before the first `hashchange`.
 */
const NATURAL_ORDER = ['popstate', 'hashchange', 'popstate', 'hashchange']
const RESTORE_FIRST = ['popstate', 'popstate', 'hashchange', 'hashchange']

/**
 * Main-thread stalls tried in turn, shortest first, until Chromium delivers
 * {@link RESTORE_FIRST}. Measured: 5 ms already forces it on every run on this
 * machine, so the first entry has a 10x margin and the later ones exist only
 * for a runner loaded enough that the restore's IPC round trip outlasts it.
 * Every attempt is asserted in full — escalating the STIMULUS is not a retry of
 * the assertion.
 */
const STALLS_MS = [50, 200, 800]

// Both restore paths: `nav=on` restores with the Navigation API's `traverseTo`
// (what Chromium runs by default), `nav=off` with the History API's
// `history.go` (what a browser without the Navigation API runs). The event
// orders at stake are the same on both — a traversal task racing a queued
// `hashchange`.
describe('same-fragment history traversal in Chromium (#163)', () => {
  let browser: Browser
  let page: Page
  let fixture: PrebuiltFixture
  let fixtureUrl: string

  beforeAll(async () => {
    fixture = await prebuildFixture({
      root: fixtureRoot,
      inputs: ['same-fragment.fixture.html'],
      alias: {
        '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
      },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    fixtureUrl = fixture.url('same-fragment.fixture.html')

    browser = await hermetic.launch({ headless: true })
    page = await browser.newPage()
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await fixture?.close()
  })

  /** A fresh document per run: the fixture's recorders and history are per page. */
  async function run(stallMs: number, nav: 'on' | 'off') {
    await page.goto(`${fixtureUrl}?nav=${nav}`)
    // The fixture assigns its hooks synchronously in a module script, which has
    // run by the time `goto` resolves on `load`.
    expect(await page.evaluate(() => window.__sameFragmentReady)).toBe(true)
    return page.evaluate((stall) => window.__runSameFragmentTraversal(stall), stallMs)
  }

  function expectSameFragmentLanding(result: Awaited<ReturnType<typeof run>>): void {
    expect(result.sameFragment).toEqual({
      events: ['popstate'],
      marker: 'entry-1',
      dispatches: ['login'],
    })
  }

  function expectRestoredWithoutDispatch(result: Awaited<ReturnType<typeof run>>): void {
    const { events, ...rest } = result.blockedRestore
    expect([NATURAL_ORDER, RESTORE_FIRST]).toContainEqual(events)
    expect(rest).toEqual({ marker: 'entry-1', hash: '#/login', dispatches: [] })
  }

  for (const nav of ['on', 'off'] as const) {
    it(`Navigation API ${nav}: adopts a same-fragment landing and restores a later block from that position`, async () => {
      const result = await run(0, nav)
      expectSameFragmentLanding(result)
      // Either legal delivery order: which one the browser picks is load-
      // dependent, and the router's outcome must not be.
      expectRestoredWithoutDispatch(result)
    })

    it(`Navigation API ${nav}: restores without dispatching when the restore is applied before the blocked hashchange`, async () => {
      const seen: string[][] = []
      for (const stallMs of STALLS_MS) {
        const result = await run(stallMs, nav)
        expectSameFragmentLanding(result)
        expectRestoredWithoutDispatch(result)
        seen.push(result.blockedRestore.events)
        if (result.blockedRestore.events.join() === RESTORE_FIRST.join()) break
      }
      // Non-vacuity: the order under test was actually delivered at least once.
      expect(seen).toContainEqual(RESTORE_FIRST)
    })
  }
})
