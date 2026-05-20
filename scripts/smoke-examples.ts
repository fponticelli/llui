/**
 * Smoke test: load every built example in headless Chromium, fail
 * on any console.error or pageerror.
 *
 * Catches the issue-#5-class of bug: code that compiles cleanly +
 * builds without warnings + crashes on first paint in production.
 *
 * Run after `pnpm turbo build`. Handles two layouts:
 *   - SPA (vite default): `dist/index.html`
 *   - Vike pre-rendered: `dist/client/index.html` — same harness,
 *     served from the prerender output. Catches SSR-shape bugs that
 *     only show up after Vike has emitted the static HTML+hydration
 *     bundle. The Vike server runtime itself isn't exercised here;
 *     prerender output is enough to hit `__view`/`__prefixes`
 *     regressions on the client side.
 *
 * Usage: npx tsx scripts/smoke-examples.ts
 */
import { chromium, type ConsoleMessage } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

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
  distDir: string
}

function findExamples(): Example[] {
  const out: Example[] = []
  for (const entry of readdirSync(EXAMPLES_DIR)) {
    const dir = resolve(EXAMPLES_DIR, entry)
    if (!statSync(dir).isDirectory()) continue

    // Vike-style: `pages/` source layout, prerender output at
    // `dist/client/index.html`. Check this first because Vike examples
    // may *also* have a project-root index.html for the dev shell.
    const vikeDist = resolve(dir, 'dist', 'client')
    if (existsSync(resolve(dir, 'pages')) && existsSync(resolve(vikeDist, 'index.html'))) {
      out.push({ name: entry, distDir: vikeDist })
      continue
    }

    // SPA: project-root index.html + dist/index.html after build.
    if (!existsSync(resolve(dir, 'index.html'))) continue
    const spaDist = resolve(dir, 'dist')
    if (!existsSync(resolve(spaDist, 'index.html'))) {
      console.warn(`[skip] ${entry}: no dist/index.html — was \`vite build\` run?`)
      continue
    }
    out.push({ name: entry, distDir: spaDist })
  }
  return out
}

function serve(dir: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let path = req.url?.split('?')[0] ?? '/'
      if (path === '/') path = '/index.html'
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

async function smokeOne(ex: Example): Promise<{ name: string; errors: string[] }> {
  const { port, close } = await serve(ex.distDir)
  const errors: string[] = []
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('console', (msg: ConsoleMessage) => {
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
    // "Failed to load resource" console errors don't include it.
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? 'unknown'
      // Strip transient flakes that are out of the example's control:
      // a CDN being unreachable from a sandbox shouldn't fail a smoke
      // test about LLui runtime correctness.
      if (failure === 'net::ERR_NAME_NOT_RESOLVED' && !req.url().startsWith('http://127.0.0.1')) {
        return
      }
      errors.push(`requestfailed: ${req.url()} (${failure})`)
    })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 15_000 })
    // Give the app a tick to bootstrap.
    await page.waitForTimeout(250)
  } finally {
    await browser.close()
    await close()
  }
  return { name: ex.name, errors }
}

async function main() {
  const examples = findExamples()
  if (examples.length === 0) {
    console.error('No built examples found — run `pnpm turbo build` first.')
    process.exit(1)
  }
  console.log(`Smoking ${examples.length} example(s)…`)
  const results = []
  for (const ex of examples) {
    process.stdout.write(`  ${ex.name}… `)
    const r = await smokeOne(ex)
    process.stdout.write(r.errors.length === 0 ? 'ok\n' : `FAIL (${r.errors.length})\n`)
    results.push(r)
  }
  const failed = results.filter((r) => r.errors.length > 0)
  if (failed.length > 0) {
    console.error('\nFailures:')
    for (const r of failed) {
      console.error(`\n[${r.name}]`)
      for (const e of r.errors) console.error(`  ${e}`)
    }
    process.exit(1)
  }
  console.log(`\nAll ${results.length} examples booted clean.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
