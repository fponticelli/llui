// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import { prebuildFixture, type PrebuiltFixture } from '../../../scripts/lib/prebuilt-fixture.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'browser')

// The shapes the History API path cannot get right, in real Chromium (which has
// the Navigation API): each is run with the router using it, and again with it
// forced off (`browserRouterEnv({ navigation: false })`), which is what a
// browser without the Navigation API runs. See `browser/navigation-api.fixture.ts`
// for how each scenario is driven.
//
// With the Navigation API every scenario ends consistent — the URL shows the
// route the application shows, nothing the guard refused is dispatched, and the
// stack is intact. Forced off, the same scenarios reproduce the History path's
// documented limits: that half is pinned so a regression in EITHER path is seen,
// and so the difference between them is measured rather than asserted.

type Scenario =
  | 'foreign-push'
  | 'typed-fragment-across'
  | 'typed-fragment-onto'
  | 'same-delta'
  | 'maybe-lapsed'

interface Outcome {
  dispatches: string[]
  app: string
  showing: string
  /** Every traversal the page asked for and every landing, in order. */
  log: string[]
  /** `navigation.entries()` as routes, bottom first, and the current index. */
  entries: string[]
  index: number
}

interface Expected {
  /**
   * Landings the outcome requires — the precondition waited for before
   * quiescence, so a restore still in flight is never read as "no restore".
   */
  landings: number
  outcome: Outcome
}

interface Case {
  scenario: Scenario
  mode: 'hash' | 'history'
  navigation: Expected
  /** `null`: not driven in the browser on the History path (see the case). */
  history: Expected | null
}

/** The entry the fixture document loads on, below everything in history mode. */
const DOC = 'unmatched /navigation-api.fixture.html'

const CASES: Case[] = [
  // `home | /tracker (foreign pushState) | a`, blocked `go(-2)` onto `home`.
  // History path: the push after the foreign entry opened a new run, so the two
  // positions are incomparable and the URL is left on the refused route.
  ...(['hash', 'history'] as const).map(
    (mode): Case => ({
      scenario: 'foreign-push',
      mode,
      navigation: {
        landings: 2,
        outcome: {
          dispatches: [],
          app: 'a',
          showing: 'a',
          log: ['go(-2)', 'landed home', 'traverseTo(a)', 'landed a'],
          entries:
            mode === 'hash'
              ? ['home', 'unmatched #/tracker', 'a']
              : [DOC, 'home', 'unmatched /tracker', 'a'],
          index: mode === 'hash' ? 2 : 3,
        },
      },
      history: {
        landings: 1,
        outcome: {
          dispatches: [],
          app: 'a',
          showing: 'home',
          log: ['go(-2)', 'landed home'],
          entries:
            mode === 'hash'
              ? ['home', 'unmatched #/tracker', 'a']
              : [DOC, 'home', 'unmatched /tracker', 'a'],
          index: mode === 'hash' ? 0 : 1,
        },
      },
    }),
  ),
  // `home | a | b (typed into the address bar) | c`, blocked `go(-2)` onto `a`,
  // across the typed entry — which ends the History path's run.
  {
    scenario: 'typed-fragment-across',
    mode: 'hash',
    navigation: {
      landings: 2,
      outcome: {
        dispatches: [],
        app: 'c',
        showing: 'c',
        log: ['go(-2)', 'landed a', 'traverseTo(c)', 'landed c'],
        entries: ['home', 'a', 'b', 'c'],
        index: 3,
      },
    },
    history: {
      landings: 1,
      outcome: {
        dispatches: [],
        app: 'c',
        showing: 'a',
        log: ['go(-2)', 'landed a'],
        entries: ['home', 'a', 'b', 'c'],
        index: 1,
      },
    },
  },
  // The same stack, a blocked back ONTO the typed entry, which has no position.
  {
    scenario: 'typed-fragment-onto',
    mode: 'hash',
    navigation: {
      landings: 2,
      outcome: {
        dispatches: [],
        app: 'c',
        showing: 'c',
        log: ['landed b', 'traverseTo(c)', 'landed c'],
        entries: ['home', 'a', 'b', 'c'],
        index: 3,
      },
    },
    history: {
      landings: 1,
      outcome: {
        dispatches: [],
        app: 'c',
        showing: 'b',
        log: ['landed b'],
        entries: ['home', 'a', 'b', 'c'],
        index: 2,
      },
    },
  },
  // On `a`, a blocked back onto `home`; the user's forward — the same size as
  // the restore — is queued ahead of it. History path: the user's landing is
  // indistinguishable from the restore's, so it is taken as the router's, and
  // the real restore then carries the user on to `b`, which is dispatched.
  //
  // Navigation path, measured: Chromium runs the user's `go(1)` and the
  // router's `traverseTo(a)` — same destination, both queued — as ONE traversal
  // carrying the router's `info`, so there is one landing and it is the
  // router's own. Were they run as two, the user's landing would dispatch `a`
  // and the router's would find nothing to do; either way the app and the URL
  // agree on `a`. What is pinned is what Chromium does.
  ...(['hash', 'history'] as const).map(
    (mode): Case => ({
      scenario: 'same-delta',
      mode,
      navigation: {
        landings: 2,
        outcome: {
          dispatches: [],
          app: 'a',
          showing: 'a',
          log: ['landed home', 'go(1)', 'traverseTo(a)', 'landed a'],
          entries: mode === 'hash' ? ['home', 'a', 'b', 'c'] : [DOC, 'home', 'a', 'b', 'c'],
          index: mode === 'hash' ? 1 : 2,
        },
      },
      history: {
        landings: 3,
        outcome: {
          dispatches: ['b'],
          app: 'b',
          showing: 'b',
          log: ['landed home', 'go(1)', 'go(1)', 'landed a', 'landed b'],
          entries: mode === 'hash' ? ['home', 'a', 'b', 'c'] : [DOC, 'home', 'a', 'b', 'c'],
          index: mode === 'hash' ? 2 : 3,
        },
      },
    }),
  ),
  // On `home`, a blocked `go(2)` onto `b`; the user's back is queued ahead of
  // the restore and lands on `a`, and the app then navigates to `c` before the
  // restore runs. The restore lands on `home` — the router's own landing, sent
  // on to `c`, never dispatched.
  //
  // NOT driven on the History path in the browser, because what it does there
  // is not a property of the router: measured, Chromium resolved the stale
  // `history.go(-2)` against the entry BEFORE the app's push (the browser
  // process had not yet learned of it), so it landed below the stack — on the
  // fixture document in history mode, off the document entirely in hash mode.
  // `test/traversal-event-order.test.ts` sweeps this shape on both paths in a
  // model with the spec's first-in-first-out semantics.
  ...(['hash', 'history'] as const).map(
    (mode): Case => ({
      scenario: 'maybe-lapsed',
      mode,
      navigation: {
        landings: mode === 'hash' ? 5 : 4,
        outcome: {
          dispatches: ['a', 'c'],
          app: 'c',
          showing: 'c',
          log: [
            'go(2)',
            'landed b',
            'go(-1)',
            'traverseTo(home)',
            'landed a',
            // The app's own fragment navigation fires `popstate` in hash mode.
            ...(mode === 'hash' ? ['landed c'] : []),
            'landed home',
            'traverseTo(c)',
            'landed c',
          ],
          entries: mode === 'hash' ? ['home', 'a', 'c'] : [DOC, 'home', 'a', 'c'],
          index: mode === 'hash' ? 2 : 3,
        },
      },
      history: null,
    }),
  ),
]

