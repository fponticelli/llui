// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import type { Browser } from 'playwright'
import { CdpError, CdpSessionManager, type CdpBrowserLauncher } from '../src/transports/cdp'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

/**
 * The CDP tools' Playwright fallback ATTACH: navigate to the dev URL, wait for
 * the app to expose `__lluiDebug`, give up with a named `attach_timeout` at a
 * deadline (`DEFAULT_ATTACH_TIMEOUT_MS`, measured — see its comment).
 *
 * The deadline used to be passed in `waitForFunction`'s ARGUMENT slot, so it
 * was silently ignored and Playwright's default applied instead; and a `goto`
 * that threw escaped before the `try`, orphaning the launched browser.
 */

async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    const pw = await import('playwright')
    const execPath = pw.chromium.executablePath()
    return execPath && existsSync(execPath) ? pw : null
  } catch {
    return null
  }
}

const playwright = await loadPlaywright()
const hermetic = useHermeticBrowser()

interface FakeCall {
  readonly method: string
  readonly args: readonly unknown[]
}

/** A launcher whose browser records calls; `waitForFunction` behaves as told. */
function fakeLauncher(
  pw: typeof import('playwright'),
  behaviour: { goto?: () => Promise<void>; waitForFunction?: () => Promise<void> },
): { launch: CdpBrowserLauncher; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const record =
    (method: string, then: () => Promise<unknown> = async () => undefined) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return then()
    }
  const page = {
    goto: record('goto', behaviour.goto),
    waitForFunction: record(
      'waitForFunction',
      behaviour.waitForFunction ??
        (() => Promise.reject(new pw.errors.TimeoutError('Timeout exceeded (fake)'))),
    ),
    on: () => undefined,
  }
  const browser = {
    newPage: record('newPage', async () => page),
    close: record('close'),
  }
  return { launch: async () => browser as unknown as Browser, calls }
}

describe.skipIf(!playwright)('CDP fallback attach — deadline and cleanup (fake browser)', () => {
  it('passes the deadline as waitForFunction OPTIONS and fails with a named attach_timeout', async () => {
    const { launch, calls } = fakeLauncher(playwright!, {})
    const mgr = new CdpSessionManager({
      devUrl: 'http://127.0.0.1:1/',
      attachTimeoutMs: 1234,
      launchBrowser: launch,
    })
    const error = await mgr.ensureSession().then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(CdpError)
    expect((error as CdpError).code).toBe('attach_timeout')
    expect((error as CdpError).message).toContain('within 1234 ms')

    const wait = calls.find((call) => call.method === 'waitForFunction')!
    expect(wait.args).toHaveLength(3)
    expect(typeof wait.args[0]).toBe('function')
    // The page function takes no argument; the options are the THIRD slot.
    expect(wait.args[1]).toBeUndefined()
    const timeout = (wait.args[2] as { timeout?: number }).timeout
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(1234)
    // One deadline covers navigation too.
    const goto = calls.find((call) => call.method === 'goto')!
    expect((goto.args[1] as { timeout?: number }).timeout).toBeLessThanOrEqual(1234)
    // And the browser it launched is closed, not orphaned.
    expect(calls.filter((call) => call.method === 'close')).toHaveLength(1)
    expect(mgr.isAvailable()).toBe(false)
  })

  it('closes the launched browser when navigation itself fails', async () => {
    const refused = new Error('net::ERR_CONNECTION_REFUSED (fake)')
    const { launch, calls } = fakeLauncher(playwright!, { goto: () => Promise.reject(refused) })
    const mgr = new CdpSessionManager({ devUrl: 'http://127.0.0.1:1/', launchBrowser: launch })
    await expect(mgr.ensureSession()).rejects.toBe(refused)
    expect(calls.filter((call) => call.method === 'close')).toHaveLength(1)
  })
})

describe.skipIf(!playwright)('CDP fallback attach — real Chromium', () => {
  let server: Server | null = null

  afterEach(async () => {
    const s = server
    server = null
    if (s) {
      s.closeAllConnections()
      await new Promise<void>((resolve) => s.close(() => resolve()))
    }
  })

  /** Serve one HTML page on a loopback port; returns its URL. */
  async function serve(html: string): Promise<string> {
    const s = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    server = s
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`
  }

  it('a page that never exposes __lluiDebug fails AT the deadline with attach_timeout', async () => {
    const url = await serve('<!doctype html><title>no llui</title><p>plain page</p>')
    const launched: Browser[] = []
    const mgr = new CdpSessionManager({
      devUrl: url,
      attachTimeoutMs: 1500,
      launchBrowser: async (options) => {
        const browser = await hermetic.launch(options)
        launched.push(browser)
        return browser
      },
    })
    const startedAt = Date.now()
    const error = await mgr.ensureSession().then(
      () => null,
      (err: unknown) => err,
    )
    const elapsed = Date.now() - startedAt
    expect(error).toBeInstanceOf(CdpError)
    expect((error as CdpError).code).toBe('attach_timeout')
    expect((error as CdpError).message).toBe(
      `App at ${url} did not expose __lluiDebug within 1500 ms`,
    )
    // Not before the deadline (the wait is on the condition, not a guess)…
    expect(elapsed).toBeGreaterThanOrEqual(1500)
    // …and the browser it launched is gone.
    expect(launched).toHaveLength(1)
    expect(launched[0]!.isConnected()).toBe(false)
  })

  it('attaches as soon as the app becomes ready, however late within the deadline', async () => {
    // Ready 400 ms after load: a fixed short wait would miss it, the old
    // default-timeout wait happened to cover it, the condition wait does by
    // construction.
    const url = await serve(
      '<!doctype html><title>late llui</title><script>' +
        'setTimeout(() => { globalThis.__lluiDebug = {} }, 400)' +
        '</script>',
    )
    const mgr = new CdpSessionManager({
      devUrl: url,
      launchBrowser: (options) => hermetic.launch(options),
    })
    const session = await mgr.ensureSession()
    expect(session.mode).toBe('playwright-owned')
    expect(await session.page.evaluate(() => typeof globalThis.__lluiDebug)).toBe('object')
    expect(await mgr.closeBrowser()).toEqual({ closed: true })
  })
})
