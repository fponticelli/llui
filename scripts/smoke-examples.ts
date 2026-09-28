/**
 * Smoke test: catch the class of bug where code compiles + builds + ships
 * with no warnings, but crashes on first paint or fails to resolve at
 * load time in production.
 *
 * **Browser-boot check** (Playwright). Loads every example with a
 * browser-bootable dist into headless Chromium, fails on console.error /
 * pageerror / requestfailed. Catches runtime crashes from missing
 * `__view` factories, undefined `__prefixes`, etc. — the issue-#5 class.
 *
 * **Hermetic.** Nothing leaves the machine: every request is routed through
 * `scripts/lib/network-policy.mjs` (the same policy and fixture the browser
 * test suites use, via `scripts/lib/hermetic-browser.mjs`), which passes the example's own origin,
 * answers declared third-party dependencies (Iconify) from a checked-in
 * fixture, fails the intentionally-unresolvable `example.invalid` the way a
 * resolver would, and FAILS the smoke on any other off-origin request. The
 * behaviours those two dependencies exist to exercise are then asserted by
 * per-example probes below, so routing them locally cannot quietly stop
 * exercising them.
 *
 * Run after `pnpm turbo build`. Dist layouts handled:
 *   - SPA (vite default): `dist/index.html` → browser-boot
 *   - Vike pre-rendered:  `dist/client/index.html` → browser-boot
 *
 * Usage: npx tsx scripts/smoke-examples.ts
 */
import { chromium, type ConsoleMessage, type Page, type Request } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  misfiledAfterFirstPaintEntries,
  requestedIconifyEntries,
  routeContext,
  sameOrigin,
  staleIconifyEntries,
} from './lib/network-policy.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLES_DIR = resolve(ROOT, 'examples')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

interface Example {
  name: string
  /** Directory to serve in the browser-boot check. */
  bootDistDir: string
  /**
   * Pages to boot: `/`, plus every first-level `dist/<dir>/index.html` — a
   * multi-document build (the Component Gallery's two path documents) is
   * booted document by document.
   */
  pages: string[]
}

function pagesOf(distDir: string): string[] {
  const nested = readdirSync(distDir)
    .filter((name) => existsSync(resolve(distDir, name, 'index.html')))
    .sort()
    .map((name) => `/${name}/`)
  return ['/', ...nested]
}

function findExamples(): { examples: Example[]; skipped: string[] } {
  const out: Example[] = []
  const skipped: string[] = []
  for (const entry of readdirSync(EXAMPLES_DIR)) {
    const dir = resolve(EXAMPLES_DIR, entry)
    if (!statSync(dir).isDirectory()) continue

    // Vike-style: `pages/` source layout.
    if (existsSync(resolve(dir, 'pages'))) {
      const vikeClientIndex = resolve(dir, 'dist', 'client', 'index.html')
      if (existsSync(vikeClientIndex)) {
        const client = resolve(dir, 'dist', 'client')
        out.push({ name: entry, bootDistDir: client, pages: ['/'] })
      } else {
        console.warn(`[skip] ${entry}: no dist/client/index.html — was \`vite build\` run?`)
        skipped.push(entry)
      }
      continue
    }

    // SPA: project-root index.html + dist/index.html after build. A
    // multi-build example keeps its HTML entries under `src/` (each build has
    // its own Vite root), so it is recognised by its built output instead.
    if (
      !existsSync(resolve(dir, 'index.html')) &&
      !existsSync(resolve(dir, 'dist', 'index.html'))
    ) {
      continue
    }
    const spaDist = resolve(dir, 'dist')
    if (!existsSync(resolve(spaDist, 'index.html'))) {
      console.warn(`[skip] ${entry}: no dist/index.html — was \`vite build\` run?`)
      skipped.push(entry)
      continue
    }
    out.push({ name: entry, bootDistDir: spaDist, pages: pagesOf(spaDist) })
  }
  return { examples: out, skipped }
}

