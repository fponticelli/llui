/**
 * Smoke test: catch the class of bug where code compiles + builds + ships
 * with no warnings, but crashes on first paint or fails to resolve at
 * load time in production. Two complementary checks:
 *
 *   1. **Browser-boot check** (Playwright). Loads every example with a
 *      browser-bootable dist into headless Chromium, fails on
 *      console.error / pageerror / requestfailed. Catches runtime crashes
 *      from missing `__view` factories, undefined `__prefixes`, etc. —
 *      the issue-#5 class.
 *
 *   2. **Static-import check** (no browser). Walks every example's
 *      `dist/server/**\/*.{js,mjs}` and asserts that every imported name
 *      from `@llui/dom` or `@llui/dom/internal` is a real export of the
 *      respective subpath. Catches the issue-#5-follow-up class:
 *      compiler-emitted helpers leaking into module-external import
 *      specifiers that the vite-plugin's rename pass then rewrites to
 *      symbols the dom package never exported. The original bug needed
 *      a `MISSING_EXPORT` rolldown error to surface — this check makes
 *      the same condition fail explicitly + deterministically.
 *
 * Run after `pnpm turbo build`. Dist layouts handled:
 *   - SPA (vite default): `dist/index.html` → browser-boot
 *   - Vike pre-rendered:  `dist/client/index.html` → browser-boot
 *   - Vike SSR (no prerender): `dist/server/entries/**` only →
 *     static-import check only (no client HTML to load)
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
  /** Directory to serve in the browser-boot check. Null when not browser-bootable (e.g., SSR-only fixture). */
  bootDistDir: string | null
  /** Directory to walk for the static-import check. Null when there's no `dist/server`. */
  serverDistDir: string | null
}

function findExamples(): Example[] {
  const out: Example[] = []
  for (const entry of readdirSync(EXAMPLES_DIR)) {
    const dir = resolve(EXAMPLES_DIR, entry)
    if (!statSync(dir).isDirectory()) continue

    const serverDist = resolve(dir, 'dist', 'server')
    const serverDistDir = existsSync(serverDist) ? serverDist : null

    // Vike-style: `pages/` source layout.
    if (existsSync(resolve(dir, 'pages'))) {
      const vikeClientIndex = resolve(dir, 'dist', 'client', 'index.html')
      const bootDistDir = existsSync(vikeClientIndex) ? resolve(dir, 'dist', 'client') : null
      if (bootDistDir || serverDistDir) {
        out.push({ name: entry, bootDistDir, serverDistDir })
      } else {
        console.warn(`[skip] ${entry}: no dist/client or dist/server — was \`vite build\` run?`)
      }
      continue
    }

    // SPA: project-root index.html + dist/index.html after build.
    if (!existsSync(resolve(dir, 'index.html'))) continue
    const spaDist = resolve(dir, 'dist')
    if (!existsSync(resolve(spaDist, 'index.html'))) {
      console.warn(`[skip] ${entry}: no dist/index.html — was \`vite build\` run?`)
      continue
    }
    out.push({ name: entry, bootDistDir: spaDist, serverDistDir })
  }
  return out
}

/**
 * Walk `serverDist` recursively, collect every `import { … } from
 * '@llui/dom'` and `import { … } from '@llui/dom/internal'` line, and
 * assert every imported name is a real export of the referenced
 * subpath. Catches the rename-into-import-specifier bug deterministically
 * — no need to wait for rolldown's later `MISSING_EXPORT` pass.
 */
async function checkServerImports(serverDist: string): Promise<string[]> {
  const errors: string[] = []
  // Load the dom dists directly — the script runs at the repo root,
  // which isn't a consumer of `@llui/dom`, so a bare `import('@llui/dom')`
  // fails resolution. Reaching into the workspace's built `dist/` is the
  // unambiguous source of truth for "what does the package actually export."
  const domModule = (await import(resolve(ROOT, 'packages/dom/dist/index.js'))) as Record<
    string,
    unknown
  >
  const internalModule = (await import(resolve(ROOT, 'packages/dom/dist/internal.js'))) as Record<
    string,
    unknown
  >
  const allowed: Record<string, ReadonlySet<string>> = {
    '@llui/dom': new Set(Object.keys(domModule)),
    '@llui/dom/internal': new Set(Object.keys(internalModule)),
  }
  const re = /import\s*\{([^}]*)\}\s*from\s*['"](@llui\/dom(?:\/internal)?)['"]/g

  function walk(p: string): void {
    const stat = statSync(p)
    if (stat.isDirectory()) {
      for (const name of readdirSync(p)) walk(resolve(p, name))
      return
    }
    if (!/\.(?:m?js|cjs)$/.test(p)) return
    const text = readFileSync(p, 'utf8')
    for (const m of text.matchAll(re)) {
      const subpath = m[2] as keyof typeof allowed
      const realExports = allowed[subpath]
      if (!realExports) continue
      for (const raw of m[1]!.split(',')) {
        // Handle `name as alias` and surrounding whitespace.
        const name = raw
          .trim()
          .split(/\s+as\s+/)[0]!
          .trim()
        if (!name) continue
        if (!realExports.has(name)) {
          errors.push(
            `${p.replace(EXAMPLES_DIR, 'examples')}: import { ${name} } from "${subpath}" — not a real export`,
          )
        }
      }
    }
  }
  walk(serverDist)
  return errors
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
  const errors: string[] = []

  if (ex.serverDistDir) {
    errors.push(...(await checkServerImports(ex.serverDistDir)))
  }

  if (!ex.bootDistDir) return { name: ex.name, errors }

  const { port, close } = await serve(ex.bootDistDir)
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
