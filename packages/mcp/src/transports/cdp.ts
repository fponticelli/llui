import type { CdpTransport, ConsoleEntry, NetworkEntry, ErrorEntry } from '../tool-registry.js'

export class CdpError extends Error {
  constructor(
    public readonly code:
      | 'cdp_unavailable'
      | 'dev_url_unknown'
      | 'attach_timeout'
      | 'browser_crashed',
    message: string,
  ) {
    super(message)
    this.name = 'CdpError'
  }
}

interface CdpSession {
  mode: 'user-chrome' | 'playwright-owned'
  browser: import('playwright').Browser | null
  page: import('playwright').Page
  consoleBuffer: ConsoleEntry[]
  networkBuffer: NetworkEntry[]
  errorBuffer: ErrorEntry[]
}

/**
 * How long the Playwright fallback may take to ATTACH: navigate to the dev URL
 * and see the app expose `__lluiDebug`. One deadline covers both steps.
 *
 * Sized from measurement, not taste. Against `examples/virtualization` on a
 * dev server, at load ~19 on 4 CPUs: 0.7-1.2 s cold, 0.5-1.0 s warm. The
 * slow case this must still admit is a large app's FIRST on-demand compile,
 * measured at 7.3-9.0 s under similar load for the components demo
 * (`docs/agents/tests-and-load.md`, loose-d) — so 30 s leaves ~3x over the
 * worst real attach and ~25x over a typical one, while a page that will
 * never become ready (wrong URL, app without the dev runtime) still fails
 * with a named `attach_timeout` instead of hanging the tool call.
 *
 * It used to be written `{ timeout: 10_000 }` in `waitForFunction`'s SECOND
 * argument slot — the page function's argument, not its options — so the
 * wait silently ran on Playwright's default instead, and the error claimed
 * "within 10s".
 */
export const DEFAULT_ATTACH_TIMEOUT_MS = 30_000

/**
 * Launches the fallback browser. The default is Playwright's own
 * `chromium.launch`: this is the DEVELOPER's debugging browser, pointed at
 * their own app, which may legitimately load fonts, APIs and CDN assets —
 * the repository's hermetic test network policy
 * (`scripts/lib/network-policy.mjs`) must not govern it. Tests inject the
 * hermetic launcher here so the browsers THEY cause to exist stay behind the
 * guard.
 */
export type CdpBrowserLauncher = (options: {
  headless: boolean
}) => Promise<import('playwright').Browser>

function pushBounded<T>(arr: T[], item: T, max: number): void {
  arr.push(item)
  if (arr.length > max) arr.shift()
}

export class CdpSessionManager implements CdpTransport {
  private session: CdpSession | null = null
  /**
   * Memoized in-flight `ensureSession()` promise. Without this, two tool
   * calls that both find `this.session === null` each launch their own
   * headless Chromium — the second overwrites `this.session`, orphaning
   * the first browser process (leak). Concurrent callers now await the
   * same launch.
   */
  private inflight: Promise<CdpSession> | null = null
  private devUrl: string | null
  private headed: boolean
  private readonly attachTimeoutMs: number
  private readonly launchBrowser: CdpBrowserLauncher | undefined

  constructor(
    opts: {
      devUrl?: string | null
      headed?: boolean
      /** Attach deadline for the Playwright fallback; see `DEFAULT_ATTACH_TIMEOUT_MS`. */
      attachTimeoutMs?: number
      /** Launches the fallback browser; see `CdpBrowserLauncher`. */
      launchBrowser?: CdpBrowserLauncher
    } = {},
  ) {
    this.devUrl = opts.devUrl ?? null
    this.headed = opts.headed ?? false
    this.attachTimeoutMs = opts.attachTimeoutMs ?? DEFAULT_ATTACH_TIMEOUT_MS
    this.launchBrowser = opts.launchBrowser
  }

  /**
   * Tear down the current session (if any) and close its browser handle so
   * a discarded playwright-owned Chromium process does not leak. Nulls the
   * session/in-flight state synchronously so `isAvailable()` reflects the
   * reset immediately, then closes the captured browser in the background.
   * For a connectOverCDP (user-chrome) session `close()` only drops the CDP
   * connection — it never kills the user's browser.
   */
  private disposeSession(): void {
    const stale = this.session
    this.session = null
    this.inflight = null
    if (stale?.browser) void stale.browser.close().catch(() => {})
  }

  setDevUrl(url: string): void {
    this.devUrl = url
    this.disposeSession()
  }