function serve(dir: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let path = req.url?.split('?')[0] ?? '/'
      if (path.endsWith('/')) path = `${path}index.html`
      const file = resolve(dir, '.' + path)
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404)
        res.end()
        return
      }
      const ext = extname(file)
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('failed to bind')
      ok({
        port: addr.port,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

/** What one example did on the network and in the console, across its pages. */
interface Observed {
  /** `prefix:name` Iconify entries this example requested. */
  readonly iconify: Set<string>
  readonly warnings: string[]
}

/**
 * Behaviour the hermetic network must keep OBSERVABLE. The two declared
 * dependencies exist to exercise a load path and a failure path; answering
 * them locally would silently stop exercising those paths if nothing checked,
 * so each is asserted here — condition-based, after the pages settle. A probe
 * returns its failures (none when it holds).
 */
type Probe = (page: Page, observed: Observed) => Promise<string[]>

const PROBE_TIMEOUT_MS = 15_000

/** `null` once `predicate` holds in the page, `failure` if it never does. */
async function holds(
  page: Page,
  predicate: () => boolean,
  failure: string,
): Promise<string | null> {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: PROBE_TIMEOUT_MS })
    return null
  } catch {
    return failure
  }
}

const PROBES: Readonly<Record<string, Probe>> = {
  // The avatar is pointed at `example.invalid` so its image ERRORS: the
  // machine must reach `error` and the fallback must be the visible half.
  'components-demo': async (page) => {
    const failure = await holds(
      page,
      () => {
        const img = document.querySelector('img[src="https://example.invalid/not-an-avatar.png"]')
        const fallback = img?.parentElement?.querySelector('[data-part="fallback"]')
        return (
          img?.getAttribute('data-status') === 'error' &&
          fallback instanceof HTMLElement &&
          !fallback.hidden
        )
      },
      'avatar probe: the example.invalid image never reached data-status="error" with its fallback shown',
    )
    return failure === null ? [] : [failure]
  },
  // Every glyph the fixture has must PAINT (loader, batcher, sanitizer and
  // paint all ran), the deliberately missing one must stay an empty box, and
  // it must say so in the console. That a failure is NOT cached is a
  // remount property, pinned by `packages/components/test/icon.test.ts`.
  'registry-demo': async (page, observed) => {
    const out: string[] = []
    const painted = await holds(
      page,
      () => {
        const hosts = [...document.querySelectorAll('svg[data-glyph]')]
        return (
          hosts.length > 0 &&
          hosts.every(
            (host) =>
              host.getAttribute('data-glyph') === 'lucide:not-a-real-icon' ||
              host.childElementCount > 0,
          )
        )
      },
      'icon probe: not every svg[data-glyph] painted its fixture glyph',
    )
    if (painted !== null) out.push(painted)
    const missing = await page.evaluate(() => {
      const hosts = [...document.querySelectorAll('svg[data-glyph="lucide:not-a-real-icon"]')]
      return { count: hosts.length, empty: hosts.every((host) => host.childElementCount === 0) }
    })
    if (missing.count === 0) out.push('icon probe: the lucide:not-a-real-icon box is not rendered')
    else if (!missing.empty) out.push('icon probe: lucide:not-a-real-icon painted a glyph')
    if (!observed.warnings.some((w) => w.includes('"lucide:not-a-real-icon" was not found'))) {
      out.push('icon probe: no console warning for the missing lucide:not-a-real-icon glyph')
    }
    return out
  },
}

interface SmokeResult {
  readonly name: string
  readonly errors: string[]
  readonly iconify: ReadonlySet<string>
}

