// Build a browser-test fixture ONCE and serve the static output.
//
// The live-render browser suites used to boot a Vite DEV server per file and
// open a fresh page per test. That shape has three costs that all land on the
// tests, and all three grow with machine load — which is why these suites
// passed alone and timed out inside a parallel `turbo test`:
//
//  1. ON-DEMAND COMPILE. A dev server compiles a module the first time a page
//     asks for it, so the first test to navigate paid for compiling the whole
//     app (hundreds of modules through the LLui compiler and Tailwind) inside
//     its own 30 s budget. Measured at ambient load ~20 on 4 CPUs: 7.3-9.0 s
//     for a demo app's first page, 2.2-3.2 s for a menus-overlays fixture.
//  2. PER-PAGE MODULE FAN-OUT. Every later page is a new browser context, so
//     it re-requests every unbundled module: 218 requests / ~1.7 s per page
//     for `components-demo`, 259 / ~1.8 s for `registry-demo`, 107-134 /
//     0.4-0.7 s for a fixture page — per test, and per page within a test.
//  3. A SHARED DEPENDENCY-OPTIMIZER CACHE. Vite defaults `cacheDir` to the
//     root package's `node_modules/.vite`, so every suite that serves the same
//     example (or the same fixture root) from a concurrent vitest worker shares
//     ONE `deps/_metadata.json`. Suites whose config hashes differ overwrite
//     each other's optimized deps (observed flipping between two hash families
//     within 3 s of a concurrent run), and a dependency DISCOVERED mid-run
//     re-optimizes and force-reloads open pages — both of which strand a test
//     waiting on a page state that is never coming. The same race #268 found
//     in the Component Gallery's dev servers.
//
// A production-shaped build removes all three: the compile happens once, in
// the suite's `beforeAll` (a fixture cost, budgeted by the hook timeout); a
// page is one HTML document plus its bundled JS/CSS; and a build runs no
// dependency optimizer, with its own `cacheDir` in a private temp directory
// regardless. The root's own `vite.config.*` is loaded exactly as a dev server
// would load it (the LLui plugin, Tailwind), `mode` is `development` so
// `import.meta.env.DEV` code paths stay live, and minification is off so a
// failure's stack still names real functions.
//
// Only the transport changes. What a test asserts about the page — layout,
// computed style, pixels, behaviour — is the same build of the same source.

import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { build } from 'vite'

/** @type {Readonly<Record<string, string>>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * @typedef {object} PrebuildOptions
 * @property {string} root Absolute Vite root. Its `vite.config.*`, if any, is loaded.
 * @property {readonly string[]} inputs HTML entries, relative to `root`. Each is
 *   served at the same path it has under `root`.
 * @property {import('vite').AliasOptions} [alias] `resolve.alias` for the build.
 * @property {Record<string, string>} [define] Extra compile-time defines.
 */

/**
 * @typedef {object} PrebuiltFixture
 * @property {string} origin `http://127.0.0.1:<port>`, no trailing slash.
 * @property {string} dir The build output directory being served.
 * @property {(path: string) => string} url Absolute URL of a root-relative path.
 * @property {() => Promise<void>} close Stop serving and delete the build.
 */

/**
 * Resolve a request path inside `dir`, or `null` when it escapes it or names
 * nothing servable. A directory resolves to its `index.html`.
 *
 * @param {string} dir absolute build directory
 * @param {string} rawUrl request URL (path + optional query)
 * @returns {string | null}
 */
export function resolveServedFile(dir, rawUrl) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://fixture.invalid').pathname)
  } catch {
    return null
  }
  if (pathname.endsWith('/')) pathname = `${pathname}index.html`
  const file = resolve(dir, `.${pathname}`)
  if (file !== dir && !file.startsWith(`${dir}${sep}`)) return null
  try {
    const stats = statSync(file)
    if (stats.isDirectory()) return resolveServedFile(dir, `${pathname}/`)
    return stats.isFile() ? file : null
  } catch {
    return null
  }
}

/**
 * Build `inputs` under `root` into a private temp directory and serve it on
 * an ephemeral loopback port.
 *
 * @param {PrebuildOptions} options
 * @returns {Promise<PrebuiltFixture>}
 */
export async function prebuildFixture({ root: givenRoot, inputs, alias, define }) {
  if (inputs.length === 0) throw new Error('prebuildFixture: no inputs')
  // Vite resolves each HTML input to its REAL path and names the emitted page
  // relative to `root`, so a root reached through a symlink (the default macOS
  // tmpdir: `/var` -> `/private/var`) emits `../../private/...`, which
  // rolldown rejects. Build from the real path.
  const root = realpathSync(givenRoot)
  const base = mkdtempSync(join(tmpdir(), 'llui-fixture-'))
  const outDir = join(base, 'site')
  try {
    await build({
      root,
      mode: 'development',
      logLevel: 'error',
      cacheDir: join(base, 'vite-cache'),
      ...(alias !== undefined ? { resolve: { alias } } : {}),
      ...(define !== undefined ? { define } : {}),
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: { input: inputs.map((input) => resolve(root, input)) },
      },
    })
  } catch (error) {
    rmSync(base, { recursive: true, force: true })
    throw error
  }

  const server = createServer((req, res) => {
    const file = resolveServedFile(outDir, req.url ?? '/')
    if (file === null) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`not in the prebuilt fixture: ${req.url ?? ''}`)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(readFileSync(file))
  })
  /** @type {number} */
  const port = await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new Error('prebuilt fixture server did not bind a TCP port'))
        return
      }
      ok(address.port)
    })
  })
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    dir: outDir,
    url: (path) => `${origin}/${path.replace(/^\/+/, '')}`,
    close: async () => {
      await new Promise((ok) => {
        server.closeAllConnections()
        server.close(() => ok(undefined))
      })
      rmSync(base, { recursive: true, force: true })
    },
  }
}