  setHeaded(v: boolean): void {
    this.headed = v
    this.disposeSession()
  }

  isAvailable(): boolean {
    return this.session !== null
  }

  async call(domain: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const s = await this.ensureSession()
    const cdpSession = await s.page.context().newCDPSession(s.page)
    try {
      return await cdpSession.send(
        `${domain}.${method}` as Parameters<typeof cdpSession.send>[0],
        params,
      )
    } finally {
      await cdpSession.detach().catch(() => {})
    }
  }

  async screenshot(opts: {
    selector?: string
    fullPage?: boolean
    format?: 'png' | 'jpeg'
  }): Promise<{ data: string; format: string; mimeType: string }> {
    const s = await this.ensureSession()
    const fmt = opts.format ?? 'png'
    let buf: Buffer
    if (opts.selector) {
      const el = s.page.locator(opts.selector)
      buf = await el.screenshot({ type: fmt })
    } else {
      buf = await s.page.screenshot({ type: fmt, fullPage: opts.fullPage ?? false })
    }
    return { data: buf.toString('base64'), format: fmt, mimeType: `image/${fmt}` }
  }

  async accessibilitySnapshot(opts: {
    selector?: string
    interestingOnly?: boolean
  }): Promise<unknown> {
    const s = await this.ensureSession()
    if (opts.selector) {
      return s.page.locator(opts.selector).ariaSnapshot()
    }
    return s.page.ariaSnapshot()
  }

  /**
   * Evaluate an expression inside the attached page. Wraps Playwright's
   * `page.evaluate(string)` — expression is evaluated in the page's
   * own JS context, so referencing globals like `window.__lluiComponents`
   * works directly. Used by `llui_capture`'s Playwright fallback to
   * gather runtime telemetry from a headless browser.
   */
  async evaluatePage<T = unknown>(expression: string): Promise<T> {
    const s = await this.ensureSession()
    return (await s.page.evaluate(expression)) as T
  }

  getConsoleBuffer(limit?: number, level?: string): ConsoleEntry[] {
    if (!this.session) return []
    let items = this.session.consoleBuffer
    if (level) items = items.filter((e) => e.level === level)
    return limit != null ? items.slice(-limit) : items
  }