async function smokeOne(ex: Example): Promise<SmokeResult> {
  const errors: string[] = []
  const observed: Observed = { iconify: new Set(), warnings: [] }
  // Requests the router aborted on purpose. Their `requestfailed` is either
  // expected (a declared failure) or already reported with a better message
  // (an unexpected request), so the generic handler skips both.
  const aborted = new WeakSet<Request>()

  const { port, close } = await serve(ex.bootDistDir)
  const origin = `http://127.0.0.1:${port}`
  const browser = await chromium.launch()
  try {
    // A service worker's fetches would bypass `route`; blocking them keeps
    // every request on the policy's path.
    const ctx = await browser.newContext({ serviceWorkers: 'block' })
    await routeContext(ctx, {
      isLocal: sameOrigin(origin),
      onRequest: (url) => {
        for (const entry of requestedIconifyEntries(url)) observed.iconify.add(entry)
      },
      onAborted: (request) => aborted.add(request),
      onUnexpected: (message) => errors.push(`network: ${message}`),
    })
    const page = await ctx.newPage()
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'warning') {
        observed.warnings.push(msg.text())
        return
      }
      if (msg.type() !== 'error') return
      const text = msg.text()
      // "Failed to load resource: ..." mirrors `requestfailed`, but
      // without the offending URL. The dedicated handler below reports
      // those with the URL attached, so drop the duplicate here.
      if (text.startsWith('Failed to load resource:')) return
      errors.push(`console.error: ${text}`)
    })
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`)
    })
    // Surface failed network requests with the failing URL — generic
    // "Failed to load resource" console errors don't include it. Nothing
    // off-origin reaches a real network, so there is no transient left to
    // forgive: what arrives here is the example's own server or assets.
    page.on('requestfailed', (req) => {
      if (aborted.has(req)) return
      errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`)
    })
    for (const pagePath of ex.pages) {
      await page.goto(`${origin}${pagePath}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      })
      // Give the app a tick to bootstrap.
      await page.waitForTimeout(250)
    }
    const probe = PROBES[ex.name]
    if (probe !== undefined) errors.push(...(await probe(page, observed)))
  } finally {
    await browser.close()
    await close()
  }
  return { name: ex.name, errors, iconify: observed.iconify }
}

async function main() {
  const { examples, skipped } = findExamples()
  if (examples.length === 0) {
    console.error('No built examples found — run `pnpm turbo build` first.')
    process.exit(1)
  }
  console.log(`Smoking ${examples.length} example(s)…`)
  const results: SmokeResult[] = []
  const requested = new Set<string>()
  for (const ex of examples) {
    process.stdout.write(`  ${ex.name}… `)
    const r = await smokeOne(ex)
    process.stdout.write(r.errors.length === 0 ? 'ok\n' : `FAIL (${r.errors.length})\n`)
    for (const entry of r.iconify) requested.add(entry)
    results.push(r)
  }
  // Checks over the whole run. A fixture entry no example requested is stale,
  // and a probe whose example is gone is coverage silently lost — both are
  // only decidable when every example was built and booted.
  const global: string[] = []
  if (skipped.length === 0) {
    for (const entry of staleIconifyEntries(requested)) {
      global.push(
        `stale Iconify fixture entry "${entry}": no example requested it (scripts/lib/iconify-fixture.mjs)`,
      )
    }
    for (const entry of misfiledAfterFirstPaintEntries(requested)) {
      global.push(
        `Iconify fixture entry "${entry}" is listed in AFTER_FIRST_PAINT but a first paint requested it — move it out (scripts/lib/iconify-fixture.mjs)`,
      )
    }
    for (const name of Object.keys(PROBES)) {
      if (!examples.some((ex) => ex.name === name))
        global.push(`probe "${name}" matched no example`)
    }
  } else {
    console.warn(`[skip] fixture staleness and probe coverage: ${skipped.join(', ')} not built`)
  }
  const failed = results.filter((r) => r.errors.length > 0)
  if (failed.length > 0 || global.length > 0) {
    console.error('\nFailures:')
    for (const r of failed) {
      console.error(`\n[${r.name}]`)
      for (const e of r.errors) console.error(`  ${e}`)
    }
    if (global.length > 0) {
      console.error('\n[run]')
      for (const e of global) console.error(`  ${e}`)
    }
    process.exit(1)
  }
  console.log(`\nAll ${results.length} examples booted clean.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