describe('guard-blocked traversals the History API cannot undo, in Chromium', () => {
  let browser: Browser
  let fixture: PrebuiltFixture

  beforeAll(async () => {
    fixture = await prebuildFixture({
      root: fixtureRoot,
      inputs: ['navigation-api.fixture.html'],
      alias: {
        '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
      },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    browser = await hermetic.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    await fixture?.close()
  })

  /**
   * One scenario in a FRESH context: every scenario traverses relative to its
   * own stack, and a page reused across them would carry the previous one's
   * entries below it (and a traversal past the bottom leaves the document).
   */
  async function run(c: Case, navigation: boolean, landings: number): Promise<Outcome> {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const nav = navigation ? 'on' : 'off'
      await page.goto(`${fixture.url('navigation-api.fixture.html')}?mode=${c.mode}&nav=${nav}`)
      // The fixture assigns its hooks synchronously in a module script, which
      // has run by the time `goto` resolves on `load`.
      expect(await page.evaluate(() => window.__navigationApiReady)).toBe(true)
      // The precondition of the whole file: the env hands the router the
      // Navigation API exactly when asked to.
      expect(await page.evaluate(() => window.__routerUsesNavigation)).toBe(navigation)
      return await page.evaluate(([scenario, min]) => window.__runScenario(scenario, min), [
        c.scenario,
        landings,
      ] as const)
    } finally {
      await context.close()
    }
  }

  for (const c of CASES) {
    it(`${c.scenario}, ${c.mode} mode — Navigation API: the URL and the application agree`, async () => {
      const outcome = await run(c, true, c.navigation.landings)
      expect(outcome).toEqual(c.navigation.outcome)
      // The invariants, stated on their own so a re-pin cannot quietly drop one.
      expect(outcome.showing).toBe(outcome.app)
      expect(outcome.entries[outcome.index]).toBe(outcome.showing)
    })

    const history = c.history
    if (history !== null) {
      it(`${c.scenario}, ${c.mode} mode — History API fallback: the documented limit`, async () => {
        expect(await run(c, false, history.landings)).toEqual(history.outcome)
      })
    }
  }
})
