// A HERMETIC browser for vitest suites: every request any page of it makes is
// decided by `scripts/lib/network-policy.mjs` — the same function and the same
// Iconify fixture `pnpm smoke:examples` uses — and an undeclared off-origin
// request FAILS the suite, naming the URL and the page that asked for it.
//
// Why a suite needs this even when it asserts nothing about the network: the
// suites that load a demo requested `api.iconify.design` live and no assertion
// looked at the answer, so they depended on the network SILENTLY — glyphs
// painted on a networked CI runner, requests failed in a sandbox, and both
// runs were green over different pages. A test whose page differs between two
// environments without either noticing is not testing one thing.
//
// Usage — at the top level of the test file (or in a `describe` body), NOT in
// a hook, because it registers vitest hooks of its own:
//
//   const hermetic = useHermeticBrowser()
//   beforeAll(async () => { browser = await hermetic.launch({ headless: true }) })
//
// Every context the browser creates (`newContext`, and the one behind
// `newPage`) is routed before the call returns, with service workers blocked so
// no fetch can bypass the route. Local means any loopback port: suites serve
// prebuilt fixtures, Vite servers and path documents on ephemeral ports.
//
// The check runs after EACH test and once more after the file (a request made
// from a `beforeAll`, or after the last test, is still reported). Inside
// `describe.concurrent` an offending request is reported by the next test to
// finish, which may not be the one that made it — the message names the page,
// which is what identifies it. `scripts/test/hermetic-browser-coverage.test.ts`
// fails the build if a test launches Playwright any other way.

import { afterAll, afterEach, beforeAll } from 'vitest'

import { loopback, routeContext } from './network-policy.mjs'

/**
 * Route every context `browser` creates from now on. Exported for the unit
 * test; suites use `useHermeticBrowser`. Typed by `hermetic-browser.d.mts`.
 *
 * @type {typeof import('./hermetic-browser.mjs').guardBrowser}
 */
export const guardBrowser = (browser, onUnexpected) => {
  const newContext = browser.newContext.bind(browser)
  const newPage = browser.newPage.bind(browser)
  const hooks = { isLocal: loopback, onUnexpected }
  // Each context is routed exactly once, whichever path created it: today's
  // Playwright implements `newPage` ON TOP of `newContext`, and a route
  // registered twice would decide (and report) every request twice.
  /** @type {WeakSet<import('playwright').BrowserContext>} */
  const routed = new WeakSet()
  /** @param {import('playwright').BrowserContext} context */
  const route = async (context) => {
    if (routed.has(context)) return
    routed.add(context)
    await routeContext(context, hooks)
  }
  browser.newContext = async (options) => {
    const context = await newContext({ serviceWorkers: 'block', ...options })
    await route(context)
    return context
  }
  // Wrapped as well, so the guarantee does not rest on that implementation
  // detail. The page is still `about:blank` when the route lands, and it is
  // returned only after that, so nothing it loads escapes.
  browser.newPage = async (options) => {
    const page = await newPage({ serviceWorkers: 'block', ...options })
    await route(page.context())
    return page
  }
  return browser
}

/**
 * Throw, once, for every refused request recorded since the last check.
 *
 * @type {typeof import('./hermetic-browser.mjs').assertNoUnexpectedRequests}
 */
export const assertNoUnexpectedRequests = (pending) => {
  if (pending.length === 0) return
  const found = pending.splice(0)
  throw new Error(
    `hermetic browser: ${found.length} unexpected network request(s) — nothing may leave the machine (scripts/lib/network-policy.mjs):\n  ${found.join('\n  ')}`,
  )
}

/**
 * Register the per-test and per-file checks and return a launcher whose
 * browsers are hermetic. Call it at collection time (file top level or a
 * `describe` body), ahead of the hook that launches — never inside a hook or a
 * test.
 *
 * @type {typeof import('./hermetic-browser.mjs').useHermeticBrowser}
 */
export const useHermeticBrowser = () => {
  /** @type {string[]} */
  const pending = []
  const check = () => assertNoUnexpectedRequests(pending)
  // PROOF THE CHECKS ARE LIVE. Vitest accepts a hook registered after its
  // suite was collected (from inside a `beforeAll`, say) and then never runs
  // it — silently, measured — which would leave a browser that refuses
  // requests but fails nothing. This `beforeAll` is registered in the same
  // call as the checks, so once it has run they are live; `launch` refuses
  // until it has.
  let armed = false
  beforeAll(() => {
    armed = true
  })
  afterEach(check)
  afterAll(check)
  return {
    launch: async (options) => {
      if (!armed) {
        throw new Error(
          'useHermeticBrowser(): launch() before its checks were armed. Call useHermeticBrowser() while the file is COLLECTED — at its top level or in a describe body, ahead of the hook that launches — never inside a hook or a test, where vitest accepts hooks that then never run.',
        )
      }
      // Imported on first launch, not at module load: `@llui/mcp` treats
      // Playwright as OPTIONAL and skips its browser suite when it is absent,
      // which a static import here would turn into a load failure.
      const { chromium } = await import('playwright')
      return guardBrowser(await chromium.launch(options), (message) => pending.push(message))
    },
  }
}
