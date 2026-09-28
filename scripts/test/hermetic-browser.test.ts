import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright'

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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(req.url === '/data' ? 'local-ok' : '<!doctype html><title>probe</title>')
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
