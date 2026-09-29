import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
  type Page,
} from 'playwright'

import {
  assertNoUnexpectedRequests,
  guardBrowser,
  useHermeticBrowser,
} from '../lib/hermetic-browser.mjs'

/**
 * The browser half of the hermetic network policy: what `guardBrowser` does to
 * a REAL Chromium, and that `useHermeticBrowser`'s hooks turn a refused request
 * into a red test. The decision function itself is pinned without a browser by
 * `network-policy.test.ts`.
 */

const UNEXPECTED = 'https://hermetic-probe.example.com/leak.js'

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      res.end(`self.addEventListener('fetch', () => {})`)
      return
    }
    // CORS-open, so a page can also read it under the STUB host name below.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(
      new URL(req.url ?? '/', 'http://x').pathname === '/data'
        ? 'local-ok'
        : '<!doctype html><title>probe</title>',
    )
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((ok) => {
    server.closeAllConnections()
    server.close(() => ok())
  })
})

/** What a page-side `fetch` saw: the body, or the rejection. */
async function fetchFrom(page: Page, url: string): Promise<string> {
  return page.evaluate(async (target) => {
    try {
      const response = await fetch(target)
      return `${response.status}:${await response.text()}`
    } catch (error) {
      return `rejected:${String(error)}`
    }
  }, url)
}

describe('guardBrowser context options', () => {
  for (const via of ['newPage', 'newContext'] as const) {
    it(`forces service workers off through ${via}`, async () => {
      let passed: BrowserContextOptions | undefined
      const context = {
        on: () => context,
        pages: () => [],
        route: async () => {},
        routeWebSocket: async () => {},
      } as unknown as BrowserContext
      const page = { context: () => context } as Page
      const browser = {
        newContext: (options?: BrowserContextOptions) => {
          passed = options
          return Promise.resolve(context)
        },
        newPage: (options?: BrowserContextOptions) => {
          passed = options
          return Promise.resolve(page)
        },
      } as Browser
      const guarded = guardBrowser(browser, () => {})

      if (via === 'newPage') await guarded.newPage({ serviceWorkers: 'allow' })
      else await guarded.newContext({ serviceWorkers: 'allow' })

      expect(passed?.serviceWorkers).toBe('block')
    })
  }
})

describe('guardBrowser (a real Chromium)', () => {
  // A launcher of our own, so this describe owns its refused-request log
  // instead of sharing `useHermeticBrowser`'s hooks.
  const refused: string[] = []
  let browser: Browser

  beforeAll(async () => {
    browser = guardBrowser(await chromium.launch({ headless: true }), (m) => refused.push(m))
  })

  afterAll(async () => {
    await browser?.close()
  })

  for (const via of ['newPage', 'newContext'] as const) {
    it(`routes a context made by ${via}: local passes, Iconify is the fixture, the rest is refused`, async () => {
      refused.length = 0
      const page =
        via === 'newPage' ? await browser.newPage() : await (await browser.newContext()).newPage()
      await page.goto(`${origin}/`)

      expect(await fetchFrom(page, `${origin}/data`)).toBe('200:local-ok')

      const icon = await fetchFrom(page, 'https://api.iconify.design/lucide.json?icons=check')
      expect(icon.startsWith('200:')).toBe(true)
      const payload: unknown = JSON.parse(icon.slice(4))
      expect(payload).toMatchObject({ prefix: 'lucide', icons: { check: {} } })

      // A declared failure fails in the page and is NOT a violation.
      expect(await fetchFrom(page, 'https://example.invalid/a.png')).toMatch(/^rejected:/)
      expect(refused).toEqual([])

      // Anything else never leaves the machine, and is recorded naming the URL
      // and the page that made it.
      expect(await fetchFrom(page, UNEXPECTED)).toMatch(/^rejected:/)
      expect(refused).toHaveLength(1)
      expect(refused[0]).toContain(UNEXPECTED)
      expect(refused[0]).toContain(`requested by ${origin}/`)

      // So does an undeclared glyph: the fixture is exact.
      await fetchFrom(page, 'https://api.iconify.design/lucide.json?icons=not-in-the-fixture')
      expect(refused[1]).toContain('"lucide:not-in-the-fixture"')

      // And an off-origin WebSocket.
      await page.evaluate(() => {
        new WebSocket('wss://hermetic-probe.example.com/socket')
      })
      await expect.poll(() => refused.length).toBe(3)
      expect(refused[2]).toContain('wss://hermetic-probe.example.com/socket')
      await page.context().close()
    })
  }

  it('blocks service workers, whose fetches would bypass the route', async () => {
    const page = await browser.newPage()
    await page.goto(`${origin}/`)
    expect(page.context().serviceWorkers()).toEqual([])
    // Playwright blocks by making `register` resolve to nothing; unblocked, the
    // same call returns a real registration for this valid worker script.
    const outcome = await page.evaluate(async () => {
      const registration: unknown = await navigator.serviceWorker.register('/sw.js')
      const registrations = await navigator.serviceWorker.getRegistrations()
      return { registered: registration !== undefined, count: registrations.length }
    })
    expect(outcome).toEqual({ registered: false, count: 0 })
    await page.context().close()
  })

  for (const via of ['newPage', 'newContext'] as const) {
    it(`blocks service workers even when ${via} requests them`, async () => {
      const page =
        via === 'newPage'
          ? await browser.newPage({ serviceWorkers: 'allow' })
          : await (await browser.newContext({ serviceWorkers: 'allow' })).newPage()
      try {
        await page.goto(`${origin}/`)
        const registration = await page.evaluate(async () => {
          const worker = await navigator.serviceWorker.register('/sw.js')
          return worker !== undefined
        })
        expect(registration).toBe(false)
      } finally {
        await page.context().close()
      }
    })
  }
})