  getNetworkBuffer(
    limit?: number,
    filter?: { urlPattern?: string; status?: number },
  ): NetworkEntry[] {
    if (!this.session) return []
    let items = this.session.networkBuffer
    if (filter?.urlPattern) {
      // urlPattern is caller-supplied (an MCP tool arg). A malformed pattern
      // (e.g. `[`) makes `new RegExp` throw synchronously; guard it so a bad
      // filter surfaces as a clean error instead of crashing the tool call.
      let re: RegExp
      try {
        re = new RegExp(filter.urlPattern)
      } catch (err) {
        throw new Error(
          `Invalid urlPattern regex ${JSON.stringify(filter.urlPattern)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        )
      }
      items = items.filter((e) => re.test(e.url))
    }
    if (filter?.status != null) {
      items = items.filter((e) => e.status === filter.status)
    }
    return limit != null ? items.slice(-limit) : items
  }

  getErrorBuffer(limit?: number): ErrorEntry[] {
    if (!this.session) return []
    const items = this.session.errorBuffer
    return limit != null ? items.slice(-limit) : items
  }

  async closeBrowser(): Promise<{ closed: boolean; reason?: string }> {
    if (!this.session) return { closed: false, reason: 'no_session' }
    if (this.session.mode === 'user-chrome') {
      return { closed: false, reason: 'user_owns_browser' }
    }
    await this.session.browser!.close().catch(() => {})
    this.session = null
    this.inflight = null
    return { closed: true }
  }

  private resolveDevUrl(): URL | null {
    if (!this.devUrl) return null
    try {
      return new URL(this.devUrl)
    } catch {
      return null
    }
  }

  private async attachListeners(
    page: import('playwright').Page,
    session: CdpSession,
  ): Promise<void> {
    page.on('console', (msg) => {
      pushBounded(
        session.consoleBuffer,
        {
          level: msg.type() as ConsoleEntry['level'],
          text: msg.text(),
          timestamp: Date.now(),
        },
        500,
      )
    })
    page.on('pageerror', (err) => {
      pushBounded(
        session.errorBuffer,
        {
          text: err.message,
          stack: err.stack ?? '',
          timestamp: Date.now(),
        },
        200,
      )
    })
    page.on('request', (req) => {
      const entry: NetworkEntry = {
        requestId: req.url() + Date.now(),
        url: req.url(),
        method: req.method(),
        status: null,
        startTime: Date.now(),
        endTime: null,
        durationMs: null,
        failed: false,
      }
      pushBounded(session.networkBuffer, entry, 500)
    })
    page.on('response', (res) => {
      const buf = session.networkBuffer
      let last: NetworkEntry | undefined
      for (let i = buf.length - 1; i >= 0; i--) {
        const e = buf[i]
        if (e !== undefined && e.url === res.url() && e.status === null) {
          last = e
          break
        }
      }
      if (last) {
        last.status = res.status()
        last.endTime = Date.now()
        last.durationMs = last.endTime - last.startTime
      }
    })
    page.on('requestfailed', (req) => {
      const buf = session.networkBuffer
      let last: NetworkEntry | undefined
      for (let i = buf.length - 1; i >= 0; i--) {
        const e = buf[i]
        if (e !== undefined && e.url === req.url() && e.status === null) {
          last = e
          break
        }
      }
      if (last) {
        last.failed = true
        last.failureReason = req.failure()?.errorText
        last.endTime = Date.now()
        last.durationMs = last.endTime - last.startTime
      }
    })
  }

  private async buildSession(
    page: import('playwright').Page,
    browser: import('playwright').Browser | null,
    mode: CdpSession['mode'],
  ): Promise<CdpSession> {
    const s: CdpSession = {
      mode,
      browser,
      page,
      consoleBuffer: [],
      networkBuffer: [],
      errorBuffer: [],
    }
    await this.attachListeners(page, s)
    return s
  }

  async ensureSession(): Promise<CdpSession> {
    if (this.session) return this.session
    // Coalesce concurrent launches onto a single promise so we never spawn
    // (and then orphan) two browsers. Cleared on settle so a later call
    // after a failure/teardown can retry.
    if (this.inflight) return this.inflight
    const p = this.buildOrAttachSession()
    this.inflight = p
    try {
      const s = await p
      return s
    } finally {
      if (this.inflight === p) this.inflight = null
    }
  }

  private async buildOrAttachSession(): Promise<CdpSession> {
    const url = this.resolveDevUrl()
    if (!url)
      throw new CdpError(
        'dev_url_unknown',
        'No dev URL. Pass --url <devUrl> or set via Vite plugin.',
      )

    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 200)
      const resp = await fetch('http://127.0.0.1:9222/json/version', {
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t))
      if (resp.ok) {
        const listResp = await fetch('http://127.0.0.1:9222/json/list')
        const targets = (await listResp.json()) as Array<{
          url?: string
          webSocketDebuggerUrl?: string
        }>
        const target = targets.find((t) => t.url?.includes(url.host))
        if (target) {
          const pw = await import('playwright')
          const browser = await pw.chromium.connectOverCDP('http://127.0.0.1:9222')
          const pages = browser.contexts().flatMap((c) => c.pages())
          const page = pages.find((p) => p.url().includes(url.host)) ?? pages[0]
          if (page) {
            this.session = await this.buildSession(page, browser, 'user-chrome')
            return this.session
          }
          await browser.close()
        }
      }
    } catch {
      // fall through to Playwright fallback
    }

    let pw: typeof import('playwright')
    try {
      pw = await import('playwright')
    } catch {
      throw new CdpError(
        'cdp_unavailable',
        'Playwright not installed. Run: npm install playwright && npx playwright install chromium',
      )
    }

    const launch: CdpBrowserLauncher =
      this.launchBrowser ?? ((options) => pw.chromium.launch(options))
    const browser = await launch({ headless: !this.headed })
    // Every failure from here on must close the browser it launched: a goto
    // that throws used to escape before the try and orphan the process.
    try {
      const deadline = Date.now() + this.attachTimeoutMs
      const remaining = (): number => Math.max(1, deadline - Date.now())
      const page = await browser.newPage()
      try {
        await page.goto(url.href, { timeout: remaining() })
        await page.waitForFunction(
          () => typeof (globalThis as Record<string, unknown>).__lluiDebug !== 'undefined',
          undefined,
          { timeout: remaining() },
        )
      } catch (err) {
        if (err instanceof pw.errors.TimeoutError) {
          throw new CdpError(
            'attach_timeout',
            `App at ${url.href} did not expose __lluiDebug within ${this.attachTimeoutMs} ms`,
          )
        }
        throw err
      }
      this.session = await this.buildSession(page, browser, 'playwright-owned')
      return this.session
    } catch (err) {
      await browser.close().catch(() => {})
      throw err
    }
  }
}
