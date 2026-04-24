import type { CdpTransport, ConsoleEntry, NetworkEntry, ErrorEntry } from '../tool-registry.js'

class CdpError extends Error {
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

function pushBounded<T>(arr: T[], item: T, max: number): void {
  arr.push(item)
  if (arr.length > max) arr.shift()
}

export class CdpSessionManager implements CdpTransport {
  private session: CdpSession | null = null
  private devUrl: string | null
  private headed: boolean

  constructor(opts: { devUrl?: string | null; headed?: boolean } = {}) {
    this.devUrl = opts.devUrl ?? null
    this.headed = opts.headed ?? false
  }

  setDevUrl(url: string): void {
    this.devUrl = url
    this.session = null
  }

  setHeaded(v: boolean): void {
    this.headed = v
    this.session = null
  }

  isAvailable(): boolean {
    return this.session !== null
  }

  async call(
    domain: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
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
      const re = new RegExp(filter.urlPattern)
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

    const browser = await pw.chromium.launch({ headless: !this.headed })
    const page = await browser.newPage()
    await page.goto(url.href)
    try {
      await page.waitForFunction(
        () => typeof (globalThis as Record<string, unknown>).__lluiDebug !== 'undefined',
        { timeout: 10_000 },
      )
    } catch {
      await browser.close()
      throw new CdpError('attach_timeout', `App not ready at ${url.href} within 10s`)
    }

    this.session = await this.buildSession(page, browser, 'playwright-owned')
    return this.session
  }
}