/**
 * THE ROUTE-ORDER BYPASS. Playwright runs the NEWEST matching route handler
 * first, so a suite that registers its own `route(…)` after the guard and
 * calls `continue()` (or `fulfill()`) decides the request before the guard's
 * handler ever sees it. The guard therefore also OBSERVES every request
 * (`request` events fire whatever the handlers decide) and every opened
 * WebSocket, and judges each against the same policy.
 *
 * There is no network here, so the "external" host is made REAL and
 * deterministic with Chromium's own resolver override: `stub.hermetic.example`
 * resolves to the local server. A request that gets through therefore
 * actually completes, and each case asserts that it did — the bypass is live,
 * not assumed — before asserting that it was reported.
 */
describe('the guard does not depend on route order', () => {
  const STUB_HOST = 'stub.hermetic.example'
  const refused: string[] = []
  let browser: Browser

  beforeAll(async () => {
    const port = new URL(origin).port
    browser = guardBrowser(
      await chromium.launch({
        headless: true,
        args: [`--host-resolver-rules=MAP ${STUB_HOST} 127.0.0.1:${port}`],
      }),
      (message) => refused.push(message),
    )
  })

  afterAll(async () => {
    await browser?.close()
  })

  async function freshPage(): Promise<Page> {
    refused.length = 0
    const page = await browser.newPage()
    await page.goto(`${origin}/`)
    return page
  }

  it('reports an external request a LATER context route let through with continue()', async () => {
    const page = await freshPage()
    const context = page.context()
    await context.route(`http://${STUB_HOST}/**`, (route) => route.continue())
    const url = `http://${STUB_HOST}/data`
    // It really left the page and reached the (stubbed) external host.
    expect(await fetchFrom(page, url)).toBe('200:local-ok')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toContain(url)
    expect(refused[0]).toContain(`requested by ${origin}/`)
    await context.close()
  })

  it('reports one a PAGE route (which runs before every context route) let through', async () => {
    const page = await freshPage()
    await page.route(`http://${STUB_HOST}/**`, (route) => route.continue())
    const url = `http://${STUB_HOST}/data?via=page`
    expect(await fetchFrom(page, url)).toBe('200:local-ok')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toContain(url)
    await page.context().close()
  })

  it('reports one a suite route answered itself: external hosts are declared in the policy, not stubbed per suite', async () => {
    const page = await freshPage()
    await page.route(`https://${STUB_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        body: 'suite-stub',
      }),
    )
    const url = `https://${STUB_HOST}/stubbed.json`
    expect(await fetchFrom(page, url)).toBe('200:suite-stub')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toContain(url)
    await page.context().close()
  })

  it('reports an external WebSocket a later routeWebSocket connected to its server', async () => {
    const page = await freshPage()
    const context = page.context()
    let suiteHandled = false
    await context.routeWebSocket(/hermetic\.example/, (ws) => {
      suiteHandled = true
      ws.connectToServer()
    })
    const url = `ws://${STUB_HOST}/socket`
    await page.evaluate((target) => {
      new WebSocket(target)
    }, url)
    // The suite's handler, not the guard's, decided it: the bypass is live.
    await expect.poll(() => suiteHandled).toBe(true)
    await expect.poll(() => refused.length).toBe(1)
    expect(refused[0]).toContain(url)
    await context.close()
  })

  it('still reports a request the guard itself blocked exactly ONCE (route and observer do not double-count)', async () => {
    const page = await freshPage()
    expect(await fetchFrom(page, UNEXPECTED)).toMatch(/^rejected:/)
    await page.evaluate(() => {
      new WebSocket('wss://hermetic-probe.example.com/once')
    })
    await expect.poll(() => refused.length).toBe(2)
    // Settle, then prove no late duplicate arrives.
    await page.waitForTimeout(250)
    expect(refused).toHaveLength(2)
    expect(refused[0]).toContain(UNEXPECTED)
    expect(refused[1]).toContain('wss://hermetic-probe.example.com/once')
    await page.context().close()
  })
})

describe('useHermeticBrowser fails a test whose own route let an external request through', () => {
  const STUB_HOST = 'stub.hermetic.example'
  const hermetic = useHermeticBrowser()
  let browser: Browser

  beforeAll(async () => {
    browser = await hermetic.launch({
      headless: true,
      args: [`--host-resolver-rules=MAP ${STUB_HOST} 127.0.0.1:${new URL(origin).port}`],
    })
  })

  afterAll(async () => {
    await browser?.close()
  })

  // Green ONLY because the guard's afterEach reddened it. Drop the observer
  // and the suite route wins silently: the test passes and this goes red.
  it.fails('a continue() route on an external host is a failure, not a pass', async () => {
    const page = await browser.newPage()
    await page.goto(`${origin}/`)
    await page.route(`http://${STUB_HOST}/**`, (route) => route.continue())
    expect(await fetchFrom(page, `http://${STUB_HOST}/data`)).toBe('200:local-ok')
    await page.close()
  })
})

describe('the declared types (hermetic-browser.d.mts)', () => {
  // `skipLibCheck` covers the declaration, so a broken import in it would
  // degrade these to `any` silently. Pinned here, where `check:scripts` sees it.
  it('are the real Playwright types, not any', () => {
    expectTypeOf(useHermeticBrowser).returns.toHaveProperty('launch')
    expectTypeOf<ReturnType<ReturnType<typeof useHermeticBrowser>['launch']>>().toEqualTypeOf<
      Promise<Browser>
    >()
    expectTypeOf<Parameters<ReturnType<typeof useHermeticBrowser>['launch']>>().toEqualTypeOf<
      [options?: LaunchOptions]
    >()
    expectTypeOf(guardBrowser).parameters.toEqualTypeOf<[Browser, (message: string) => void]>()
    expectTypeOf(assertNoUnexpectedRequests).parameters.toEqualTypeOf<[string[]]>()
  })
})

describe('assertNoUnexpectedRequests', () => {
  it('throws once, naming every URL, and drains', () => {
    const pending = ['one https://a.example.com/', 'two https://b.example.com/']
    expect(() => assertNoUnexpectedRequests(pending)).toThrow(
      /2 unexpected network request\(s\)[\s\S]*a\.example\.com[\s\S]*b\.example\.com/,
    )
    expect(pending).toEqual([])
    expect(() => assertNoUnexpectedRequests(pending)).not.toThrow()
  })
})

describe('useHermeticBrowser turns a refused request into a RED test', () => {
  const hermetic = useHermeticBrowser()
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await hermetic.launch({ headless: true })
    page = await browser.newPage()
    await page.goto(`${origin}/`)
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('passes a test whose page stays on the machine', async () => {
    expect(await fetchFrom(page, `${origin}/data`)).toBe('200:local-ok')
    await fetchFrom(page, 'https://api.iconify.design/lucide.json?icons=x')
  })

  // `it.fails` inverts: this is green ONLY because the hook reddened it. Take
  // the `afterEach` out of `useHermeticBrowser` and this test goes red.
  it.fails('fails a test whose page made an unexpected request, in the afterEach', async () => {
    expect(await fetchFrom(page, UNEXPECTED)).toMatch(/^rejected:/)
  })

  it('reports each refusal once: the next test starts clean', async () => {
    expect(await fetchFrom(page, `${origin}/data`)).toBe('200:local-ok')
  })
})

describe('useHermeticBrowser refuses to launch when its checks cannot be live', () => {
  // Registered from INSIDE a hook, the way a misplaced call would be. Vitest
  // accepts the registration and never runs the hook — the reason `launch`
  // demands proof (its own `beforeAll`) before it hands out a browser.
  let late: ReturnType<typeof useHermeticBrowser> | undefined
  let lateHookRan = false

  beforeAll(() => {
    late = useHermeticBrowser()
    afterEach(() => {
      lateHookRan = true
    })
  })

  it('rejects launch() from a launcher created inside a hook', async () => {
    if (late === undefined) throw new Error('beforeAll did not run')
    await expect(late.launch({ headless: true })).rejects.toThrow(/before its checks were armed/)
  })

  it('because a hook registered from a hook never runs (the premise, pinned)', () => {
    expect(lateHookRan).toBe(false)
  })
})
