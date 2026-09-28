// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../../scripts/lib/prebuilt-fixture.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'browser')

// The model in `traversal-event-order.test.ts` sweeps every order in which a
// user traversal can race the router's restore of a blocked one. This is the
// shape that reproduced the bug, in real Chromium: from `home`, forward onto
// the refused `a`; the "user" queues `go(2)` BEFORE the router queues its
// restoring `go(-1)`. The user lands on `c`, which the guard accepts; then the
// stale restore moves the browser to `b`. The router must recognise that
// landing as its own, send the browser back to `c`, and dispatch nothing for
// it. Before the fix it dispatched `b` and left the user there.

describe('a user traversal queued ahead of the router’s restore, in Chromium', () => {
  let browser: Browser
  let page: Page
  let fixture: PrebuiltFixture

  beforeAll(async () => {
    fixture = await prebuildFixture({
      root: fixtureRoot,
      inputs: ['restore-race.fixture.html'],
      alias: {
        '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
      },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await fixture?.close()
  })

  for (const mode of ['hash', 'history'] as const) {
    it(`${mode} mode: ends where the user's accepted traversal went, dispatching only it`, async () => {
      await page.goto(`${fixture.url('restore-race.fixture.html')}?mode=${mode}`)
      // The fixture assigns its hooks synchronously in a module script, which
      // has run by the time `goto` resolves on `load`.
      expect(await page.evaluate(() => window.__restoreRaceReady)).toBe(true)
      const result = await page.evaluate(() => window.__runRestoreRace(2))

      // The precondition, asserted rather than assumed: the user's `go(2)` was
      // queued before the router's restoring `go(-1)`, and ran first.
      expect(result.log.slice(0, 4)).toEqual(['landed a', 'go(2)', 'go(-1)', 'landed c'])
      expect(result).toEqual({
        dispatches: ['c'],
        showing: 'c',
        // The stale restore lands on `b`; the router recognises it as its own
        // and sends the browser back to `c` without dispatching either landing.
        log: ['landed a', 'go(2)', 'go(-1)', 'landed c', 'landed b', 'go(1)', 'landed c'],
      })
    })
  }
})
