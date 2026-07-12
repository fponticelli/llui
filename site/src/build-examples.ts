/**
 * Build every example mini-app and copy its static output into the site's
 * deploy directory so the apps are served at `/apps/<slug>/`.
 *
 * Each app is built with base `/apps/<slug>/` so its asset URLs resolve under
 * that sub-path inside the iframe. Builds go to an out-of-tree staging dir —
 * never the example's own `dist/` — so the root-based `dist/` that `preview`,
 * `bench`, and `scripts/smoke-examples.ts` rely on is left untouched.
 *
 * Builds run through a bounded concurrency pool (the apps are independent Vite
 * builds), and an example is skipped when neither its source nor the built
 * framework has changed since the last successful build (a content hash cached
 * under `node_modules/.cache`). The framework fingerprint is folded into the
 * hash so a fresh `@llui/*` build always re-materializes every demo.
 *
 * The framing doc pages are produced separately by `generate-examples.ts`.
 *
 * Run AFTER `vite build` (it writes into `dist/client`):
 *   tsx src/build-examples.ts
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  cpSync,
  existsSync,
  rmSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'fs'
import { createHash } from 'crypto'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { EXAMPLES, type ExampleMeta } from './examples-data'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const projectRoot = resolve(root, '..')
const packagesDir = resolve(projectRoot, 'packages')
const examplesDir = resolve(projectRoot, 'examples')
const appsOutDir = resolve(root, 'dist/client/apps')
const stagingRoot = resolve(root, 'dist/.apps-staging')

const CONCURRENCY = 4
const cacheDir = resolve(projectRoot, 'node_modules/.cache')
const hashCacheFile = resolve(cacheDir, 'llui-example-hashes.json')

// ── Change detection ─────────────────────────────────────────────

/** Fold a directory's file contents (paths + bytes) into `h`, ignoring detritus. */
function updateDirHash(dir: string, h: ReturnType<typeof createHash>): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue
    const p = resolve(dir, entry.name)
    h.update(entry.name)
    if (entry.isDirectory()) updateDirHash(p, h)
    else if (entry.isFile()) h.update(readFileSync(p))
  }
}

/** Content hash of a directory tree. */
function hashDir(dir: string): string {
  const h = createHash('sha256')
  updateDirHash(dir, h)
  return h.digest('hex')
}

/**
 * Newest mtime across every `packages/<pkg>/dist` — a cheap proxy for "the
 * framework was rebuilt". Folded into each example's cache key so a rebuild
 * invalidates every demo even when the example's own source is untouched.
 */
function frameworkFingerprint(): string {
  let newest = 0
  for (const dir of readdirSync(packagesDir)) {
    try {
      const s = statSync(resolve(packagesDir, dir, 'dist'))
      if (s.mtimeMs > newest) newest = s.mtimeMs
    } catch {
      // package not built (no dist) — ignore
    }
  }
  return String(Math.floor(newest))
}

function exampleHash(ex: ExampleMeta, fwFingerprint: string): string | null {
  try {
    const srcDir = resolve(examplesDir, ex.slug)
    if (!existsSync(srcDir)) return null
    return createHash('sha256')
      .update(fwFingerprint)
      .update('\0')
      .update(hashDir(srcDir))
      .digest('hex')
  } catch {
    return null // any error → treat as "must rebuild"
  }
}

function loadHashCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(hashCacheFile, 'utf-8')) as Record<string, string>
  } catch {
    return {}
  }
}

function saveHashCache(cache: Record<string, string>): void {
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(hashCacheFile, JSON.stringify(cache, null, 2))
  } catch {
    // best-effort cache — never fail the build over it
  }
}

// ── Build one example ────────────────────────────────────────────

async function buildExample(ex: ExampleMeta): Promise<void> {
  const base = `/apps/${ex.slug}/`
  const dest = resolve(appsOutDir, ex.slug)
  const staging = resolve(stagingRoot, ex.slug)

  rmSync(staging, { recursive: true, force: true })

  try {
    if (ex.vike) {
      // Vike's CLI wrapper rejects Vite's `--base`/`--outDir` flags, so both are
      // passed via env vars its vite.config.ts reads. Vike writes the browser
      // bundle to `<LLUI_OUT>/client`.
      await execFileAsync('pnpm', ['--filter', ex.pkg, 'exec', '--', 'vite', 'build'], {
        cwd: projectRoot,
        env: { ...process.env, LLUI_BASE: base, LLUI_OUT: staging },
      })
    } else {
      // Plain Vite SPA: base + an out-of-tree outDir. `--emptyOutDir` is required
      // because the outDir sits outside the example's root.
      await execFileAsync(
        'pnpm',
        [
          '--filter',
          ex.pkg,
          'exec',
          '--',
          'vite',
          'build',
          '--base',
          base,
          '--outDir',
          staging,
          '--emptyOutDir',
        ],
        { cwd: projectRoot },
      )
    }

    const built = ex.vike ? resolve(staging, 'client') : staging
    if (!existsSync(built)) {
      throw new Error(`expected build output at ${built} but it does not exist`)
    }

    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(built, dest, { recursive: true })
    console.log(`✓ ${ex.slug} → dist/client/apps/${ex.slug}`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

// ── Bounded-concurrency pool ─────────────────────────────────────

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      await worker(items[idx]!)
    }
  })
  await Promise.all(runners)
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const fwFingerprint = frameworkFingerprint()
  const cache = loadHashCache()
  const nextCache: Record<string, string> = {}

  const toBuild: ExampleMeta[] = []
  for (const ex of EXAMPLES) {
    const hash = exampleHash(ex, fwFingerprint)
    const dest = resolve(appsOutDir, ex.slug)
    if (hash && cache[ex.slug] === hash && existsSync(dest)) {
      nextCache[ex.slug] = hash
      console.log(`• ${ex.slug} unchanged — skipping`)
      continue
    }
    if (hash) nextCache[ex.slug] = hash
    toBuild.push(ex)
  }

  const failures: string[] = []
  await runPool(toBuild, CONCURRENCY, async (ex) => {
    console.log(`▶ Building ${ex.slug} (base=/apps/${ex.slug}/)`)
    try {
      await buildExample(ex)
    } catch (err) {
      console.error(`✗ Failed to build ${ex.slug}: ${(err as Error).message}`)
      delete nextCache[ex.slug] // don't cache a failed build
      failures.push(ex.slug)
    }
  })

  rmSync(stagingRoot, { recursive: true, force: true })
  saveHashCache(nextCache)

  if (failures.length > 0) {
    console.error(`\nExample build failed for: ${failures.join(', ')}`)
    process.exit(1)
  }

  console.log(
    `\nBuilt ${toBuild.length}, skipped ${EXAMPLES.length - toBuild.length}; ${EXAMPLES.length} example apps in dist/client/apps`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
